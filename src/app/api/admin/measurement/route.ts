import { auditAdmin } from "@/lib/admin-audit";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/admin-permissions";
export async function GET(request: Request) {
  const db = await createClient();
  const denied = await requirePermission(db, "analytics.view");
  if (denied) return denied;
  const raw = new URL(request.url).searchParams.get("days") ?? "14";
  if (!/^(?:[1-9]|[12][0-9]|30)$/.test(raw))
    return Response.json({ error: "Invalid period" }, { status: 400 });
  const auditFailed = await auditAdmin(db, request, {
    action: "measurement.view",
    targetType: "measurement",
    after: { days: Number(raw) },
  });
  if (auditFailed) return auditFailed;
  // bounded aggregate, contains no individual user/voice/story identity
  const { data, error } = await db.rpc("measurement_summary", {
    p_days: Number(raw),
  });
  return Response.json(
    error
      ? { error: "Không tải được đo lường. Kiểm tra migration 027." }
      : data,
    {
      status: error ? 503 : 200,
      headers: { "Cache-Control": "private, no-store" },
    },
  );
}
