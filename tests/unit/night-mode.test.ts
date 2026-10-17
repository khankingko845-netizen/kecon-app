import { describe, expect, it } from "vitest";
import {
  formatCountdown,
  isWithinNightWindow,
  msUntilNextBoundary,
  parseHm,
  parseNightPref,
  resolveNight,
} from "@/lib/night-mode";

const at = (hm: string) => new Date(`2025-06-02T${hm}:00`);

describe("night mode (UI-08)", () => {
  it("parseHm", () => {
    expect(parseHm("19:30")).toBe(19 * 60 + 30);
    expect(parseHm("6:00")).toBe(360);
    expect(parseHm("24:00")).toBeNaN();
    expect(parseHm("abc")).toBeNaN();
  });

  it.each([
    ["19:29", false],
    ["19:30", true],
    ["23:59", true],
    ["00:00", true],
    ["05:59", true],
    ["06:00", false],
    ["12:00", false],
  ])("cửa sổ mặc định 19:30–06:00 lúc %s → %s", (hm, expected) => {
    expect(isWithinNightWindow(at(hm))).toBe(expected);
  });

  it("cửa sổ không qua nửa đêm", () => {
    const w = { start: "13:00", end: "15:00" };
    expect(isWithinNightWindow(at("14:00"), w)).toBe(true);
    expect(isWithinNightWindow(at("15:00"), w)).toBe(false);
  });

  it("cửa sổ sai định dạng → không bật", () => {
    expect(isWithinNightWindow(at("21:00"), { start: "x", end: "06:00" })).toBe(false);
    expect(isWithinNightWindow(at("21:00"), { start: "06:00", end: "06:00" })).toBe(false);
  });

  it("resolveNight: on/off thắng giờ, auto theo giờ", () => {
    expect(resolveNight("on", at("10:00"))).toBe(true);
    expect(resolveNight("off", at("21:00"))).toBe(false);
    expect(resolveNight("auto", at("21:00"))).toBe(true);
    expect(resolveNight("auto", at("10:00"))).toBe(false);
  });

  it("parseNightPref mặc định auto", () => {
    expect(parseNightPref(null)).toBe("auto");
    expect(parseNightPref("weird")).toBe("auto");
    expect(parseNightPref("on")).toBe("on");
    expect(parseNightPref("off")).toBe("off");
  });

  it("msUntilNextBoundary tính tới mốc gần nhất", () => {
    expect(msUntilNextBoundary(at("19:00"))).toBe(30 * 60 * 1000);
    expect(msUntilNextBoundary(at("05:00"))).toBe(60 * 60 * 1000);
    // 06:00 đúng mốc → mốc kế tiếp là 19:30
    expect(msUntilNextBoundary(at("06:00"))).toBe((13 * 60 + 30) * 60 * 1000);
  });

  it("formatCountdown", () => {
    expect(formatCountdown(300)).toBe("5:00");
    expect(formatCountdown(61)).toBe("1:01");
    expect(formatCountdown(-3)).toBe("0:00");
  });
});
