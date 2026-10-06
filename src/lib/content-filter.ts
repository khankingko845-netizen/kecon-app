/**
 * T19 · Lọc nội dung chế độ bé theo Kiểm soát phụ huynh (pure logic).
 *
 * Parents can block categories and cap the age rating. Before this, both
 * settings were saved but ignored. Kid surfaces (Trang chủ, Thư viện, Yêu
 * thích, Bộ sưu tập) hide such stories and the Player refuses to open them.
 */

export const NO_AGE_LIMIT = 99;

export interface ContentRules {
  is_enabled: boolean;
  blocked_categories: string[];
  max_age_rating: number;
}

export interface StoryLike {
  category?: string | null;
  target_age_min?: number | null;
}

function active(rules: ContentRules | null | undefined): rules is ContentRules {
  return Boolean(rules?.is_enabled);
}

export function isCategoryAllowed(category: string | null | undefined, rules: ContentRules | null | undefined): boolean {
  if (!active(rules) || !category) return true;
  return !rules.blocked_categories.includes(category);
}

/** A story is too old when its youngest target age is above the parent's cap. */
export function isAgeAllowed(targetAgeMin: number | null | undefined, rules: ContentRules | null | undefined): boolean {
  if (!active(rules)) return true;
  const cap = Number(rules.max_age_rating);
  if (!Number.isFinite(cap) || cap >= NO_AGE_LIMIT) return true;
  const min = Number(targetAgeMin);
  return !Number.isFinite(min) || min <= cap;
}

export function isStoryAllowed(story: StoryLike | null | undefined, rules: ContentRules | null | undefined): boolean {
  if (!story) return true;
  return isCategoryAllowed(story.category, rules) && isAgeAllowed(story.target_age_min, rules);
}

export function filterAllowed<T>(items: readonly T[], rules: ContentRules | null | undefined, pick: (item: T) => StoryLike = (i) => i as StoryLike): T[] {
  if (!active(rules)) return [...items];
  return items.filter((item) => isStoryAllowed(pick(item), rules));
}

/** Normalise a DB row (nullable arrays/numbers) into rules. */
export function toContentRules(row: { is_enabled?: boolean | null; blocked_categories?: string[] | null; max_age_rating?: number | null } | null): ContentRules | null {
  if (!row) return null;
  return {
    is_enabled: Boolean(row.is_enabled),
    blocked_categories: Array.isArray(row.blocked_categories) ? row.blocked_categories.filter((c) => typeof c === "string") : [],
    max_age_rating:
      row.max_age_rating != null && Number.isFinite(Number(row.max_age_rating)) && Number(row.max_age_rating) > 0
        ? Number(row.max_age_rating)
        : NO_AGE_LIMIT,
  };
}
