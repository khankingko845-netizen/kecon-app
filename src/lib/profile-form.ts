/**
 * "Hồ sơ gia đình" form → `profiles` update payload.
 *
 * `family_name` / `display_name` are `NOT NULL DEFAULT ''` in the schema
 * (001_initial_schema.sql), so empty inputs must be sent as "" — sending
 * `null` made PostgREST reject the whole update (23502).
 * T10: the child's name/age live in "Hồ sơ bé" (child_profiles), never here.
 */
export interface ProfileForm {
  displayName: string;
  familyName: string;
  avatarEmoji: string;
  avatarUrl?: string | null;
  locale: string;
}

export interface ProfileUpdate {
  display_name: string;
  family_name: string;
  avatar_emoji: string | null;
  avatar_url?: string | null;
  locale: string;
}

export function buildProfileUpdate(form: ProfileForm): ProfileUpdate {
  return {
    display_name: form.displayName.trim(),
    family_name: form.familyName.trim(),
    avatar_emoji: form.avatarUrl ? null : form.avatarEmoji,
    ...(form.avatarUrl !== undefined ? { avatar_url: form.avatarUrl } : {}),
    locale: form.locale || "vi",
  };
}
