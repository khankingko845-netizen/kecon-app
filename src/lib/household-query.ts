import type { SupabaseClient } from "@supabase/supabase-js";
import { HouseholdContextSchema } from "@/lib/household-types";
/** Fresh actor-bound context per operation; no module/global tenant cache. */
export async function requireHouseholdId(db: SupabaseClient): Promise<string> {
  const { data, error } = await db.rpc("my_household_context");
  const parsed = HouseholdContextSchema.safeParse(data);
  if (error || !parsed.success) throw new Error("Hộ gia đình chưa sẵn sàng");
  return parsed.data.household_id;
}
