/**
 * UI-11 · Âm thanh, haptic + 10–15 câu thoại của Đóm. Tắt được; im lặng ở Chế độ ngủ.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DOM_LINES, DOM_MOMENTS, domLine, greetingMoment, wordCount } from "@/lib/dom-lines";
import {
  DEFAULT_FEEDBACK_PREFS,
  FEEDBACK_CUES,
  HAPTICS,
  SFX,
  cueFromAttr,
  feedbackChannels,
  parseFeedbackPrefs,
  pickVietnameseVoice,
  scheduleCue,
  serializeFeedbackPrefs,
  type AudioContextLike,
} from "@/lib/feedback";
import { MASCOT_STATES } from "@/components/ui/Mascot";
import FeedbackSettings, { bedtimeHint } from "@/components/parent/FeedbackSettings";
import ScreenTimeLock from "@/components/parent/ScreenTimeLock";
import { KidError } from "@/components/ui/states";

describe("câu thoại của Đóm", () => {
  const lines = Object.values(DOM_LINES);

  it("có 10–15 câu, mỗi khoảnh khắc một câu", () => {
    expect(lines.length).toBeGreaterThanOrEqual(10);
    expect(lines.length).toBeLessThanOrEqual(15);
    expect(new Set(DOM_MOMENTS).size).toBe(lines.length);
    for (const m of DOM_MOMENTS) expect(domLine(m).moment).toBe(m);
  });

  it.each(lines.map((l) => [l.moment, l.text] as const))("%s: ≤ 12 từ, xưng tớ/bé hoặc mình", (_m, text) => {
    expect(wordCount(text)).toBeLessThanOrEqual(12);
    expect(wordCount(text)).toBeGreaterThanOrEqual(5);
    expect(text).toMatch(/(^|[\s,.!?])(tớ|Tớ|bé|Bé|mình|Mình)($|[\s,.!?])/u);
  });

  it("không doạ, không đổ lỗi cho bé, không giữ chân bằng nỗi buồn, không mời mua", () => {
    const banned = /(sợ|ma quỷ|lỗi của bé|tại bé|buồn lắm|đừng đi|ở lại|mua|trả tiền|nạp|premium|gói cước)/iu;
    for (const l of lines) expect(l.text).not.toMatch(banned);
  });

  it("mỗi câu dùng một tư thế Đóm có thật; câu lúc mở mic không đọc to", () => {
    for (const l of lines) expect(MASCOT_STATES).toContain(l.mascot);
    expect(DOM_LINES.listen.speak).toBe(false);
    expect(lines.filter((l) => l.speak).length).toBe(lines.length - 1);
  });

  it("lời chào theo giờ; chuỗi ≥ 3 đêm thì khen", () => {
    expect(greetingMoment(8)).toBe("hello-morning");
    expect(greetingMoment(14)).toBe("hello-afternoon");
    expect(greetingMoment(20)).toBe("hello-evening");
    expect(greetingMoment(2)).toBe("hello-evening");
    expect(greetingMoment(8, 2)).toBe("hello-morning");
    expect(greetingMoment(8, 3)).toBe("streak");
  });

  it("đếm từ bỏ qua dấu câu", () => {
    expect(wordCount("Xong rồi! Truyện của bé đã sẵn sàng.")).toBe(8);
    expect(wordCount("  Hi hi , nhột quá !  ")).toBe(4);
  });
});

describe("âm thanh + rung", () => {
  it("mọi cue có âm và rung; âm ngắn, nhỏ, chỉ sine/triangle", () => {
    for (const cue of FEEDBACK_CUES) {
      expect(SFX[cue].length).toBeGreaterThan(0);
      for (const t of SFX[cue]) {
        expect(t.at + t.dur).toBeLessThanOrEqual(0.6);
        expect(t.gain).toBeLessThanOrEqual(0.2);
        expect(["sine", "triangle"]).toContain(t.type);
        expect(t.freq).toBeGreaterThanOrEqual(200);
        expect(t.freq).toBeLessThanOrEqual(1600);
      }
      const pattern = HAPTICS[cue];
      const total = typeof pattern === "number" ? pattern : pattern.reduce((a, b) => a + b, 0);
      expect(total).toBeGreaterThan(0);
      expect(total).toBeLessThanOrEqual(200);
    }
    expect(HAPTICS.tap).toBeLessThanOrEqual(10);
  });

  it("scheduleCue tạo đủ oscillator, envelope không click, trả về thời điểm kết thúc", () => {
    const calls: string[] = [];
    const param = (name: string) => ({
      setValueAtTime: (v: number, t: number) => calls.push(`${name}.set ${v.toFixed(4)}@${t.toFixed(3)}`),
      linearRampToValueAtTime: (v: number, t: number) => calls.push(`${name}.lin ${v.toFixed(4)}@${t.toFixed(3)}`),
      exponentialRampToValueAtTime: (v: number, t: number) => calls.push(`${name}.exp ${v.toFixed(4)}@${t.toFixed(3)}`),
    });
    let oscillators = 0;
    const started: number[] = [];
    const ctx: AudioContextLike = {
      currentTime: 10,
      createOscillator: () => {
        oscillators++;
        return { type: "", frequency: param("f"), connect: () => {}, start: (t = 0) => started.push(t), stop: () => {} };
      },
      createGain: () => ({ gain: param("g"), connect: () => {} }),
    };
    const end = scheduleCue(ctx, {}, "success", 0.5);
    expect(oscillators).toBe(SFX.success.length);
    expect(started).toEqual(started.slice().sort((a, b) => a - b));
    expect(end).toBeCloseTo(10.005 + 0.16 + 0.22, 3);
    // Envelope starts and ends near silence; peak = gain × volume.
    expect(calls.filter((c) => c.startsWith("g.set 0.0001"))).toHaveLength(3);
    expect(calls).toContain("g.lin 0.0800@10.013");
    expect(calls.filter((c) => c.startsWith("g.exp 0.0001"))).toHaveLength(3);
    // Glides only where defined.
    scheduleCue(ctx, {}, "oops");
    expect(calls.some((c) => c.startsWith("f.exp 392"))).toBe(true);
  });

  it("data-sfx: mặc định tap, giá trị lạ hoặc 'off' → tắt", () => {
    expect(cueFromAttr(null)).toBe("tap");
    expect(cueFromAttr(undefined)).toBe("tap");
    expect(cueFromAttr("")).toBe("tap");
    expect(cueFromAttr("pop")).toBe("pop");
    expect(cueFromAttr("page")).toBe("page");
    expect(cueFromAttr("off")).toBeNull();
    expect(cueFromAttr("boom")).toBeNull();
  });
});

describe("tuỳ chọn + Chế độ ngủ", () => {
  it("đọc/ghi tuỳ chọn an toàn, mặc định bật hết", () => {
    expect(DEFAULT_FEEDBACK_PREFS).toEqual({ sound: true, haptics: true, voice: true });
    expect(parseFeedbackPrefs(null)).toEqual(DEFAULT_FEEDBACK_PREFS);
    expect(parseFeedbackPrefs("not json")).toEqual(DEFAULT_FEEDBACK_PREFS);
    expect(parseFeedbackPrefs("[1]")).toEqual(DEFAULT_FEEDBACK_PREFS);
    expect(parseFeedbackPrefs('{"sound":false,"voice":"no","x":1}')).toEqual({ sound: false, haptics: true, voice: true });
    const p = { sound: false, haptics: false, voice: true };
    expect(parseFeedbackPrefs(serializeFeedbackPrefs(p))).toEqual(p);
    expect(serializeFeedbackPrefs({ ...p, extra: 1 } as typeof p)).toBe('{"sound":false,"haptics":false,"voice":true}');
  });

  it("ban ngày: theo tuỳ chọn của bố mẹ", () => {
    expect(feedbackChannels(DEFAULT_FEEDBACK_PREFS, { bedtime: false })).toEqual({ sound: true, haptics: true, voice: true });
    expect(feedbackChannels({ sound: false, haptics: false, voice: false }, { bedtime: false })).toEqual({ sound: false, haptics: false, voice: false });
  });

  it("Chế độ ngủ: im lặng (âm + giọng), rung vẫn theo tuỳ chọn", () => {
    expect(feedbackChannels(DEFAULT_FEEDBACK_PREFS, { bedtime: true })).toEqual({ sound: false, haptics: true, voice: false });
    expect(feedbackChannels({ ...DEFAULT_FEEDBACK_PREFS, haptics: false }, { bedtime: true }).haptics).toBe(false);
  });

  it("đang phát truyện: Đóm không nói chen; tab ẩn: không phát gì", () => {
    expect(feedbackChannels(DEFAULT_FEEDBACK_PREFS, { bedtime: false, mediaPlaying: true })).toEqual({ sound: true, haptics: true, voice: false });
    expect(feedbackChannels(DEFAULT_FEEDBACK_PREFS, { bedtime: false, hidden: true })).toEqual({ sound: false, haptics: false, voice: false });
  });

  it("chỉ đọc bằng giọng tiếng Việt (ưu tiên vi-VN, giọng trên máy)", () => {
    expect(pickVietnameseVoice([{ lang: "en-US", name: "Samantha" }])).toBeNull();
    expect(pickVietnameseVoice([])).toBeNull();
    const net = { lang: "vi-VN", name: "Google Tiếng Việt", localService: false };
    const local = { lang: "vi-VN", name: "Linh", localService: true };
    const bare = { lang: "vi", name: "vi", localService: true };
    expect(pickVietnameseVoice([{ lang: "en-US", name: "A" }, net, local, bare])).toBe(local);
    expect(pickVietnameseVoice([bare, { lang: "vietnamese", name: "x" }])).toBe(bare);
    expect(pickVietnameseVoice([{ lang: "vi_VN", name: "Android" }])?.name).toBe("Android");
  });

  it("gợi ý Chế độ ngủ trong tab Bố mẹ", () => {
    expect(bedtimeHint("auto", false)).toContain("19:30–6:00");
    expect(bedtimeHint("auto", true)).toContain("đang tắt");
    expect(bedtimeHint("off", false)).toContain("Chế độ ngủ đang tắt");
  });
});

describe("giao diện", () => {
  it("thẻ Âm thanh & rung: 3 công tắc + Nghe thử", () => {
    const html = renderToStaticMarkup(createElement(FeedbackSettings, { nightPref: "auto" }));
    expect(html.match(/role="switch"/g)).toHaveLength(3);
    expect(html.match(/aria-checked="true"/g)).toHaveLength(3);
    for (const label of ["Âm thanh khi chạm", "Rung nhẹ", "Đóm nói chuyện", "Nghe thử"]) expect(html).toContain(label);
    expect(html).toContain('data-sfx="off"');
  });

  it("màn khoá & lỗi dùng câu thoại của Đóm", () => {
    const limit = renderToStaticMarkup(createElement(ScreenTimeLock, { reason: "limit", onGrant: () => {} }));
    expect(limit).toContain(DOM_LINES["time-up"].text);
    const bed = renderToStaticMarkup(createElement(ScreenTimeLock, { reason: "bedtime", onGrant: () => {} }));
    expect(bed).toContain(DOM_LINES.bedtime.text);
    expect(renderToStaticMarkup(createElement(KidError, {}))).toContain(DOM_LINES.oops.text);
    expect(renderToStaticMarkup(createElement(KidError, { message: "Mất mạng rồi" }))).not.toContain(DOM_LINES.oops.text);
  });
});
