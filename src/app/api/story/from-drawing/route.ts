import { withAiContext } from "@/lib/ai-metering";
import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { guardUsage } from "@/lib/usage-guard";
import { resolveLlmTarget } from "@/lib/llm-config";
import { callLlmJson } from "@/lib/llm-metered";
import { z } from "zod";
import { imageData as imageDataSchema, languageCode, optionalText, parseJsonBody } from "@/lib/api-validation";

/**
 * Generate a story from a child's drawing.
 * POST { imageData (base64), childName?, age?, language? }
 * Uses the admin default (vision-capable) model to analyze the drawing, then generates a story.
 */
const FromDrawingBody = z.object({
  imageData: imageDataSchema,
  childName: optionalText(60),
  age: optionalText(20),
  language: languageCode,
});

export async function POST(request: NextRequest) {
 return withAiContext("story.from-drawing",async(request)=>{
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsedBody = await parseJsonBody(request, FromDrawingBody);
  if (!parsedBody.ok) return parsedBody.response;
  const { imageData, childName } = parsedBody.data;
  const age = parsedBody.data.age || "3-5";
  const language = parsedBody.data.language || "vi";

  // Platform key + admin default provider/model for both steps (all providers support images)
  const llm = await resolveLlmTarget();
  if (!llm.ok) return llm.response;

  const usageBlocked = await guardUsage(supabase, "story");
  if (usageBlocked) return usageBlocked;

  const langMap: Record<string, string> = { vi: "Tiếng Việt", en: "English", ja: "日本語" };
  const langName = langMap[language] || language;
  const forChild = childName ? `cho bé ${childName}, ${age} tuổi` : `cho trẻ ${age} tuổi`;

  try {
    // Step 1: Analyze the drawing (vision)
    const { data: analysisData } = await callLlmJson({
      ...llm.target,
      system: `Bạn phân tích bản vẽ của trẻ em. Mô tả chi tiết những gì bé vẽ: nhân vật, đồ vật, bối cảnh, màu sắc, cảm xúc. Trả về JSON:
{ "elements": ["danh sách đối tượng"], "scene": "mô tả bối cảnh", "mood": "cảm xúc chung", "colors": ["màu chủ đạo"], "story_seed": "ý tưởng truyện từ bản vẽ" }`,
      prompt: "Phân tích bản vẽ của bé và đề xuất ý tưởng truyện:",
      images: [{ data: imageData }],
      imageDetail: "low",
      temperature: 0.7,
      maxTokens: 500,
    });
    const analysis = analysisData as {
      elements?: string[];
      scene?: string;
      mood?: string;
      story_seed?: string;
    };

    // Step 2: Generate story based on drawing analysis
    const storySystemPrompt = `Bạn là tác giả truyện thiếu nhi. Viết truyện dựa trên bản vẽ của bé.
Viết bằng ${langName}, ${forChild}. Dùng câu đơn giản, từ vựng phù hợp.

QUAN TRỌNG — Voice Markup:
- Dùng [narrator]...[/narrator] cho lời kể
- Dùng [character:Tên]...[/character] cho lời thoại

Trả về JSON:
{
  "title": "Tên truyện",
  "summary": "Tóm tắt 1-2 câu",
  "characters": [{ "name": "Tên", "description": "Mô tả", "personality": "Tính cách", "emoji": "🐱" }],
  "pages": [{ "text": "[narrator]...[/narrator]", "sceneDescription": "Mô tả cảnh" }]
}

Yêu cầu: 5-8 trang, có bài học, kết thúc có hậu.`;

    const storyPrompt = `Bé ${childName || ""} đã vẽ một bức tranh với:
- Đối tượng: ${Array.isArray(analysis.elements) ? analysis.elements.join(", ") : "không rõ"}
- Bối cảnh: ${analysis.scene || "không rõ"}
- Cảm xúc: ${analysis.mood || "vui vẻ"}
- Ý tưởng: ${analysis.story_seed || ""}

Hãy viết truyện thiếu nhi dựa trên bản vẽ này!`;

    const { data: storyData } = await callLlmJson({
      ...llm.target,
      system: storySystemPrompt,
      prompt: storyPrompt,
      temperature: 0.8,
    });
    const story = storyData as {
      title?: string;
      summary?: string;
      pages?: { text: string; sceneDescription?: string }[];
      characters?: { name: string; description?: string; emoji?: string }[];
    };
    if (!story.title || !Array.isArray(story.pages) || story.pages.length === 0) {
      throw new Error("Story format invalid");
    }

    // Step 3: Save to database
    const { data: storyRow, error: insertErr } = await supabase
      .from("stories")
      .insert({
        user_id: user.id,
        title: story.title,
        description: story.summary,
        category: "imagination",
        theme: "tuviet",
        target_age_min: parseInt(age) || 4,
        target_age_max: parseInt(age.split("-")[1] || age) || 6,
        locale: language,
        page_count: story.pages?.length || 0,
        source: "ai",
        status: "draft",
        tags: ["from-drawing"],
        metadata: { drawing_analysis: analysis, from_drawing: true },
      })
      .select("id")
      .single();

    if (insertErr) throw new Error(insertErr.message);

    // Insert pages
    const pageRows = story.pages.map(
      (p, i) => ({
        story_id: storyRow.id,
        page_number: i + 1,
        content: p.text,
        scene_description: p.sceneDescription || "",
      })
    );
    await supabase.from("story_pages").insert(pageRows);

    // Insert characters
    if (story.characters && story.characters.length > 0) {
      const COLORS = ["#EF4444", "#F59E0B", "#10B981", "#3B82F6", "#8B5CF6", "#EC4899"];
      const charRows = story.characters.map((c, i) => ({
          story_id: storyRow.id,
          name: c.name,
          description: c.description || null,
          emoji: c.emoji || null,
          color: COLORS[i % COLORS.length],
          sort_order: i,
        }));
      await supabase.from("story_characters").insert(charRows);
    }

    return Response.json({
      storyId: storyRow.id,
      title: story.title,
      analysis,
      pageCount: pageRows.length,
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Tạo truyện từ hình vẽ thất bại" },
      { status: 500 }
    );
  }
})(request);
}
