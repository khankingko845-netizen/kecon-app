import { z } from "zod";
/** Expand contract only; no invitations, active-tenant switch or child accounts yet. */
export const HouseholdContextSchema = z.strictObject({
  household_id: z.uuid(),
  role: z.enum(["owner", "parent"]),
});
export type HouseholdContext = z.infer<typeof HouseholdContextSchema>;
