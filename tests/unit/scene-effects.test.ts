import { describe, expect, it } from "vitest";
import { EFFECT_LABELS, asEffectType, effectForScene, particleCountFor, type EffectType } from "@/lib/scene-effects";

describe("asEffectType", () => {
  it.each(["rain", "snow", "leaves", "petals", "stars", "fireflies", "bubbles"])("chấp nhận '%s'", (v) => {
    expect(asEffectType(v)).toBe(v);
  });

  it.each([null, undefined, "", "fire", "RAIN"])("trả về null với %s", (v) => {
    expect(asEffectType(v)).toBeNull();
  });

  // Regression: khoá kế thừa từ Object.prototype không được coi là EffectType hợp lệ.
  it.each(["toString", "constructor", "hasOwnProperty"])(
    "trả về null với khoá prototype '%s'",
    (v) => {
      expect(asEffectType(v)).toBeNull();
    }
  );
});

describe("effectForScene", () => {
  it.each<[string, EffectType | null]>([
    ["Trời đổ mưa to, sấm chớp ầm ầm", "rain"],
    ["Bên ngoài tuyết rơi trắng xoá", "snow"],
    ["Mưa tuyết phủ kín mái nhà", "snow"], // tuyết ưu tiên hơn mưa
    ["Đàn đom đóm lập lòe trong đêm", "fireflies"], // đom đóm ưu tiên hơn đêm/sao
    ["Bầu trời đêm đầy sao", "stars"],
    ["Sóng biển vỗ rì rào", "bubbles"],
    ["Cánh hoa anh đào bay trong gió", "petals"],
    ["Khu rừng mùa thu", "leaves"],
    ["A RAINY day", "rain"], // không phân biệt hoa/thường
    ["Bé ngồi ăn cơm cùng bố mẹ", null],
    ["", null],
  ])("'%s' → %s", (text, expected) => {
    expect(effectForScene(text)).toBe(expected);
  });
});

describe("particleCountFor", () => {
  it("mọi hiệu ứng có số hạt dương và giới hạn ≤ 40 (hiệu năng trên mobile)", () => {
    for (const effect of Object.keys(EFFECT_LABELS) as EffectType[]) {
      const n = particleCountFor(effect);
      expect(n, effect).toBeGreaterThan(0);
      expect(n, effect).toBeLessThanOrEqual(40);
    }
  });
});
