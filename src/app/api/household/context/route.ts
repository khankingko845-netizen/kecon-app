import { HouseholdContextSchema } from "@/lib/household-types";
import { createClient } from "@/lib/supabase/server";
/** T08a identity only: no membership mutation, invitation, tenant switching or ACL widening. */
export async function GET() {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "private, no-store" } });
  const { data, error } = await db.rpc("my_household_context");
  const parsed = HouseholdContextSchema.safeParse(data);
  return Response.json(error || !parsed.success ? { error: "Hộ gia đình chưa sẵn sàng" } : parsed.data, { status: error || !parsed.success ? 503 : 200, headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
}
