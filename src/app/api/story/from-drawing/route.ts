import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveApiKey, getSystemSetting } from "@/lib/server-settings";

/**
 * Generate a story from a child's drawing.
 * POST { imageData (base64), childName?, age?, language? }
 * Uses GPT-4V to analyze the drawing, then generates a story.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { imageData, childName, age = "4-6", language = "vi" } = body;

  if (!imageData) {
    return Response.json({ error: "Cần hình vẽ" }, { status: 400 });
  }

  // We need OpenAI for vision
  const apiKey = await resolveApiKey("openai");
  if (!apiKey) {
    return Response.json(
      { error: "Cần OpenAI API key cho tính năng này. Admin cần thêm key trong Cài Đặt." },
      { status: 400 }
    );
  }

  // Also get story generation provider
  const storyProvider = await getSystemSetting("default_story_provider") || "openai";
  const storyModel = await getSystemSetting("default_ai_model") || "gpt-4o-mini";
  const storyApiKey = await resolveApiKey(storyProvider);

  const langMap: Record<string, string> = { vi: "Tiếng Việt", en: "English", ja: "日本語" };
  const langName = langMap[language] || language;
  const forChild = childName ? `cho bé ${childName}, ${age} tuổi` : `cho trẻ ${age} tuổi`;

  try {
    // Step 1: Analyze drawing with GPT-4V
    const analysisRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `Bạn phân tích bản vẽ của trẻ em. Mô tả chi tiết những gì bé vẽ: nhân vật, đồ vật, bối cảnh, màu sắc, cảm xúc. Trả về JSON:
{ "elements": ["danh sách đối tượng"], "scene": "mô tả bối cảnh", "mood": "cảm xúc chung", "colors": ["màu chủ đạo"], "story_seed": "ý tưởng truyện từ bản vẽ" }`,
          },
          {
            role: "user",
            content: [
              { type: "text", text: "Phân tích bản vẽ của bé và đề xuất ý tưởng truyện:" },
              {
                type: "image_url",
                image_url: {
                  url: imageData.startsWith("data:") ? imageData : `data:image/png;base64,${imageData}`,
                  detail: "low",
                },
              },
            ],
          },
        ],
        temperature: 0.7,
        max_tokens: 500,
        response_format: { type: "json_object" },
      }),
    });

    const analysisData = await analysisRes.json();
    if (!analysisRes.ok) {
      throw new Error(analysisData.error?.message || "Phân tích hình vẽ thất bại");
    }

    const analysisRaw = analysisData.choices[0].message.content;
    const analysis = JSON.parse(analysisRaw);

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
- Đối tượng: ${analysis.elements?.join(", ") || "không rõ"}
- Bối cảnh: ${analysis.scene || "không rõ"}
- Cảm xúc: ${analysis.mood || "vui vẻ"}
- Ý tưởng: ${analysis.story_seed || ""}

Hãy viết truyện thiếu nhi dựa trên bản vẽ này!`;

    let raw: string;
    const effectiveKey = storyApiKey || apiKey;

    if (storyProvider === "gemini" && storyApiKey) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${storyModel}:generateContent?key=${effectiveKey}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: storySystemPrompt }] },
          contents: [{ parts: [{ text: storyPrompt }] }],
          generationConfig: { temperature: 0.8, responseMimeType: "application/json" },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "Error");
      raw = data.candidates[0].content.parts[0].text;
    } else {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${effectiveKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: storyModel.startsWith("gpt") ? storyModel : "gpt-4o-mini",
          messages: [
            { role: "system", content: storySystemPrompt },
            { role: "user", content: storyPrompt },
          ],
          temperature: 0.8,
          response_format: { type: "json_object" },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "Error");
      raw = data.choices[0].message.content;
    }

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Invalid JSON");
    const story = JSON.parse(jsonMatch[0]);

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
        cover_image_url: imageData.startsWith("data:") ? null : imageData, // Save if it's a URL
        metadata: { drawing_analysis: analysis, from_drawing: true },
      })
      .select("id")
      .single();

    if (insertErr) throw new Error(insertErr.message);

    // Insert pages
    const pageRows = (story.pages || []).map(
      (p: { text: string; sceneDescription?: string }, i: number) => ({
        story_id: storyRow.id,
        page_number: i + 1,
        content: p.text,
        scene_description: p.sceneDescription || "",
      })
    );
    await supabase.from("story_pages").insert(pageRows);

    // Insert characters
    if (story.characters?.length > 0) {
      const COLORS = ["#EF4444", "#F59E0B", "#10B981", "#3B82F6", "#8B5CF6", "#EC4899"];
      const charRows = story.characters.map(
        (c: { name: string; description?: string; emoji?: string }, i: number) => ({
          story_id: storyRow.id,
          name: c.name,
          description: c.description || null,
          emoji: c.emoji || null,
          color: COLORS[i % COLORS.length],
          sort_order: i,
        })
      );
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
}
