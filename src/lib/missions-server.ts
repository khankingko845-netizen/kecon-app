/**
 * Server-side validation for the missions RPCs (migration 034). Route
 * handlers only — keeps zod out of the client bundle. Malformed RPC output is
 * treated as "unavailable" (503) instead of being passed to the child UI.
 */
import { z } from "zod";
import type { CompleteResult, MissionsAlbum, MissionsToday, StartResult } from "@/lib/missions";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const count = z.number().int().min(0);
const sticker = z.object({
  story_id: z.uuid(),
  title: z.string().max(300).nullable(),
  cover_image_url: z.string().max(2048).nullable(),
  earned_on: day.optional(),
});

export const MissionsTodaySchema = z.object({
  date: day,
  missions: z.array(z.object({ id: z.string().regex(/^[a-z0-9-]{3,40}$/), done: z.boolean() })).max(10),
  week: z.object({
    start: day,
    goal: z.number().int().min(1).max(7),
    nights: z.number().int().min(0).max(7),
    days: z.array(z.object({ date: day, stars: count, listened: z.boolean() })).length(7),
  }),
  totals: z.object({ stories: count, stars: count, stickers: count }),
}) satisfies z.ZodType<MissionsToday>;

export const MissionsAlbumSchema = z.object({
  stickers: z.array(sticker).max(1000),
  milestones: z.array(z.number().int().positive()).max(50),
}) satisfies z.ZodType<MissionsAlbum>;

export const StartResultSchema = z.object({
  session_id: z.uuid(),
  min_seconds: z.number().int().min(15).max(900),
}) satisfies z.ZodType<StartResult>;

export const CompleteResultSchema = z
  .object({
    counted: z.boolean(),
    reason: z.enum(["too_fast", "expired", "already_completed"]).optional(),
    completed: z.array(z.string()).max(10).optional(),
    sticker: sticker.nullable().optional(),
    milestone: z.number().int().positive().nullable().optional(),
    today: MissionsTodaySchema.nullable().optional(),
  })
  .transform(
    (r): CompleteResult => ({
      counted: r.counted,
      ...(r.reason ? { reason: r.reason } : {}),
      completed: r.completed ?? [],
      sticker: r.sticker ?? null,
      milestone: r.milestone ?? null,
      today: r.today ?? null,
    }),
  );

export const ListenBodySchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("start"), storyId: z.uuid() }),
  z.strictObject({ action: z.literal("complete"), sessionId: z.uuid() }),
]);

export const NO_STORE = { "Cache-Control": "private, no-store", Vary: "Cookie" } as const;

/** Map Postgres SQLSTATE from the RPC to an HTTP answer without leaking details. */
export function missionsError(error: { code?: string } | null | undefined): Response {
  const code = error?.code;
  const [status, message] =
    code === "42501"
      ? [404, "Not found"]
      : code === "22023"
        ? [400, "Không tìm thấy truyện hoặc phiên nghe"]
        : code === "54000"
          ? [429, "Hôm nay đã mở rất nhiều truyện, mình nghỉ chút nhé"]
          : [503, "Bầu trời của Đóm chưa sẵn sàng, thử lại sau nhé"];
  return Response.json({ error: message }, { status, headers: NO_STORE });
}
