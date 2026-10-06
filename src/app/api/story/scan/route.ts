import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { guardUsage } from "@/lib/usage-guard";
import { rejectByoKeyUnlessAllowed } from "@/lib/byo-key";
import { resolveLlmTarget } from "@/lib/llm-config";
import { callLlm, extractJsonObject } from "@/lib/llm";
import { z } from "zod";
import { imageData, llmSelectionFields, parseJsonBody } from "@/lib/api-validation";

const ScanBody = z.object({
  ...llmSelectionFields,
  images: z.array(imageData).min(1, "Cần ít nhất 1 ảnh").max(10, "Tối đa 10 ảnh mỗi lần"),
});

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsedBody = await parseJsonBody(request, ScanBody);
  if (!parsedBody.ok) return parsedBody.response;
  const byoBlocked = await rejectByoKeyUnlessAllowed(supabase, user.id, parsedBody.data.apiKey);
  if (byoBlocked) return byoBlocked;
  const { images } = parsedBody.data;

  // BYO → client provider/model; platform key → admin default (must be vision-capable)
  const llm = await resolveLlmTarget(parsedBody.data);
  if (!llm.ok) return llm.response;

  const usageBlocked = await guardUsage(supabase, "ai", { byo: llm.byo });
  if (usageBlocked) return usageBlocked;

  try {
    const { text: result } = await callLlm({
      ...llm.target,
      system: `Bạn là chuyên gia OCR trích xuất nội dung truyện từ ảnh chụp sách.
Nhiệm vụ:
1. Đọc và trích xuất TOÀN BỘ text từ các trang sách trong ảnh
2. Giữ nguyên cấu trúc đoạn văn, hội thoại
3. Sửa lỗi OCR rõ ràng (ký tự sai do chụp mờ)
4. Tách thành các trang nếu có nhiều trang

Trả về JSON:
{
  "title": "Tên truyện (đoán từ nội dung nếu không thấy)",
  "pages": [
    { "text": "Nội dung trang 1", "sceneDescription": "Mô tả ngắn cảnh" }
  ],
  "language": "vi hoặc en",
  "suggestedCategory": "fairy_tale | adventure | bedtime | animal | educational | custom",
  "summary": "Tóm tắt 1-2 câu"
}

CHỈ trả về JSON, không có text nào khác.`,
      prompt: `Trích xuất nội dung truyện từ ${images.length} ảnh chụp sách sau:`,
      images: images.map((img) => ({ data: img, mimeType: "image/jpeg" })),
      imageDetail: "high",
      temperature: 0.3,
      maxTokens: 8192,
      json: true,
    });

    // Parse JSON from response
    let parsed: unknown;
    try {
      parsed = extractJsonObject(result);
    } catch {
      throw new Error("Không thể trích xuất nội dung từ ảnh. Vui lòng chụp rõ hơn.");
    }

    // Track usage
    await supabase.from("user_behavior").insert({
      user_id: user.id,
      action_type: "scan",
      metadata: { imageCount: images.length, provider: llm.target.provider },
    });

    return Response.json(parsed);
  } catch (err) {
    const message = err instanceof Error ? err.message : "OCR scan failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
