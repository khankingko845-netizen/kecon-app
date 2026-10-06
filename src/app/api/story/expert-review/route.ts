import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { guardUsage } from "@/lib/usage-guard";
import { rejectByoKeyUnlessAllowed } from "@/lib/byo-key";
import { resolveLlmTarget } from "@/lib/llm-config";
import { callLlmJson, type LlmTarget } from "@/lib/llm";
import { z } from "zod";
import { languageCode, llmSelectionFields, optionalText, parseJsonBody, requiredText } from "@/lib/api-validation";

const EXPERTS = {
  psychologist: {
    name: "Dr. Tâm An",
    emoji: "🧒",
    title: "Chuyên gia Tâm lý Trẻ em",
    systemPrompt: `Bạn là Dr. Tâm An, chuyên gia tâm lý trẻ em với 20 năm kinh nghiệm.
Đánh giá truyện thiếu nhi theo các tiêu chí:
1. Phù hợp độ tuổi (ngôn ngữ, chủ đề, độ phức tạp)
2. An toàn cảm xúc (không gây sợ hãi, lo lắng không cần thiết)
3. Bài học đạo đức (tích cực, dễ hiểu, không giáo điều)
4. Sự kết nối cảm xúc (nhân vật có gần gũi với bé không)
5. Kết thúc tích cực, mang lại cảm giác an toàn

Trả về JSON:
{
  "score": 1-10,
  "strengths": ["điểm mạnh 1", "điểm mạnh 2"],
  "concerns": ["lo ngại 1 (nếu có)"],
  "suggestions": ["gợi ý cải thiện 1", "gợi ý 2"],
  "age_appropriate": true/false,
  "emotional_safety": "an toàn" | "cần chỉnh sửa",
  "summary": "Đánh giá tổng quan 2-3 câu"
}`,
  },
  screenwriter: {
    name: "Nhà văn Kể Hay",
    emoji: "🎬",
    title: "Chuyên gia Kịch bản Truyện",
    systemPrompt: `Bạn là Nhà văn Kể Hay, chuyên gia kịch bản truyện thiếu nhi với nhiều giải thưởng.
Đánh giá truyện theo các tiêu chí:
1. Cấu trúc (mở đầu hấp dẫn → xung đột → cao trào → giải quyết)
2. Nhịp kể (pacing) phù hợp độ tuổi
3. Phát triển nhân vật (có chiều sâu, đáng yêu, đáng nhớ)
4. Lời thoại (tự nhiên, sống động, đặc trưng)
5. Yếu tố bất ngờ / hài hước
6. Khả năng kể lại (bé có muốn nghe lại không)

Trả về JSON:
{
  "score": 1-10,
  "structure_analysis": "phân tích cấu trúc 2-3 câu",
  "character_depth": "đánh giá nhân vật 1-2 câu",
  "pacing": "tốt" | "hơi nhanh" | "hơi chậm" | "không đều",
  "strengths": ["điểm mạnh 1", "điểm mạnh 2"],
  "suggestions": ["gợi ý 1", "gợi ý 2"],
  "rewrite_hints": ["trang X: gợi ý viết lại cụ thể"],
  "summary": "Đánh giá tổng quan 2-3 câu"
}`,
  },
  educator: {
    name: "Thầy Minh Tuệ",
    emoji: "📚",
    title: "Chuyên gia Giáo dục Trẻ em",
    systemPrompt: `Bạn là Thầy Minh Tuệ, chuyên gia giáo dục trẻ em, nguyên giảng viên ĐH Sư Phạm.
Đánh giá truyện theo góc nhìn giáo dục:
1. Giá trị giáo dục (kiến thức, kỹ năng sống)
2. Từ vựng phù hợp lứa tuổi + từ mới có giải thích
3. Câu hỏi tương tác tiềm năng cho bé
4. Liên hệ thực tế (bé áp dụng được gì)
5. Phát triển tư duy (logic, sáng tạo, cảm xúc)
6. Đa dạng văn hóa và giá trị nhân văn

Trả về JSON:
{
  "score": 1-10,
  "educational_value": "phân tích giá trị giáo dục 2-3 câu",
  "vocabulary_level": "phù hợp" | "hơi khó" | "hơi dễ",
  "new_words": ["từ mới 1", "từ mới 2"],
  "discussion_questions": ["câu hỏi 1 cho bé", "câu hỏi 2"],
  "life_skills": ["kỹ năng sống 1", "kỹ năng 2"],
  "strengths": ["điểm mạnh 1"],
  "suggestions": ["gợi ý 1", "gợi ý 2"],
  "summary": "Đánh giá tổng quan 2-3 câu"
}`,
  },
} as const;

type ExpertKey = keyof typeof EXPERTS;

const ExpertReviewBody = z.object({
  ...llmSelectionFields,
  storyContent: requiredText(20_000),
  storyTitle: optionalText(200),
  targetAge: optionalText(20),
  language: languageCode,
  experts: z.array(z.enum(["psychologist", "screenwriter", "educator"])).max(3).nullish(),
});

async function reviewWith(target: LlmTarget, systemPrompt: string, userPrompt: string): Promise<unknown> {
  const { data } = await callLlmJson({
    ...target,
    system: systemPrompt,
    prompt: userPrompt,
    temperature: 0.7,
    maxTokens: 2048,
  });
  return data;
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const parsedBody = await parseJsonBody(request, ExpertReviewBody);
  if (!parsedBody.ok) return parsedBody.response;
  const byoBlocked = await rejectByoKeyUnlessAllowed(supabase, user.id, parsedBody.data.apiKey);
  if (byoBlocked) return byoBlocked;
  const { storyContent, storyTitle, targetAge, language, experts: requestedExperts } = parsedBody.data;

  const llm = await resolveLlmTarget(parsedBody.data);
  if (!llm.ok) return llm.response;

  // Build the user prompt
  const userPrompt = `Đánh giá câu chuyện thiếu nhi sau:

Tiêu đề: ${storyTitle || "Không có tiêu đề"}
Độ tuổi mục tiêu: ${targetAge || "4-6"}
Ngôn ngữ: ${language || "vi"}

NỘI DUNG TRUYỆN:
${storyContent}

Hãy đánh giá chi tiết và trả về JSON theo format yêu cầu. Viết bằng tiếng Việt.`;

  // Determine which experts to call
  const expertKeys: ExpertKey[] = requestedExperts?.length
    ? [...new Set(requestedExperts)]
    : ["psychologist", "screenwriter", "educator"];

  // Each expert is one paid AI call
  const usageBlocked = await guardUsage(supabase, "ai", {
    byo: llm.byo,
    amount: Math.max(expertKeys.length, 1),
  });
  if (usageBlocked) return usageBlocked;

  // Call all experts in parallel
  const results: Record<string, { expert: typeof EXPERTS[ExpertKey]; review: unknown; error?: string }> = {};

  await Promise.all(
    expertKeys.map(async (key: ExpertKey) => {
      const expert = EXPERTS[key];
      try {
        const review = await reviewWith(llm.target, expert.systemPrompt, userPrompt);
        results[key] = { expert, review };
      } catch (err) {
        results[key] = {
          expert,
          review: null,
          error: err instanceof Error ? err.message : "Lỗi khi gọi AI",
        };
      }
    })
  );

  return Response.json({ reviews: results });
}
