import { describe, expect, it } from "vitest";
import { AMBIENT_CATEGORIES, getAmbientCategory, matchAmbientCategory } from "@/lib/ambient-sounds";

describe("AMBIENT_CATEGORIES", () => {
  it("mỗi danh mục có id duy nhất, từ khoá và prompt sinh âm thanh", () => {
    const ids = AMBIENT_CATEGORIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of AMBIENT_CATEGORIES) {
      expect(c.keywords.length, c.id).toBeGreaterThan(0);
      expect(c.prompt.trim(), c.id).not.toBe("");
    }
  });
});

describe("matchAmbientCategory", () => {
  it.each([
    ["Những tán cây trong khu rừng", "forest"],
    ["Đêm trăng yên tĩnh", "night"],
    ["Con thuyền nhỏ ra khơi giữa biển", "ocean"],
    ["Cơn mưa rơi tí tách", "rain"],
    ["Nàng công chúa sống trong lâu đài", "castle"],
    ["Bà tiên vung đũa phép", "magic"],
    ["THE CASTLE OF THE KING", "castle"], // không phân biệt hoa/thường
  ])("'%s' → %s", (scene, expected) => {
    expect(matchAmbientCategory(scene)).toBe(expected);
  });

  it("từ khoá dài/cụ thể thắng từ khoá ngắn chung chung", () => {
    // castle: "công chúa" (9 ký tự) vs forest: "vườn" (4 ký tự)
    expect(matchAmbientCategory("Công chúa đi dạo trong vườn")).toBe("castle");
  });

  it("không khớp hoặc rỗng → null", () => {
    expect(matchAmbientCategory("")).toBeNull();
    expect(matchAmbientCategory("xyz 123")).toBeNull();
  });

  // BUG (mức độ thấp, UX): so khớp substring không theo ranh giới từ, nên từ khoá
  // ngắn "ma" (con ma) khớp "mai", "mama", "romantic"… → phát âm thanh hồi hộp
  // (tim đập, cửa kẽo kẹt) cho cảnh bình thường.
  it("'Sáng mai bé đi học' không bị gán âm thanh hồi hộp", () => {
    expect(matchAmbientCategory("Sáng mai bé đi học")).not.toBe("suspense");
  });
});

describe("getAmbientCategory", () => {
  it("trả danh mục theo id, undefined nếu không tồn tại", () => {
    expect(getAmbientCategory("ocean")?.label).toBe("Biển cả");
    expect(getAmbientCategory("does-not-exist")).toBeUndefined();
  });
});
