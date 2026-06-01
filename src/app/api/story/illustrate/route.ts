import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Generates an illustration for a story page using OpenAI Images (DALL·E 3).
// BYO-key: uses the user's OpenAI key, falling back to the server env var.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { prompt, apiKey: userKey, size } = await request.json();
  if (!prompt) {
    return Response.json({ error: "Thiếu mô tả cảnh" }, { status: 400 });
  }

  const apiKey = userKey || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "Chưa cấu hình OpenAI API key để tạo minh hoạ" },
      { status: 400 }
    );
  }

  try {
    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "dall-e-3",
        prompt: `Children's storybook illustration, warm, soft, friendly, colorful, no text: ${prompt}`,
        n: 1,
        size: size || "1024x1024",
      }),
    });

    const json = await res.json();
    if (!res.ok) {
      return Response.json(
        { error: json.error?.message || "Tạo minh hoạ thất bại" },
        { status: res.status }
      );
    }

    const url = json.data?.[0]?.url as string | undefined;
    if (!url) {
      return Response.json({ error: "Không nhận được ảnh" }, { status: 500 });
    }
    return Response.json({ url });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Tạo minh hoạ thất bại";
    return Response.json({ error: message }, { status: 500 });
  }
}
