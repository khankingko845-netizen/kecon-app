/**
 * "Hồ sơ gia đình" form → `profiles` update payload.
 *
 * `family_name` / `display_name` are `NOT NULL DEFAULT ''` in the schema
 * (001_initial_schema.sql), so empty inputs must be sent as "" — sending
 * `null` made PostgREST reject the whole update (23502) and the child's age
 * was silently not saved.
 */
export interface ProfileForm {
  displayName: string;
  familyName: string;
  avatarEmoji: string;
  childAge: string;
  locale: string;
}

export interface ProfileUpdate {
  display_name: string;
  family_name: string;
  avatar_emoji: string;
  child_age: number | null;
  locale: string;
}

export function buildProfileUpdate(form: ProfileForm): ProfileUpdate {
  const age = Number.parseInt(form.childAge, 10);
  return {
    display_name: form.displayName.trim(),
    family_name: form.familyName.trim(),
    avatar_emoji: form.avatarEmoji,
    child_age: Number.isInteger(age) && age >= 1 && age <= 12 ? age : null,
    locale: form.locale || "vi",
  };
}
