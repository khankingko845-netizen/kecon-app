export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
export const AVATAR_BUCKET = "family-avatars";
export const AVATAR_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const avatarUrl = (id: string) => `/api/profile/avatar/${id}`;
export function avatarIdFromUrl(url?: string | null): string | null {
  const id = url?.startsWith("/api/profile/avatar/")
    ? url.slice("/api/profile/avatar/".length)
    : null;
  return id && AVATAR_ID.test(id) ? id : null;
}
