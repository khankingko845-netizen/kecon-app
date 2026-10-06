import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { guardUsage } from "@/lib/usage-guard";
import { rejectByoKeyUnlessAllowed } from "@/lib/byo-key";
import { resolveLlmTarget } from "@/lib/llm-config";
import { callLlmJson } from "@/lib/llm";
import { z } from "zod";
import { optionalText, parseJsonBody, uuid } from "@/lib/api-validation";

/**
 * Analyze story vocabulary and generate quiz questions.
 * POST { storyId, childAge?, apiKey? }
 * Returns { vocabulary: [...], quiz: [...] }
 */
const VocabularyBody = z.object({
  storyId: uuid,
  childAge: z.union([optionalText(20), z.number().int().min(0).max(18).transform(String)]),
  apiKey: optionalText(512),
});

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsedBody = await parseJsonBody(request, VocabularyBody);
  if (!parsedBody.ok) return parsedBody.response;
  const byoBlocked = await rejectByoKeyUnlessAllowed(supabase, user.id, parsedBody.data.apiKey);
  if (byoBlocked) return byoBlocked;
  const { storyId, childAge, apiKey: userKey } = parsedBody.data;

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

  const llm = await resolveLlmTarget({ apiKey: userKey });
  if (!llm.ok) return llm.response;

  const usageBlocked = await guardUsage(supabase, "ai", { byo: llm.byo });
  if (usageBlocked) return usageBlocked;

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
    const { data } = await callLlmJson({
      ...llm.target,
      system: systemPrompt,
      prompt: userPrompt,
      temperature: 0.5,
      maxTokens: 2048,
    });
    const parsed = data as { vocabulary?: unknown[]; quiz?: unknown[] };

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
