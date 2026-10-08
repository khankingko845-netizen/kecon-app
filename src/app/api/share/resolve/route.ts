import { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { z } from "zod";
import { parseJsonBody } from "@/lib/api-validation";
import { shareToken, SharedStoryText, SHARE_HEADERS } from "@/lib/story-links";
export async function POST(r: NextRequest) {
  const parsed = await parseJsonBody(
    r,
    z.object({ token: shareToken }).strict(),
  );
  if (!parsed.ok) {
    Object.entries(SHARE_HEADERS).forEach(([k, v]) =>
      parsed.response.headers.set(k, v),
    );
    return parsed.response;
  }
  const db = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => [], setAll: () => {} } },
  );
  const { data, error } = await db.rpc("resolve_platform_story_link", {
    p_token: parsed.data.token,
  });
  const result = SharedStoryText.safeParse(data);
  const unavailable = Boolean(error || (data !== null && !result.success));
  return Response.json(
    unavailable
      ? { error: "Chưa mở được link." }
      : result.success
        ? result.data
        : { error: "Link không khả dụng, đã hết hạn hoặc được thu hồi." },
    {
      status: unavailable ? 503 : result.success ? 200 : 404,
      headers: SHARE_HEADERS,
    },
  );
}
