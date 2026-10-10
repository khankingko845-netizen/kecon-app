/**
 * Persistence rules for client settings (T05).
 *
 * Provider API keys are secrets: they live in memory only (lost on reload)
 * and are never written to localStorage. Older app versions stored them in
 * `kecon-settings`; `readPersistedSettings()` strips them and reports it so
 * the caller can rewrite storage without the keys.
 */
export const SETTINGS_STORAGE_KEY = "kecon-settings";

export const SECRET_SETTING_FIELDS = ["elevenLabsApiKey", "storyApiKey"] as const;
export type SecretSettingField = (typeof SECRET_SETTING_FIELDS)[number];

export function stripSecrets<T extends object>(settings: T): Omit<T, SecretSettingField> {
  const copy = { ...settings } as Record<string, unknown>;
  for (const field of SECRET_SETTING_FIELDS) delete copy[field];
  return copy as Omit<T, SecretSettingField>;
}

export function readPersistedSettings<T extends object>(
  raw: string | null,
  defaults: T
): { settings: T; hadSecrets: boolean } {
  if (!raw) return { settings: defaults, hadSecrets: false };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { settings: defaults, hadSecrets: false };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { settings: defaults, hadSecrets: false };
  }
  const record = parsed as Record<string, unknown>;
  const hadSecrets = SECRET_SETTING_FIELDS.some((f) => f in record);
  return { settings: { ...defaults, ...stripSecrets(record) }, hadSecrets };
}

export function serializeSettings<T extends object>(settings: T): string {
  return JSON.stringify(stripSecrets(settings));
}
