import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/admin-permissions";
import { PriceSchema } from "@/lib/measurement-types";
export async function POST(request: Request) {
  if(request.headers.get("sec-fetch-site")==="cross-site")return Response.json({error:"Forbidden"},{status:403});
  const db = await createClient();
  const denied = await requirePermission(db, "settings.write");
  if (denied) return denied;
  const parsed = PriceSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json({ error: "Đơn giá không hợp lệ" }, { status: 400 });
  const v = parsed.data;
  // audit: db-trigger ai_price_rates (set_ai_price writes audit atomically; direct writes are revoked)
  const { error } = await db.rpc("set_ai_price", {
    p_provider: v.provider,
    p_model: v.model,
    p_kind: v.kind,
    p_input: v.input,
    p_output: v.output,
    p_unit: v.unit,
    p_source: v.source,
  });
  return Response.json(
    error ? { error: "Không lưu được đơn giá" } : { ok: true },
    {
      status: error ? 503 : 200,
      headers: { "Cache-Control": "private, no-store" },
    },
  );
}
