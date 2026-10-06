/**
 * T19 / UI-10 · Cổng phụ huynh + giới hạn thời gian/ngày.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  appendDigit,
  createAdultChallenge,
  isChallengeAnswerCorrect,
  isParentArea,
  PARENT_SCREENS,
  UNLOCK_IDLE_MS,
} from "@/lib/parent-gate";
import { resetParentPin, unlockErrorMessage } from "@/lib/parent-pin";
import {
  addUsage,
  emptyUsage,
  evaluateScreenTime,
  grantExtraTime,
  isWithinBedtime,
  localDateKey,
  minutesLeft,
  parseClock,
  parseUsage,
  type ScreenTimeRules,
} from "@/lib/screen-time";
import Keypad from "@/components/parent/Keypad";
import ParentGate from "@/components/parent/ParentGate";
import ScreenTimeLock from "@/components/parent/ScreenTimeLock";
import type { Screen } from "@/lib/types";

const at = (hhmm: string, day = "2025-06-02") => new Date(`${day}T${hhmm}:00`);

describe("parent-gate · vùng phụ huynh", () => {
  it("tab Bố mẹ và mọi màn chỉ mở từ đó đều cần cổng", () => {
    for (const s of ["settings", "parental-controls", "parent-analytics", "subscription", "profile-edit", "notifications", "admin"] as Screen[]) {
      expect(isParentArea(s)).toBe(true);
    }
  });

  it("màn của bé không bị chặn", () => {
    for (const s of ["home", "library", "create", "profiles", "player", "lullaby", "achievements", "favorites"] as Screen[]) {
      expect(isParentArea(s)).toBe(false);
    }
    expect(new Set(PARENT_SCREENS).size).toBe(PARENT_SCREENS.length);
  });

  it("mở khoá hết hạn sau 5 phút không dùng", () => {
    expect(UNLOCK_IDLE_MS).toBe(300_000);
  });
});

describe("parent-gate · câu hỏi người lớn", () => {
  it("12–19 × 3–9: luôn ≥ 36, ≤ 171 (bé 3–8 tuổi không tính được)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const c = createAdultChallenge();
      expect(c.a).toBeGreaterThanOrEqual(12);
      expect(c.a).toBeLessThanOrEqual(19);
      expect(c.b).toBeGreaterThanOrEqual(3);
      expect(c.b).toBeLessThanOrEqual(9);
      expect(c.answer).toBe(c.a * c.b);
      expect(c.question).toBe(`${c.a} × ${c.b}`);
      expect(c.spoken).toContain("nhân");
      seen.add(c.question);
    }
    expect(seen.size).toBeGreaterThan(30);
  });

  it("biên của rand (0 và gần 1) vẫn trong khoảng", () => {
    expect(createAdultChallenge(() => 0)).toMatchObject({ a: 12, b: 3, answer: 36 });
    expect(createAdultChallenge(() => 0.999999)).toMatchObject({ a: 19, b: 9, answer: 171 });
    expect(createAdultChallenge(() => 1)).toMatchObject({ a: 19, b: 9 });
  });

  it("chấm đáp án: chỉ số nguyên đúng", () => {
    const c = createAdultChallenge(() => 0.5);
    expect(isChallengeAnswerCorrect(c, String(c.answer))).toBe(true);
    expect(isChallengeAnswerCorrect(c, ` ${c.answer} `)).toBe(true);
    expect(isChallengeAnswerCorrect(c, String(c.answer + 1))).toBe(false);
    for (const bad of ["", "abc", "1e2", "-36", "36.0", "99999"]) expect(isChallengeAnswerCorrect(c, bad)).toBe(false);
  });

  it("bàn phím số: chỉ nhận chữ số, giới hạn độ dài", () => {
    expect(appendDigit("12", "3", 6)).toBe("123");
    expect(appendDigit("123456", "7", 6)).toBe("123456");
    expect(appendDigit("12", "x", 6)).toBe("12");
    expect(appendDigit("12", "34", 6)).toBe("12");
  });
});

describe("parent-pin · quên PIN (018)", () => {
  const fake = (data: unknown, error: unknown = null) => {
    const rpc = vi.fn(async () => ({ data, error }));
    return { client: { rpc } as unknown as SupabaseClient, rpc };
  };

  it("resetParentPin gọi RPC reset_parent_pin, map reauth_required", async () => {
    const { client, rpc } = fake({ ok: false, reason: "reauth_required" });
    expect(await resetParentPin(client)).toMatchObject({ ok: false, reason: "reauth_required" });
    expect(rpc).toHaveBeenCalledWith("reset_parent_pin");
    expect((await resetParentPin(fake({ ok: true }).client)).ok).toBe(true);
    expect(await resetParentPin(fake(null, { message: "boom" }).client)).toEqual({ ok: false, reason: "unavailable" });
  });

  it("thông báo mở khoá thân thiện, không nói 'PIN hiện tại'", () => {
    expect(unlockErrorMessage({ ok: false, reason: "invalid", attemptsLeft: 3 })).toBe(
      "Mã PIN chưa đúng. Còn 3 lần thử trước khi bị khoá."
    );
    const now = new Date("2025-06-02T10:00:00Z");
    expect(unlockErrorMessage({ ok: false, reason: "locked", lockedUntil: new Date("2025-06-02T10:14:10Z") }, now)).toContain("15 phút");
    expect(unlockErrorMessage({ ok: false, reason: "unavailable" })).toMatch(/Không kiểm tra được/);
    expect(unlockErrorMessage({ ok: false, reason: "reauth_required" })).toMatch(/xác minh lại/);
  });
});

describe("screen-time · khung giờ ngủ", () => {
  it("parseClock: HH:MM và HH:MM:SS (Postgres time)", () => {
    expect(parseClock("20:30")).toBe(1230);
    expect(parseClock("06:00:00")).toBe(360);
    expect(parseClock("7:05")).toBe(425);
    for (const bad of ["", null, undefined, "24:00", "12:60", "abc"]) expect(parseClock(bad)).toBeNull();
  });

  it("khung qua nửa đêm 20:30–06:00", () => {
    expect(isWithinBedtime("20:30", "06:00", at("20:29"))).toBe(false);
    expect(isWithinBedtime("20:30", "06:00", at("20:30"))).toBe(true);
    expect(isWithinBedtime("20:30", "06:00", at("23:59"))).toBe(true);
    expect(isWithinBedtime("20:30", "06:00", at("03:00"))).toBe(true);
    expect(isWithinBedtime("20:30", "06:00", at("06:00"))).toBe(false);
    expect(isWithinBedtime("20:30", "06:00", at("12:00"))).toBe(false);
  });

  it("khung trong ngày 13:00–15:00 (ngủ trưa); thiếu/giống nhau → không chặn", () => {
    expect(isWithinBedtime("13:00", "15:00", at("14:00"))).toBe(true);
    expect(isWithinBedtime("13:00", "15:00", at("15:00"))).toBe(false);
    expect(isWithinBedtime(null, "06:00", at("03:00"))).toBe(false);
    expect(isWithinBedtime("21:00", "21:00", at("21:00"))).toBe(false);
  });
});

describe("screen-time · giới hạn/ngày", () => {
  const rules = (over: Partial<ScreenTimeRules> = {}): ScreenTimeRules => ({
    is_enabled: true,
    daily_limit_minutes: 30,
    bedtime_start: null,
    bedtime_end: null,
    ...over,
  });
  const now = at("10:00");

  it("đếm theo ngày địa phương; sang ngày mới về 0 nhưng giữ thời gian bố mẹ cho thêm", () => {
    expect(localDateKey(now)).toBe("2025-06-02");
    const today = JSON.stringify({ date: "2025-06-02", seconds: 600, grantUntil: 0 });
    expect(parseUsage(today, now).seconds).toBe(600);
    const yesterday = JSON.stringify({ date: "2025-06-01", seconds: 9999, grantUntil: 123 });
    expect(parseUsage(yesterday, now)).toEqual({ date: "2025-06-02", seconds: 0, grantUntil: 123 });
    expect(parseUsage("{oops", now)).toEqual(emptyUsage(now));
    expect(parseUsage(JSON.stringify({ date: "2025-06-02", seconds: -5 }), now).seconds).toBe(0);
    expect(addUsage(parseUsage(yesterday, now), 15, now).seconds).toBe(15);
  });

  it("tắt kiểm soát / không giới hạn → không bao giờ khoá", () => {
    const used = { ...emptyUsage(now), seconds: 99 * 3600 };
    expect(evaluateScreenTime(null, used, now)).toEqual({ blocked: false });
    expect(evaluateScreenTime(rules({ is_enabled: false }), used, now)).toEqual({ blocked: false });
    expect(evaluateScreenTime(rules({ daily_limit_minutes: 0 }), used, now)).toEqual({ blocked: false });
    expect(minutesLeft(rules({ daily_limit_minutes: 0 }), used)).toBeNull();
  });

  it("dùng đủ 30 phút → khoá 'limit'; còn phút → không", () => {
    const u = { ...emptyUsage(now), seconds: 29 * 60 + 45 };
    expect(evaluateScreenTime(rules(), u, now)).toEqual({ blocked: false });
    expect(minutesLeft(rules(), u)).toBe(1);
    const done = addUsage(u, 15, now);
    expect(evaluateScreenTime(rules(), done, now)).toEqual({ blocked: true, reason: "limit" });
    expect(minutesLeft(rules(), done)).toBe(0);
  });

  it("giờ ngủ thắng giới hạn; bố mẹ cho thêm 15 phút → mở, hết 15 phút → khoá lại", () => {
    const r = rules({ bedtime_start: "20:30", bedtime_end: "06:00" });
    const night = at("21:00");
    const u = emptyUsage(night);
    expect(evaluateScreenTime(r, u, night)).toEqual({ blocked: true, reason: "bedtime" });
    const granted = grantExtraTime(u, 15, night);
    expect(evaluateScreenTime(r, granted, night)).toEqual({ blocked: false });
    expect(evaluateScreenTime(r, granted, at("21:14"))).toEqual({ blocked: false });
    expect(evaluateScreenTime(r, granted, at("21:15"))).toEqual({ blocked: true, reason: "bedtime" });
  });

  it("cho thêm cộng dồn từ hạn đang còn", () => {
    const u = grantExtraTime(emptyUsage(now), 15, now);
    expect(grantExtraTime(u, 30, now).grantUntil).toBe(now.getTime() + 45 * 60_000);
  });
});

describe("UI · cổng phụ huynh & màn khoá (render tĩnh)", () => {
  it("ParentGate: tiêu đề, Đóm, trạng thái đang kiểm tra; nút quay về trang chủ", () => {
    const html = renderToStaticMarkup(createElement(ParentGate, { onUnlock: () => {}, onCancel: () => {} }));
    expect(html).toContain("Khu vực của bố mẹ");
    expect(html).toContain('data-parent-gate="loading"');
    expect(html).toContain('aria-label="Về trang chủ"');
    expect(html).toContain('data-mascot="thinking"');
    expect(html).toContain("Khoá tự bật lại sau 5 phút");
  });

  it("Keypad: 10 phím số + xoá, vùng chạm ≥ 56px", () => {
    const html = renderToStaticMarkup(createElement(Keypad, { onDigit: () => {}, onBackspace: () => {} }));
    expect(html.match(/<button/g)).toHaveLength(11);
    expect(html).toContain('aria-label="Xoá số cuối"');
    expect(html).toContain("h-14");
  });

  it("ScreenTimeLock: copy theo lý do, Đóm buồn ngủ, nút cho bố mẹ", () => {
    const limit = renderToStaticMarkup(createElement(ScreenTimeLock, { reason: "limit", onGrant: () => {} }));
    expect(limit).toContain("Hết giờ nghe truyện hôm nay rồi!");
    expect(limit).toContain('data-mascot="sleepy"');
    expect(limit).toContain("Bố mẹ mở thêm giờ");
    const bed = renderToStaticMarkup(createElement(ScreenTimeLock, { reason: "bedtime", onGrant: () => {} }));
    expect(bed).toContain("Đến giờ đi ngủ rồi!");
  });
});
