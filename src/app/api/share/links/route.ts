import { NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import {
  IssuedStoryLink,
  StoryLinkMetadata,
  SHARE_HEADERS,
} from "@/lib/story-links";
import { parseJsonBody } from "@/lib/api-validation";
const reply = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: SHARE_HEADERS });
const Issue = z
  .object({
    storyId: z.uuid(),
    hours: z.union([z.literal(24), z.literal(72), z.literal(168)]).default(168),
  })
  .strict();
const Revoke = z.object({ id: z.uuid() }).strict();
function crossSite(r: NextRequest) {
  const origin = r.headers.get("origin");
  return (
    r.headers.get("sec-fetch-site") === "cross-site" ||
    Boolean(
      origin &&
      ![r.nextUrl.origin, process.env.NEXT_PUBLIC_SITE_URL].includes(origin),
    )
  );
}
export async function POST(r: NextRequest) {
  if (crossSite(r)) return reply({ error: "Forbidden" }, 403);
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return reply({ error: "Unauthorized" }, 401);
  const p = await parseJsonBody(r, Issue);
  if (!p.ok) {
    Object.entries(SHARE_HEADERS).forEach(([k, v]) =>
      p.response.headers.set(k, v),
    );
    return p.response;
  }
  const { data, error } = await db.rpc("issue_platform_story_link", {
    p_story: p.data.storyId,
    p_hours: p.data.hours,
  });
  if (error)
    return reply(
      {
        error:
          error.code === "54000"
            ? "Đã đạt giới hạn link. Thu hồi link cũ hoặc thử lại sau."
            : "Chỉ chia sẻ được truyện nền tảng đã công khai. Truyện riêng còn chờ consent và quyền chia sẻ.",
        code: "share_unavailable",
      },
      error.code === "54000" ? 429 : error.code === "42501" ? 403 : 503,
    );
  const parsed = IssuedStoryLink.safeParse(data);
  return parsed.success
    ? reply(parsed.data)
    : reply({ error: "Chưa tạo được link. Hãy thử lại sau." }, 503);
}
export async function DELETE(r: NextRequest) {
  if (crossSite(r)) return reply({ error: "Forbidden" }, 403);
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return reply({ error: "Unauthorized" }, 401);
  const p = await parseJsonBody(r, Revoke);
  if (!p.ok) {
    Object.entries(SHARE_HEADERS).forEach(([k, v]) =>
      p.response.headers.set(k, v),
    );
    return p.response;
  }
  const { data, error } = await db.rpc("revoke_platform_story_link", {
    p_id: p.data.id,
  });
  return error || typeof data !== "boolean"
    ? reply({ error: "Chưa thu hồi được link." }, 503)
    : data
      ? reply({ revoked: true })
      : reply({ error: "Link không khả dụng." }, 404);
}
export async function GET(r: NextRequest) {
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return reply({ error: "Unauthorized" }, 401);
  const parsed = z.uuid().safeParse(r.nextUrl.searchParams.get("storyId"));
  if (!parsed.success) return reply({ error: "Truyện không hợp lệ." }, 400);
  const { data, error } = await db.rpc("list_platform_story_links", {
    p_story: parsed.data,
  });
  const list = z.array(StoryLinkMetadata).max(100).safeParse(data);
  return error || !list.success
    ? reply({ error: "Chưa tải được danh sách link." }, 503)
    : reply(list.data);
}
