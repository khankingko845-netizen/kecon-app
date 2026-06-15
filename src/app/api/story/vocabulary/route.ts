import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveApiKey, getSystemSetting } from "@/lib/server-settings";

/**
 * Analyze story vocabulary and generate quiz questions.
 * POST { storyId, childAge?, apiKey? }
 * Returns { vocabulary: [...], quiz: [...] }
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { storyId, childAge, apiKey: userKey } = await request.json();
  if (!storyId) {
    return Response.json({ error: "Thiếu storyId" }, { status: 400 });
  }

  // Get story + pages
  const { data: story } = await supabase
    .from("stories")
    .select("title, locale")
    .eq("id", storyId)
    .single();

  const { data: pages } = await supabase
    .from("story_pages")
    .select("page_number, content")
    .eq("story_id", storyId)
    .order("page_number");

  if (!pages || pages.length === 0) {
    return Response.json({ error: "Truyện không có nội dung" }, { status: 404 });
  }

  // Resolve AI provider
  const provider = await getSystemSetting("default_story_provider") || "openai";
  const model = await getSystemSetting("default_ai_model") || "gpt-4o-mini";
  const apiKey = await resolveApiKey(provider, userKey);
  if (!apiKey) {
    return Response.json({ error: "Chưa cấu hình API key" }, { status: 400 });
  }

  const storyContent = pages
    .map((p) => p.content?.replace(/\[(?:narrator|character:[^\]]+)\]/g, "").replace(/\[\/(?:narrator|character)\]/g, ""))
    .join(" ");

  const age = childAge || "4-6";
  const locale = story?.locale || "vi";

  const systemPrompt = `Bạn là chuyên gia giáo dục trẻ em và ngôn ngữ học. Phân tích từ vựng trong truyện thiếu nhi và tạo câu hỏi quiz vui.

Trả về JSON:
{
  "vocabulary": [
    {
      "word": "từ mới",
      "definition": "giải thích đơn giản, dễ hiểu cho bé ${age} tuổi",
      "example": "câu ví dụ từ truyện",
      "emoji": "emoji phù hợp",
      "difficulty": "easy|medium|hard"
    }
  ],
  "quiz": [
    {
      "question": "câu hỏi liên quan nội dung truyện",
      "options": ["A", "B", "C", "D"],
      "correct": 0,
      "explanation": "giải thích ngắn",
      "type": "content|vocabulary|moral"
    }
  ]
}

Yêu cầu:
- 5-8 từ vựng phù hợp để dạy bé ${age} tuổi
- 5 câu quiz: 2 về nội dung, 2 về từ vựng, 1 về bài học đạo đức
- Ngôn ngữ: ${locale === "vi" ? "Tiếng Việt" : "English"}
- Quiz phải vui, khuyến khích, không quá khó`;

  const userPrompt = `Truyện: "${story?.title || ""}"\nNội dung:\n${storyContent.slice(0, 3000)}`;

  try {
    let raw: string;

    if (provider === "gemini") {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: [{ parts: [{ text: userPrompt }] }],
          generationConfig: { temperature: 0.5, responseMimeType: "application/json" },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "Gemini error");
      raw = data.candidates[0].content.parts[0].text;
    } else {
      const endpoint = provider === "anthropic"
        ? "https://api.anthropic.com/v1/messages"
        : "https://api.openai.com/v1/chat/completions";

      if (provider === "anthropic") {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "Content-Type": "application/json",
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model,
            max_tokens: 2048,
            system: systemPrompt,
            messages: [{ role: "user", content: userPrompt }],
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || "Error");
        raw = data.content[0].text;
      } else {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
            temperature: 0.5,
            response_format: { type: "json_object" },
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || "Error");
        raw = data.choices[0].message.content;
      }
    }

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Invalid JSON");
    const parsed = JSON.parse(jsonMatch[0]);

    return Response.json({
      vocabulary: parsed.vocabulary || [],
      quiz: parsed.quiz || [],
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Phân tích thất bại" },
      { status: 500 }
    );
  }
}
