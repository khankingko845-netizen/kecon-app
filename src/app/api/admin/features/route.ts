import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/admin-permissions";
import { FEATURES } from "@/lib/feature-flags";
import { z } from "zod";
const Body = z.strictObject({
  name: z.enum(FEATURES.map((f) => f.key)),
  enabled: z.boolean(),
  expected: z.boolean(),
  reason: z.string().trim().min(10).max(500),
});
export async function POST(request: Request) {
  if (request.headers.get("sec-fetch-site") === "cross-site")
    return Response.json({ error: "Forbidden" }, { status: 403 });
  const db = await createClient();
  const denied = await requirePermission(db, "settings.write");
  if (denied) return denied;
  const b = Body.safeParse(await request.json().catch(() => null));
  if (!b.success)
    return Response.json({ error: "Flag/lý do không hợp lệ" }, { status: 400 });
  // audit: db-trigger app_settings (dedicated audit_feature_settings logs exactly once atomically)
  const { data, error } = await db.rpc("set_feature_flag", {
    p_name: b.data.name,
    p_enabled: b.data.enabled,
    p_expected: b.data.expected,
    p_reason: b.data.reason,
  });
  return Response.json(
    error
      ? { error: "Không đổi được flag; tải lại để kiểm tra" }
      : { ok: true, changed: data },
    {
      status: error ? (error.code === "40001" ? 409 : 503) : 200,
      headers: { "Cache-Control": "private, no-store" },
    },
  );
}
