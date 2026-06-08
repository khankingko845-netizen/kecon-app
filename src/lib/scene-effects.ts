// Context-aware visual effects matched from a story page's scene description /
// text. Pure heuristic — no API key required. Mirrors the ambient-audio matcher
// in StoryPlayer so visuals and sound stay in sync.

export type EffectType =
  | "rain"
  | "snow"
  | "leaves"
  | "petals"
  | "stars"
  | "fireflies"
  | "bubbles";

export const EFFECT_LABELS: Record<EffectType, string> = {
  rain: "Mưa rơi",
  snow: "Tuyết rơi",
  leaves: "Lá rơi",
  petals: "Cánh hoa",
  stars: "Sao lấp lánh",
  fireflies: "Đom đóm",
  bubbles: "Bong bóng",
};

// Narrow an arbitrary stored string to a valid EffectType (or null).
export function asEffectType(value: string | null | undefined): EffectType | null {
  if (!value) return null;
  return value in EFFECT_LABELS ? (value as EffectType) : null;
}

// Pick a visual effect from free text (scene description + page content).
export function effectForScene(text: string): EffectType | null {
  const t = text.toLowerCase();
  if (/tuyết|snow|băng giá|mùa đông lạnh|giáng sinh/.test(t)) return "snow";
  if (/mưa|rain|giông|bão|mây đen/.test(t)) return "rain";
  if (/đom đóm|firefly|fireflies|lập lòe/.test(t)) return "fireflies";
  if (/sao|trăng|đêm|tối|star|moon|night|bầu trời/.test(t)) return "stars";
  if (/biển|sóng|đại dương|nước|hồ|suối|sea|ocean|wave|bong bóng|bubble/.test(t))
    return "bubbles";
  if (/hoa|cánh hoa|anh đào|blossom|petal|hoa rơi|mùa xuân/.test(t))
    return "petals";
  if (/lá|rừng|cây|mùa thu|leaf|leaves|autumn|vườn/.test(t)) return "leaves";
  return null;
}

// Number of particles to render for each effect (kept modest for performance).
export function particleCountFor(effect: EffectType): number {
  switch (effect) {
    case "rain":
      return 40;
    case "snow":
      return 28;
    case "stars":
      return 30;
    case "fireflies":
      return 16;
    case "bubbles":
      return 18;
    case "leaves":
    case "petals":
      return 18;
    default:
      return 20;
  }
}
