import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveApiKey } from "@/lib/server-settings";

/**
 * Batch-illustrate all pages of a story using DALL·E 3.
 * POST { storyId, style?, apiKey? }
 * Returns { results: Array<{ pageNumber, url?, error? }> }
 */

const ILLUSTRATION_STYLES: Record<string, string> = {
  watercolor: "watercolor painting style, soft pastel colors, gentle brush strokes",
  cartoon: "cute cartoon style, bold outlines, bright vibrant colors, kawaii",
  "3d": "3D rendered, soft lighting, cute character design, Pixar-like",
  storybook: "traditional storybook illustration, warm colors, detailed backgrounds",
  flat: "flat design illustration, geometric shapes, modern minimalist",
};

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { storyId, style = "watercolor", apiKey: userKey, pageNumbers } = await request.json();
  if (!storyId) {
    return Response.json({ error: "Thiếu storyId" }, { status: 400 });
  }

  // Resolve API key
  let apiKey = await resolveApiKey("dalle", userKey);
  if (!apiKey) apiKey = await resolveApiKey("openai", userKey);
  if (!apiKey) {
    return Response.json(
      { error: "Chưa cấu hình OpenAI API key. Admin cần thêm key trong Cài Đặt Hệ Thống." },
      { status: 400 }
    );
  }

  // Get story info for context
  const { data: story } = await supabase
    .from("stories")
    .select("title, category, locale")
    .eq("id", storyId)
    .single();

  // Get pages (optionally filter by page numbers)
  let query = supabase
    .from("story_pages")
    .select("id, page_number, scene_description, content, illustration_url")
    .eq("story_id", storyId)
    .order("page_number");

  if (pageNumbers && Array.isArray(pageNumbers) && pageNumbers.length > 0) {
    query = query.in("page_number", pageNumbers);
  }

  const { data: pages, error: pagesErr } = await query;
  if (pagesErr || !pages || pages.length === 0) {
    return Response.json({ error: "Không tìm thấy trang truyện" }, { status: 404 });
  }

  // Filter pages that need illustration (no existing url, unless forced via pageNumbers)
  const toIllustrate = pageNumbers
    ? pages
    : pages.filter((p) => !p.illustration_url);

  if (toIllustrate.length === 0) {
    return Response.json({ results: [], message: "Tất cả trang đã có minh hoạ" });
  }

  const stylePrompt = ILLUSTRATION_STYLES[style] || ILLUSTRATION_STYLES.watercolor;
  const storyTitle = story?.title || "";
  const results: Array<{ pageNumber: number; url?: string; error?: string }> = [];

  // Generate illustrations sequentially (API rate limiting)
  for (const page of toIllustrate) {
    const sceneDesc = page.scene_description || page.content?.slice(0, 200) || "";
    const prompt = `Children's storybook illustration for "${storyTitle}". ${stylePrompt}. Scene: ${sceneDesc}. No text or words in the image. Safe for children.`;

    try {
      const res = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "dall-e-3",
          prompt,
          n: 1,
          size: "1024x1024",
          quality: "standard",
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        results.push({
          pageNumber: page.page_number,
          error: json.error?.message || `Lỗi trang ${page.page_number}`,
        });
        continue;
      }

      const url = json.data?.[0]?.url;
      if (url) {
        // Save URL to database
        await supabase
          .from("story_pages")
          .update({ illustration_url: url })
          .eq("id", page.id);
        results.push({ pageNumber: page.page_number, url });
      } else {
        results.push({ pageNumber: page.page_number, error: "Không nhận được ảnh" });
      }
    } catch (err) {
      results.push({
        pageNumber: page.page_number,
        error: err instanceof Error ? err.message : "Lỗi tạo minh hoạ",
      });
    }
  }

  return Response.json({ results });
}
