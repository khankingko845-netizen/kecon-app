/**
 * Admin v2 · A-04 — API key hệ thống nằm trong Supabase Vault (migration 021).
 *
 * Shared by the browser and the server — no server-only imports here.
 * - The browser only ever WRITES keys (`set_system_secret`) and reads their
 *   status (`list_system_secrets`: set or not + last 4 chars). Values never
 *   come back.
 * - Only the server (service role) reads a key: `get_system_secret`, in
 *   src/lib/server-settings.ts.
 */

/** `app_settings` rows that hold an API key (flagged `is_secret`): every `*_api_key` + the custom provider key. */
export const SECRET_SETTING_PATTERN = /(_api_key|_provider_key)$/;

export function isSecretSettingKey(key: string): boolean {
  return SECRET_SETTING_PATTERN.test(key);
}

/** One row of `list_system_secrets()` — never contains the key itself. */
export interface SystemSecretStatus {
  key: string;
  label: string | null;
  category: string | null;
  is_set: boolean;
  /** Last 4 characters, only stored for keys of 12+ characters. */
  last4: string | null;
  updated_at: string | null;
  updated_by_email: string | null;
}

/** Return value of `set_system_secret()`. */
export interface SetSystemSecretResult {
  key: string;
  is_set: boolean;
  last4: string | null;
  updated_at: string | null;
}

/** "Đã đặt · …abcd" / "Đã đặt" / "Chưa đặt". */
export function secretStatusText(status: Pick<SystemSecretStatus, "is_set" | "last4"> | undefined): string {
  if (!status?.is_set) return "Chưa đặt";
  return status.last4 ? `Đã đặt · …${status.last4}` : "Đã đặt";
}

/**
 * Remove an API key (and anything that looks like one) from a provider error
 * message before it goes back to the browser — e.g. OpenAI echoes part of a
 * wrong key in "Incorrect API key provided: sk-ab…".
 */
export function scrubSecret(message: string, key?: string): string {
  let out = message;
  if (key && key.length >= 4) out = out.split(key).join("[đã ẩn]");
  return out.replace(/\b(sk|rk|pk|xi|sess)[-_][A-Za-z0-9_\-*]{4,}|\bAIza[A-Za-z0-9_\-*]{4,}/g, "[đã ẩn]");
}
