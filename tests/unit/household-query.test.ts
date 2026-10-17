import type { SupabaseClient } from "@supabase/supabase-js";
import { it, expect, vi } from "vitest";
import { requireHouseholdId } from "@/lib/household-query";
const h = "00000000-0000-4000-8000-000000000001";
const db = (data: unknown, error: unknown = null) =>
  ({ rpc: vi.fn(async () => ({ data, error })) }) as unknown as SupabaseClient;
it("uses only the strict actor-bound household RPC", async () => {
  const d = db({ household_id: h, role: "owner" });
  expect(await requireHouseholdId(d)).toBe(h);
  expect(d.rpc).toHaveBeenCalledWith("my_household_context");
});
it("fails closed on bad scope or backend failure, without private detail", async () => {
  for (const d of [
    db(null),
    db({ household_id: "other", role: "owner" }),
    db({ household_id: h, role: "owner", email: "private" }),
    db({ household_id: h, role: "owner" }, { message: "secret" }),
  ])
    await expect(requireHouseholdId(d)).rejects.toThrow(
      "Hộ gia đình chưa sẵn sàng",
    );
});
it("does not reuse context across operations or actors", async () => {
  const d = db({ household_id: h, role: "owner" });
  await requireHouseholdId(d);
  await requireHouseholdId(d);
  expect(d.rpc).toHaveBeenCalledTimes(2);
});
