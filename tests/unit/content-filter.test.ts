/**
 * T19 · Lọc nội dung chế độ bé: thể loại bị chặn + độ tuổi tối đa.
 */
import { describe, expect, it } from "vitest";
import {
  filterAllowed,
  isAgeAllowed,
  isCategoryAllowed,
  isStoryAllowed,
  NO_AGE_LIMIT,
  toContentRules,
  type ContentRules,
} from "@/lib/content-filter";

const rules = (over: Partial<ContentRules> = {}): ContentRules => ({
  is_enabled: true,
  blocked_categories: ["adventure"],
  max_age_rating: 5,
  ...over,
});

const s = (category: string, target_age_min: number) => ({ category, target_age_min });

describe("content-filter", () => {
  it("tắt kiểm soát / chưa có cài đặt → không lọc gì", () => {
    expect(isStoryAllowed(s("adventure", 12), null)).toBe(true);
    expect(isStoryAllowed(s("adventure", 12), rules({ is_enabled: false }))).toBe(true);
    expect(filterAllowed([s("adventure", 12)], undefined)).toHaveLength(1);
  });

  it("chặn theo thể loại", () => {
    expect(isCategoryAllowed("adventure", rules())).toBe(false);
    expect(isCategoryAllowed("animal", rules())).toBe(true);
    expect(isCategoryAllowed(null, rules())).toBe(true);
  });

  it("độ tuổi: truyện có tuổi nhỏ nhất > mức bố mẹ đặt thì ẩn; 'Tất cả' (99) không giới hạn", () => {
    expect(isAgeAllowed(3, rules())).toBe(true);
    expect(isAgeAllowed(5, rules())).toBe(true);
    expect(isAgeAllowed(6, rules())).toBe(false);
    expect(isAgeAllowed(12, rules({ max_age_rating: NO_AGE_LIMIT }))).toBe(true);
    expect(isAgeAllowed(null, rules())).toBe(true);
  });

  it("filterAllowed giữ thứ tự, hỗ trợ bộ chọn (vd. ScoredStory.story)", () => {
    const list = [s("animal", 3), s("adventure", 3), s("fairy_tale", 7), s("bedtime", 4)];
    expect(filterAllowed(list, rules()).map((x) => x.category)).toEqual(["animal", "bedtime"]);
    const scored = list.map((story, i) => ({ story, score: i }));
    expect(filterAllowed(scored, rules(), (x) => x.story).map((x) => x.score)).toEqual([0, 3]);
    expect(filterAllowed(list, rules())).not.toBe(list);
  });

  it("toContentRules chuẩn hoá dữ liệu DB thiếu/null", () => {
    expect(toContentRules(null)).toBeNull();
    expect(toContentRules({ is_enabled: true, blocked_categories: null, max_age_rating: null })).toEqual({
      is_enabled: true,
      blocked_categories: [],
      max_age_rating: NO_AGE_LIMIT,
    });
    expect(toContentRules({ is_enabled: null, blocked_categories: ["animal"], max_age_rating: 7 })).toEqual({
      is_enabled: false,
      blocked_categories: ["animal"],
      max_age_rating: 7,
    });
  });
});
