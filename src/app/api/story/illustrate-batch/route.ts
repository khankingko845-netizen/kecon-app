import { withAiContext } from "@/lib/ai-metering";
import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { hasPermission } from "@/lib/admin-permissions";
import { auditAdmin } from "@/lib/admin-audit";
import { guardUsage } from "@/lib/usage-guard";
import { rejectByoKeyUnlessAllowed } from "@/lib/byo-key";
import { z } from "zod";
import { optionalText, parseJsonBody, uuid } from "@/lib/api-validation";
import { resolveIllustrationTarget } from "@/lib/illustration";
import { illustrateStoredPage, loadBible } from "@/lib/illustrate-story";
import { DEFAULT_ART_STYLE, isArtStyle, type ArtStyle } from "@/lib/illustration-prompt";

/**
 * Illustrate several pages of a story (GPT Image / Gemini image, uploaded to
 * Storage so URLs never expire).
 * POST { storyId, style?, apiKey?, pageNumbers? }
 * Returns { results: Array<{ pageNumber, url?, error? }> }
 */

// Legacy style names from older clients map onto the house styles.
const LEGACY_STYLE: Record<string, ArtStyle> = { "3d": "clay", flat: "cartoon" };

const IllustrateBatchBody = z.object({
  storyId: uuid,
  style: z.enum(["clay", "watercolor", "cartoon", "3d", "storybook", "flat"]).nullish(),
  apiKey: optionalText(512),
  pageNumbers: z.array(z.number().int().min(1).max(500)).max(50).nullish(),
});

export const maxDuration = 300;
const MAX_PAGES_PER_BATCH = 20;
const CONCURRENCY = 2;

export async function POST(request: NextRequest) {
  return withAiContext("story.illustrate-batch", async (request) => {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const parsed = await parseJsonBody(request, IllustrateBatchBody);
    if (!parsed.ok) return parsed.response;
    const byoBlocked = await rejectByoKeyUnlessAllowed(supabase, user.id, parsed.data.apiKey);
    if (byoBlocked) return byoBlocked;
    const { storyId, apiKey: userKey, pageNumbers } = parsed.data;

    const target = await resolveIllustrationTarget(userKey);
    if (!target) {
      return Response.json(
        { error: "Chưa cấu hình dịch vụ vẽ tranh (OpenAI hoặc Gemini). Admin cần thêm key trong Cài Đặt Hệ Thống." },
        { status: 400 },
      );
    }

    const { data: story } = await supabase
      .from("stories")
      .select("id, title, user_id, illustration_style, cover_image_url")
      .eq("id", storyId)
      .maybeSingle();
    if (!story) return Response.json({ error: "Không tìm thấy truyện" }, { status: 404 });

    const requested = parsed.data.style ? (LEGACY_STYLE[parsed.data.style] ?? parsed.data.style) : null;
    const style: ArtStyle = isArtStyle(requested)
      ? requested
      : isArtStyle(story.illustration_style)
        ? story.illustration_style
        : DEFAULT_ART_STYLE;

    // Only the owner (or staff with stories.write — RLS limits editors to
    // platform stories) may spend illustration credits on a story
    if (story.user_id !== user.id) {
      if (!(await hasPermission(supabase, "stories.write"))) {
        return Response.json({ error: "Bạn không có quyền minh hoạ truyện này" }, { status: 403 });
      }
      // A-03: staff spending illustration credits on someone else's / a platform story.
      const auditFailed = await auditAdmin(supabase, request, {
        action: "story.illustrate",
        targetType: "story",
        targetId: storyId,
        after: { style, pages: pageNumbers?.length ? pageNumbers : "all" },
      });
      if (auditFailed) return auditFailed;
    }

    let query = supabase
      .from("story_pages")
      .select("id, page_number, content, scene_description, illustration_prompt, mood, illustration_url")
      .eq("story_id", storyId)
      .order("page_number");
    if (pageNumbers && pageNumbers.length > 0) query = query.in("page_number", pageNumbers);

    const { data: pages, error: pagesErr } = await query;
    if (pagesErr || !pages || pages.length === 0) {
      return Response.json({ error: "Không tìm thấy trang truyện" }, { status: 404 });
    }

    // Explicit pageNumbers re-draw those pages; otherwise only pages without a picture.
    const replace = Boolean(pageNumbers?.length);
    const toIllustrate = replace ? pages : pages.filter((p) => !p.illustration_url);
    if (toIllustrate.length === 0) {
      return Response.json({ results: [], message: "Tất cả trang đã có minh hoạ" });
    }
    if (toIllustrate.length > MAX_PAGES_PER_BATCH) {
      return Response.json(
        { error: `Mỗi lần chỉ minh hoạ tối đa ${MAX_PAGES_PER_BATCH} trang. Hãy chọn bớt trang (pageNumbers).` },
        { status: 400 },
      );
    }

    const usageBlocked = await guardUsage(supabase, "illustration", {
      byo: Boolean(userKey),
      amount: toIllustrate.length,
    });
    if (usageBlocked) return usageBlocked;

    const bible = await loadBible(supabase, storyId);
    const results: Array<{ pageNumber: number; url?: string; error?: string }> = [];
    let next = 0;
    const worker = async () => {
      while (next < toIllustrate.length) {
        const page = toIllustrate[next++];
        try {
          const { url } = await illustrateStoredPage(supabase, target, user.id, story, page, { style, bible, replace });
          results.push({ pageNumber: page.page_number, url });
        } catch (err) {
          results.push({
            pageNumber: page.page_number,
            error: err instanceof Error ? err.message : "Lỗi tạo minh hoạ",
          });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, toIllustrate.length) }, worker));
    results.sort((a, b) => a.pageNumber - b.pageNumber);
    return Response.json({ results });
  })(request);
}
