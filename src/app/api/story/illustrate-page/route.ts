import { withAiContext } from "@/lib/ai-metering";
import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { guardUsage } from "@/lib/usage-guard";
import { z } from "zod";
import { parseJsonBody, uuid } from "@/lib/api-validation";
import { IllustrationError, resolveIllustrationTarget } from "@/lib/illustration";
import { illustrateStoredPage } from "@/lib/illustrate-story";

/**
 * Progressive picture for one page of the caller's own story.
 * POST { storyId, pageNumber } → { pageNumber, url } (existing picture is returned as-is).
 * The player calls this page by page (2 at a time) so the first pages
 * appear quickly and each request stays well under proxy timeouts.
 */
const Body = z.object({
  storyId: uuid,
  pageNumber: z.number().int().min(1).max(60),
});

export const maxDuration = 180;

export async function POST(request: NextRequest) {
  return withAiContext("story.illustrate-page", async (request) => {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const parsed = await parseJsonBody(request, Body);
    if (!parsed.ok) return parsed.response;
    const { storyId, pageNumber } = parsed.data;

    const { data: story } = await supabase
      .from("stories")
      .select("id, title, user_id, illustration_style, cover_image_url")
      .eq("id", storyId)
      .maybeSingle();
    if (!story) return Response.json({ error: "Không tìm thấy truyện" }, { status: 404 });
    if (story.user_id !== user.id)
      return Response.json({ error: "Chỉ chủ truyện mới vẽ tranh cho truyện này" }, { status: 403 });

    const { data: page } = await supabase
      .from("story_pages")
      .select("id, page_number, content, scene_description, illustration_prompt, mood, illustration_url")
      .eq("story_id", storyId)
      .eq("page_number", pageNumber)
      .maybeSingle();
    if (!page) return Response.json({ error: "Không tìm thấy trang truyện" }, { status: 404 });
    if (page.illustration_url) return Response.json({ pageNumber, url: page.illustration_url, existing: true });

    const target = await resolveIllustrationTarget();
    if (!target)
      return Response.json({ error: "Chưa cấu hình dịch vụ vẽ tranh. Truyện vẫn dùng tranh khung cảnh có sẵn." }, { status: 503 });

    const usageBlocked = await guardUsage(supabase, "illustration", { byo: false });
    if (usageBlocked) return usageBlocked;

    try {
      const { url, stored } = await illustrateStoredPage(supabase, target, user.id, story, page);
      if (!stored) {
        const { data: fresh } = await supabase.from("story_pages").select("illustration_url").eq("id", page.id).maybeSingle();
        return Response.json({ pageNumber, url: fresh?.illustration_url || url, existing: true });
      }
      return Response.json({ pageNumber, url });
    } catch (err) {
      const status = err instanceof IllustrationError ? err.status : 502;
      return Response.json({ error: err instanceof Error ? err.message : "Vẽ tranh thất bại" }, { status });
    }
  })(request);
}
