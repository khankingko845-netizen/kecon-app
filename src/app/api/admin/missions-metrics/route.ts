import { auditAdmin } from "@/lib/admin-audit";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/admin-permissions";

/** G-10 · weekly missions metrics + guardrails (aggregates only, migration 038). */
export async function GET(request: Request) {
  const db = await createClient();
  const denied = await requirePermission(db, "analytics.view");
  if (denied) return denied;
  const raw = new URL(request.url).searchParams.get("weeks") ?? "8";
  if (!/^(?:[1-9]|1[0-2])$/.test(raw))
    return Response.json({ error: "Invalid period" }, { status: 400 });
  const auditFailed = await auditAdmin(db, request, {
    action: "missions_metrics.view",
    targetType: "measurement",
    after: { weeks: Number(raw) },
  });
  if (auditFailed) return auditFailed;
  const { data, error } = await db.rpc("missions_weekly_summary", {
    p_weeks: Number(raw),
  });
  return Response.json(
    error
      ? { error: "Không tải được số liệu Bầu trời của Đóm. Kiểm tra migration 038." }
      : data,
    {
      status: error ? 503 : 200,
      headers: { "Cache-Control": "private, no-store" },
    },
  );
}
