import type { SupabaseClient } from "@supabase/supabase-js";
export type AdminAccessState =
  | "ready"
  | "mfa_required"
  | "session_required"
  | "session_expired"
  | "forbidden"
  | "unavailable";
export interface AdminAccess {
  state: AdminAccessState;
  requires_mfa: boolean;
  expires_at: string | null;
}
export const UNAVAILABLE_ACCESS: AdminAccess = {
  state: "unavailable",
  requires_mfa: true,
  expires_at: null,
};
export function parseAdminAccess(value: unknown): AdminAccess {
  if (!value || typeof value !== "object") return UNAVAILABLE_ACCESS;
  const v = value as Record<string, unknown>;
  if (
    ![
      "ready",
      "mfa_required",
      "session_required",
      "session_expired",
      "forbidden",
    ].includes(String(v.state)) ||
    typeof v.requires_mfa !== "boolean"
  )
    return UNAVAILABLE_ACCESS;
  if (
    v.state === "ready" &&
    (typeof v.expires_at !== "string" ||
      !Number.isFinite(Date.parse(v.expires_at)))
  )
    return UNAVAILABLE_ACCESS;
  return {
    state: v.state as AdminAccessState,
    requires_mfa: v.requires_mfa,
    expires_at: v.state === "ready" ? (v.expires_at as string) : null,
  };
}
export async function adminAccess(
  client: SupabaseClient,
  rpc = "admin_access_status",
): Promise<AdminAccess> {
  try {
    const { data, error } = await client.rpc(rpc);
    return error ? UNAVAILABLE_ACCESS : parseAdminAccess(data);
  } catch {
    return UNAVAILABLE_ACCESS;
  }
}
