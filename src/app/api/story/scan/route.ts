import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveApiKey, getSystemSetting } from "@/lib/server-settings";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { images, provider, apiKey: userKey } = body;

  if (!images || !Array.isArray(images) || images.length === 0) {
    return Response.json({ error: "Cần ít nhất 1 ảnh" }, { status: 400 });
  }

  // Use OpenAI or Gemini vision for OCR
  const resolvedProvider = provider || "openai";
  const apiKey = await resolveApiKey(resolvedProvider, userKey);
  if (!apiKey) {
    return Response.json(
      { error: `Chưa cấu hình API key cho ${resolvedProvider}. Admin cần thêm key trong Cài Đặt Hệ Thống.` },
      { status: 400 }
    );
  }

  const resolvedModel = await getSystemSetting("default_ai_model") || "gpt-4o-mini";

  try {
    // Build vision messages with all images
    const imageContents = images.map((img: string) => ({
      type: "image_url" as const,
      image_url: {
        url: img.startsWith("data:") ? img : `data:image/jpeg;base64,${img}`,
        detail: "high" as const,
      },
    }));

    const messages = [
      {
        role: "system" as const,
        content: `Bạn là chuyên gia OCR trích xuất nội dung truyện từ ảnh chụp sách.
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
      },
      {
        role: "user" as const,
        content: [
          {
            type: "text" as const,
            text: `Trích xuất nội dung truyện từ ${images.length} ảnh chụp sách sau:`,
          },
          ...imageContents,
        ],
      },
    ];

    let result: string;

    if (resolvedProvider === "gemini") {
      // Gemini API
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
      const parts = [
        { text: messages[0].content },
        { text: `Trích xuất nội dung truyện từ ${images.length} ảnh chụp sách sau:` },
        ...images.map((img: string) => ({
          inline_data: {
            mime_type: "image/jpeg",
            data: img.startsWith("data:") ? img.split(",")[1] : img,
          },
        })),
      ];

      const geminiRes = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 8192 },
        }),
      });

      if (!geminiRes.ok) {
        const errData = await geminiRes.json().catch(() => ({}));
        throw new Error(errData?.error?.message || `Gemini API error: ${geminiRes.status}`);
      }

      const geminiData = await geminiRes.json();
      result = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "";
    } else {
      // OpenAI-compatible API
      const baseUrl = resolvedProvider === "custom"
        ? (await getSystemSetting("custom_base_url")) || "https://api.openai.com/v1"
        : "https://api.openai.com/v1";

      // Use a vision-capable model
      const visionModel = resolvedModel.includes("gpt-4") ? resolvedModel : "gpt-4o-mini";

      const openaiRes = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: visionModel,
          messages,
          temperature: 0.3,
          max_tokens: 8192,
        }),
      });

      if (!openaiRes.ok) {
        const errData = await openaiRes.json().catch(() => ({}));
        throw new Error(errData?.error?.message || `OpenAI API error: ${openaiRes.status}`);
      }

      const openaiData = await openaiRes.json();
      result = openaiData.choices?.[0]?.message?.content || "";
    }

    // Parse JSON from response
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Không thể trích xuất nội dung từ ảnh. Vui lòng chụp rõ hơn.");
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Track usage
    await supabase.from("user_behavior").insert({
      user_id: user.id,
      action_type: "scan",
      metadata: { imageCount: images.length, provider: resolvedProvider },
    });

    return Response.json(parsed);
  } catch (err) {
    const message = err instanceof Error ? err.message : "OCR scan failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
