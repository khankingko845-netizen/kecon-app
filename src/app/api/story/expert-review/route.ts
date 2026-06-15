import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveApiKey, resolveCustomBaseUrl } from "@/lib/server-settings";
import { getSystemSetting } from "@/lib/server-settings";

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

async function callAI(
  provider: string,
  apiKey: string,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  baseUrl?: string
): Promise<string> {
  let endpoint: string;
  let headers: Record<string, string>;
  let body: unknown;

  if (provider === "gemini") {
    endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    headers = { "Content-Type": "application/json" };
    body = {
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ parts: [{ text: userPrompt }] }],
      generationConfig: { temperature: 0.7, responseMimeType: "application/json" },
    };
  } else if (provider === "anthropic") {
    endpoint = "https://api.anthropic.com/v1/messages";
    headers = {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
    };
    body = {
      model,
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    };
  } else {
    // OpenAI-compatible (openai, custom)
    const base = provider === "custom" && baseUrl
      ? baseUrl.replace(/\/+$/, "")
      : "https://api.openai.com/v1";
    endpoint = `${base}/chat/completions`;
    headers = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };
    body = {
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.7,
      response_format: { type: "json_object" },
    };
  }

  const res = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(body) });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `AI error: ${res.status}`);
  }
  const data = await res.json();

  // Extract text from different provider formats
  if (provider === "gemini") return data.candidates[0].content.parts[0].text;
  if (provider === "anthropic") return data.content[0].text;
  return data.choices[0].message.content;
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { storyContent, storyTitle, targetAge, language, experts: requestedExperts, provider: userProvider, model: userModel, apiKey: userKey, baseUrl: userBaseUrl } = body;

  if (!storyContent) {
    return Response.json({ error: "Missing story content" }, { status: 400 });
  }

  // Resolve provider & key
  const defaultProvider = await getSystemSetting("default_story_provider") || "openai";
  const defaultModel = await getSystemSetting("default_ai_model") || "gpt-4o-mini";
  const provider = userKey ? (userProvider || defaultProvider) : defaultProvider;
  const model = userModel || defaultModel;
  const apiKey = await resolveApiKey(provider, userKey);
  if (!apiKey) {
    return Response.json({ error: "Chưa cấu hình AI provider" }, { status: 400 });
  }
  const baseUrl = provider === "custom" ? await resolveCustomBaseUrl(userBaseUrl) : undefined;

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
    ? requestedExperts.filter((k: string) => k in EXPERTS)
    : ["psychologist", "screenwriter", "educator"];

  // Call all experts in parallel
  const results: Record<string, { expert: typeof EXPERTS[ExpertKey]; review: unknown; error?: string }> = {};

  await Promise.all(
    expertKeys.map(async (key: ExpertKey) => {
      const expert = EXPERTS[key];
      try {
        const raw = await callAI(provider, apiKey, model, expert.systemPrompt, userPrompt, baseUrl);
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { error: "Invalid response" };
        results[key] = { expert, review: parsed };
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
