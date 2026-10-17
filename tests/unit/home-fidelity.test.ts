import { describe, expect, it } from "vitest";
import { heroFor } from "@/lib/home-hero";
import { LAST_PLAYED_KEY, lastPlayedProgress, readLastPlayed } from "@/lib/last-played";

describe("Home hero (concept board — Home bé)", () => {
  it("đổi câu hỏi + tư thế Đóm theo giờ", () => {
    expect(heroFor(9)).toMatchObject({ title: "Sáng nay bé muốn nghe truyện gì?", mascot: "hello", lullaby: false });
    expect(heroFor(14)).toMatchObject({ title: "Chiều nay cùng Đóm phiêu lưu nhé?", mascot: "happy" });
    expect(heroFor(19)).toMatchObject({ title: "Tối nay mình nghe truyện gì nhỉ?", mascot: "story" });
    expect(heroFor(23).mascot).toBe("story");
  });

  it("sau nửa đêm gợi ý nhạc ru", () => {
    expect(heroFor(0)).toMatchObject({ mascot: "sleepy", lullaby: true, cta: "Nghe nhạc ru" });
    expect(heroFor(5).lullaby).toBe(true);
    expect(heroFor(6).lullaby).toBe(false);
  });

  it("CTA mặc định là 'Đóm gợi ý cho bé'", () => {
    for (const h of [7, 12, 20]) expect(heroFor(h).cta).toBe("Đóm gợi ý cho bé");
  });
});

describe("Nghe tiếp (last-played)", () => {
  it("dùng key riêng trên thiết bị", () => {
    expect(LAST_PLAYED_KEY).toBe("kecon-last-played");
  });

  it("đọc JSON hợp lệ và chuẩn hoá trang", () => {
    const v = readLastPlayed(JSON.stringify({ storyId: "s1", title: "Sóc Nhỏ", page: 9, totalPages: 4, updatedAt: 5 }));
    expect(v).toEqual({ storyId: "s1", title: "Sóc Nhỏ", page: 4, totalPages: 4, voice: undefined, category: null, updatedAt: 5 });
    expect(readLastPlayed(JSON.stringify({ storyId: "s1", title: "A", page: 0, totalPages: 0 }))).toMatchObject({ page: 1, totalPages: 1 });
  });

  it("bỏ qua dữ liệu hỏng", () => {
    expect(readLastPlayed(null)).toBeNull();
    expect(readLastPlayed("{oops")).toBeNull();
    expect(readLastPlayed(JSON.stringify({ title: "thiếu id" }))).toBeNull();
  });

  it("tiến độ thanh 'Nghe tiếp'", () => {
    expect(lastPlayedProgress({ page: 1, totalPages: 4 })).toBe(25);
    expect(lastPlayedProgress({ page: 3, totalPages: 3 })).toBe(100);
    expect(lastPlayedProgress({ page: 1, totalPages: 0 })).toBe(100);
  });
});

describe("kit: POSITIONED (Mascot/Bubble không ép `relative` khi được đặt absolute)", async () => {
  const { POSITIONED } = await import("@/components/ui/kit");
  it("nhận diện absolute/fixed/sticky", () => {
    expect(POSITIONED.test("pointer-events-none absolute -bottom-3")).toBe(true);
    expect(POSITIONED.test("fixed inset-0")).toBe(true);
    expect(POSITIONED.test("text-[18px] rotate-3")).toBe(false);
    expect(POSITIONED.test("absolute-ish")).toBe(false);
  });
});
