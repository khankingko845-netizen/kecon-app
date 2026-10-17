import { createClient } from "@/lib/supabase/server";
import {
  ConfirmResultSchema,
  DeviceResultSchema,
  NO_STORE,
  NotifyResultSchema,
  ParentBodySchema,
  ParentWeekSchema,
  TogetherResultSchema,
  missionsError,
  type ParentBody,
} from "@/lib/missions-server";

/**
 * G-06 / G-07 "Tuần của bé" (behind the parent gate, flag `missions`).
 * GET: the week for the parent. POST: parent actions — each carries the proof
 * minted by the PIN (open_parent_gate) and the database rechecks it.
 */

/** Reminders need a VAPID key pair on this server (read at runtime, never inlined). */
function pushPublicKey(): string | null {
  const env = process.env;
  const pub = env["VAPID_PUBLIC_KEY"] || env["NEXT_PUBLIC_VAPID_PUBLIC_KEY"];
  return pub && env["VAPID_PRIVATE_KEY"] ? pub : null;
}

export async function GET() {
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  const { data, error } = await db.rpc("missions_parent_week");
  if (error) return missionsError(error);
  const parsed = ParentWeekSchema.safeParse(data);
  if (!parsed.success) return missionsError(null);
  return Response.json({ ...parsed.data, push: { publicKey: pushPublicKey() } }, { headers: NO_STORE });
}

const INVALID: Record<ParentBody["action"], string> = {
  confirm: "Thói quen này chưa mở hoặc không còn dùng",
  together: "Chỉ đánh dấu được truyện bé đã nghe xong trong tuần này",
  notify: "Giờ nhắc không hợp lệ",
  device: "Máy này đang nhận thông báo của bé nên không đăng ký làm máy bố mẹ được",
  "device-remove": "Không tìm thấy máy",
};

function call(db: Awaited<ReturnType<typeof createClient>>, body: ParentBody) {
  switch (body.action) {
    case "confirm":
      return { schema: ConfirmResultSchema, run: db.rpc("missions_confirm", { p_proof: body.proof, p_template: body.templateId }) };
    case "together":
      return { schema: TogetherResultSchema, run: db.rpc("missions_mark_together", { p_proof: body.proof, p_session: body.sessionId }) };
    case "notify":
      return {
        schema: NotifyResultSchema,
        run: db.rpc("parent_notify_set", { p_proof: body.proof, p_enabled: body.enabled, p_hour: body.hour }),
      };
    case "device":
      return {
        schema: DeviceResultSchema,
        run: db.rpc("parent_device_register", { p_proof: body.proof, p_endpoint: body.endpoint, p_p256dh: body.p256dh, p_auth: body.auth }),
      };
    case "device-remove":
      return { schema: DeviceResultSchema, run: db.rpc("parent_device_remove", { p_endpoint: body.endpoint }) };
  }
}

export async function POST(request: Request) {
  if (request.headers.get("sec-fetch-site") === "cross-site")
    return Response.json({ error: "Forbidden" }, { status: 403, headers: NO_STORE });
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  const body = ParentBodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Invalid request" }, { status: 400, headers: NO_STORE });
  const { schema, run } = call(db, body.data);
  const { data, error } = await run;
  if (error?.code === "22023") return Response.json({ error: INVALID[body.data.action] }, { status: 400, headers: NO_STORE });
  if (error) return missionsError(error);
  const parsed = schema.safeParse(data);
  return parsed.success ? Response.json(parsed.data, { headers: NO_STORE }) : missionsError(null);
}
