/** Family portraits reuse Đóm's bundled art: no upload, migration or extra image requests. */
export const FAMILY_AVATARS = [
  { id: "hello", label: "Đóm chào", src: "/mascot/dom-hello.webp", tint: "#EEE9FF", rim: "#D8CFFC" },
  { id: "happy", label: "Đóm vui", src: "/mascot/dom-happy.webp", tint: "#FFF0CC", rim: "#F3D996" },
  { id: "story", label: "Đóm kể chuyện", src: "/mascot/dom-story.webp", tint: "#E4F3ED", rim: "#BFDFD0" },
  { id: "sleepy", label: "Đóm ngủ ngon", src: "/mascot/dom-sleepy.webp", tint: "#E9E7FA", rim: "#CEC8EC" },
  { id: "listen", label: "Đóm lắng nghe", src: "/mascot/dom-listen.webp", tint: "#FCE8DF", rim: "#F1CFBE" },
  { id: "celebrate", label: "Đóm rực rỡ", src: "/mascot/dom-celebrate.webp", tint: "#FFF1D2", rim: "#EED99F" },
] as const;

export type FamilyAvatarPreset = (typeof FAMILY_AVATARS)[number];

/** Legacy emoji stays in the database until the family saves a new choice. */
export function familyAvatarFor(url?: string | null, emoji?: string | null): FamilyAvatarPreset {
  const preset = FAMILY_AVATARS.find((a) => a.src === url);
  if (preset) return preset;
  const legacy: Record<string, FamilyAvatarPreset["id"]> = {
    "🐰": "happy", "🦊": "story", "🦁": "celebrate", "🐯": "celebrate",
  };
  return FAMILY_AVATARS.find((a) => a.id === legacy[emoji ?? ""]) ?? FAMILY_AVATARS[0];
}

/** Preserve existing uploaded/profile photos, but never request arbitrary schemes. */
export function customAvatarUrl(value?: string | null): string | null {
  if (!value || FAMILY_AVATARS.some((a) => a.src === value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}
