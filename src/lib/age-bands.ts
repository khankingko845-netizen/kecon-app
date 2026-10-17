/**
 * Age bands (UI-13) — KểCon "lớn cùng bé".
 *
 * Product decision: launch focused on 3–5 (default), then follow the child
 * through 6–8 and 9–12. Each band tweaks tone, story length and visuals.
 * Legacy values persisted by older versions ("2-3", "4-6", "7-9", "10+") are
 * mapped to the closest band so existing users keep a sensible setting.
 */
export const AGE_BANDS = [
  {
    id: "3-5",
    label: "3–5 tuổi",
    short: "Mầm",
    min: 3,
    max: 5,
    /** Typical narration length, minutes. */
    minutes: [3, 5] as const,
    /** Story pages requested from the LLM. */
    pages: [6, 8] as const,
    tone: "câu ngắn, lặp lại, từ ngữ đơn giản, nhiều âm thanh vui",
  },
  {
    id: "6-8",
    label: "6–8 tuổi",
    short: "Chồi",
    min: 6,
    max: 8,
    minutes: [5, 8] as const,
    pages: [8, 10] as const,
    tone: "cốt truyện rõ ràng, có thử thách nhỏ, từ vựng mới vừa phải",
  },
  {
    id: "9-12",
    label: "9–12 tuổi",
    short: "Lá",
    min: 9,
    max: 12,
    minutes: [8, 12] as const,
    pages: [10, 12] as const,
    tone: "nhiều chi tiết, nhân vật có chiều sâu, khuyến khích suy nghĩ",
  },
] as const;

export type AgeBand = (typeof AGE_BANDS)[number];
export type AgeBandId = AgeBand["id"];

export const DEFAULT_AGE_BAND: AgeBandId = "3-5";

const BAND_IDS = new Set<string>(AGE_BANDS.map((b) => b.id));

/** Map any stored/legacy age value (band id, "4-6", "10+", "7") to a band id. */
export function normalizeAgeBand(value: string | number | null | undefined): AgeBandId {
  if (value === null || value === undefined || value === "") return DEFAULT_AGE_BAND;
  const raw = String(value).trim();
  if (BAND_IDS.has(raw)) return raw as AgeBandId;
  const nums = raw.match(/\d+/g)?.map(Number) ?? [];
  if (nums.length === 0) return DEFAULT_AGE_BAND;
  // Use the midpoint of a range ("4-6" → 5), or the single age ("10+" → 10).
  const age = nums.length >= 2 ? (nums[0] + nums[1]) / 2 : nums[0];
  if (age < 6) return "3-5";
  if (age < 9) return "6-8";
  return "9-12";
}

export function getAgeBand(value: string | number | null | undefined): AgeBand {
  const id = normalizeAgeBand(value);
  return AGE_BANDS.find((b) => b.id === id) ?? AGE_BANDS[0];
}
