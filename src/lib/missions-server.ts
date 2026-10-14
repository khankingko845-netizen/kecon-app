/**
 * Server-side validation for the missions RPCs (migration 034). Route
 * handlers only — keeps zod out of the client bundle. Malformed RPC output is
 * treated as "unavailable" (503) instead of being passed to the child UI.
 */
import { z } from "zod";
import type {
  CompleteResult,
  ConfirmResult,
  MissionsAlbum,
  MissionsToday,
  ParentNotify,
  ParentWeek,
  StartResult,
  TogetherResult,
} from "@/lib/missions";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const count = z.number().int().min(0);
const sticker = z.object({
  story_id: z.uuid(),
  title: z.string().max(300).nullable(),
  cover_image_url: z.string().max(2048).nullable(),
  earned_on: day.optional(),
});

const templateId = z.string().regex(/^[a-z0-9-]{3,40}$/);
const copy = (max: number) => z.string().min(1).max(max);
const habitKind = z.enum(["habit", "kindness"]);
const family = z.object({
  id: templateId,
  title: copy(60),
  target: z.number().int().min(1).max(7),
  progress: z.number().int().min(0).max(7),
  done: z.boolean(),
});

export const MissionsTodaySchema = z.object({
  date: day,
  missions: z.array(z.object({ id: templateId, done: z.boolean() })).max(10),
  // Added in migration 036; older databases simply have none.
  habits: z.array(z.object({ id: templateId, kind: habitKind, title: copy(60), line: copy(160) })).max(30).default([]),
  family: family.nullable().default(null),
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
  constellations: z.array(z.object({ week_start: day, earned_on: day })).max(600).default([]),
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

// ── G-06 / G-07: the parent's week ─────────────────────────────────────────
const notify = z.object({ enabled: z.boolean(), hour: z.number().int().min(6).max(21), devices: count }) satisfies z.ZodType<ParentNotify>;

export const ParentWeekSchema = z.object({
  summary: MissionsTodaySchema,
  stories: z
    .array(
      z.object({
        session_id: z.uuid(),
        story_id: z.uuid().nullable(),
        title: z.string().max(300).nullable(),
        category: z.string().max(60).nullable(),
        date: day,
        together: z.boolean(),
        prompt: z.string().max(200).nullable(),
      }),
    )
    .max(30),
  habits: z
    .array(
      z.object({
        id: templateId,
        kind: habitKind,
        title: copy(60),
        label: copy(120),
        prompt: z.string().max(200).nullable(),
        today: z.boolean(),
        week: z.number().int().min(0).max(7),
      }),
    )
    .max(30),
  family: family.extend({ label: copy(120) }).nullable(),
  notify,
}) satisfies z.ZodType<ParentWeek>;

export const ConfirmResultSchema = z.object({
  confirmed: z.boolean(),
  kind: habitKind,
  star: z.boolean().default(false),
  line: copy(160).nullable().default(null),
  reason: z.literal("already_confirmed").optional(),
}) satisfies z.ZodType<ConfirmResult>;

export const TogetherResultSchema = z.object({
  marked: z.boolean(),
  progress: z.number().int().min(0).max(7),
  target: z.number().int().min(1).max(7),
  done: z.boolean(),
  constellation: z.boolean(),
  line: copy(160).nullable(),
}) satisfies z.ZodType<TogetherResult>;

export const NotifyResultSchema = notify;
export const DeviceResultSchema = z.object({ devices: count });

/** The raw proof from open_parent_gate (64 hex chars); only its hash is stored. */
const proof = z.string().regex(/^[0-9a-f]{64}$/);
const endpoint = z.url({ protocol: /^https$/ }).max(2048);

export const ParentBodySchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("confirm"), proof, templateId }),
  z.strictObject({ action: z.literal("together"), proof, sessionId: z.uuid() }),
  z.strictObject({ action: z.literal("notify"), proof, enabled: z.boolean(), hour: z.number().int().min(6).max(21) }),
  z.strictObject({
    action: z.literal("device"),
    proof,
    endpoint,
    p256dh: z.string().regex(/^[A-Za-z0-9_=-]{80,100}$/),
    auth: z.string().regex(/^[A-Za-z0-9_=-]{16,32}$/),
  }),
  z.strictObject({ action: z.literal("device-remove"), endpoint }),
]);
export type ParentBody = z.infer<typeof ParentBodySchema>;

export const NO_STORE = { "Cache-Control": "private, no-store", Vary: "Cookie" } as const;

/** Map Postgres SQLSTATE from the RPC to an HTTP answer without leaking details. */
export function missionsError(error: { code?: string } | null | undefined): Response {
  const code = error?.code;
  // 28000: the parent proof is missing/expired → the client asks for the PIN again.
  if (code === "28000")
    return Response.json({ error: "Cần nhập lại mã PIN phụ huynh", code: "parent_proof" }, { status: 403, headers: NO_STORE });
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
