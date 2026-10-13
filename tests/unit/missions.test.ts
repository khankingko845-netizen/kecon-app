import { beforeEach, describe, expect, it, vi } from "vitest";
import { wordCount } from "@/lib/dom-lines";
import {
  ALL_DONE_LINE,
  MISSION_COPY,
  MISSION_IDS,
  STICKER_LINE,
  buildCelebration,
  milestoneLine,
  missionCopy,
  weekChipAria,
  weekChipLabel,
  weekGoalLine,
  type CompleteResult,
  type MissionsToday,
} from "@/lib/missions";

const getUser = vi.fn();
const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { getUser }, rpc })),
}));

const banned = /(sợ|ma quỷ|lỗi của bé|tại bé|buồn lắm|đừng đi|ở lại|mua|trả tiền|nạp|premium|gói cước|mất chuỗi|tiếc quá)/iu;
const personPraise = /(giỏi|thông minh|xuất sắc|thiên tài|liền|liên tục|liên tiếp)/iu;
const spoken = [
  ...MISSION_IDS.map((id) => MISSION_COPY[id].praise),
  ALL_DONE_LINE,
  STICKER_LINE,
  milestoneLine(1),
  milestoneLine(5),
  milestoneLine(100),
];
const shown = [
  ...spoken,
  ...MISSION_IDS.flatMap((id) => [MISSION_COPY[id].title, MISSION_COPY[id].hint]),
  weekGoalLine(0, 4),
  weekGoalLine(2, 4),
  weekGoalLine(4, 4),
  weekChipLabel(0),
  weekChipLabel(3),
];

const day = (date: string, stars = 0, listened = false) => ({ date, stars, listened });
const today = (missions: { id: string; done: boolean }[], nights = 1): MissionsToday => ({
  date: "2026-03-05",
  missions,
  week: {
    start: "2026-03-02",
    goal: 4,
    nights,
    days: ["02", "03", "04", "05", "06", "07", "08"].map((d) => day(`2026-03-${d}`)),
  },
  totals: { stories: 1, stars: 1, stickers: 0 },
});
const result = (p: Partial<CompleteResult>): CompleteResult => ({
  counted: true,
  completed: [],
  sticker: null,
  milestone: null,
  today: today([]),
  ...p,
});

describe("lời Đóm cho nhiệm vụ (G-01)", () => {
  it("câu đọc to 5–12 từ; khen quá trình, không khen người, không đếm chuỗi", () => {
    for (const text of spoken) {
      expect(wordCount(text), text).toBeGreaterThanOrEqual(5);
      expect(wordCount(text), text).toBeLessThanOrEqual(12);
    }
    for (const text of shown) {
      expect(text, text).not.toMatch(personPraise);
      expect(text, text).not.toMatch(banned);
    }
  });
  it("mỗi nhiệm vụ có tên, gợi ý, lời khen riêng; mẫu lạ vẫn có chữ", () => {
    expect(new Set(MISSION_IDS.map((id) => MISSION_COPY[id].praise)).size).toBe(MISSION_IDS.length);
    expect(missionCopy("mau-moi-tu-may-chu").title).toBe("Nhiệm vụ nghe truyện");
  });
  it("chip tuần đếm số tối trong tuần, không có chữ 'liền'", () => {
    expect(weekChipLabel(0)).toBe("Bầu trời của Đóm");
    expect(weekChipLabel(3)).toBe("Tuần này 3 tối");
    expect(weekChipAria(3)).toContain(weekChipLabel(3));
    expect(weekChipAria(0)).toContain(weekChipLabel(0));
    expect(weekGoalLine(5, 4)).toBe("Bầu trời tuần này sáng rực rồi!");
  });
});

describe("buildCelebration", () => {
  it("không ghi nhận hoặc không có gì mới → không mở thẻ chúc mừng", () => {
    expect(buildCelebration(result({ counted: false, reason: "too_fast" }))).toBeNull();
    expect(buildCelebration(result({}))).toBeNull();
  });
  it("ưu tiên lời khen nhiệm vụ chủ đề; đếm sao theo nhiệm vụ", () => {
    const c = buildCelebration(
      result({
        completed: ["nghe-het-truyen", "co-tich"],
        today: today([
          { id: "nghe-het-truyen", done: true },
          { id: "co-tich", done: true },
        ]),
      }),
    )!;
    expect(c.stars).toBe(2);
    expect(c.line.text).toBe(MISSION_COPY["co-tich"].praise);
    expect(c.allDone).toBe(true);
    expect(c.missions.map((m) => m.title)).toEqual(["Nghe hết một truyện", "Nghe một truyện cổ tích"]);
  });
  it("chỉ nhiệm vụ cơ bản → khen nghe trọn; còn nhiệm vụ → chưa 'xong hết'", () => {
    const c = buildCelebration(
      result({
        completed: ["nghe-het-truyen"],
        today: today([
          { id: "nghe-het-truyen", done: true },
          { id: "con-vat", done: false },
        ]),
      }),
    )!;
    expect(c.line.text).toBe(MISSION_COPY["nghe-het-truyen"].praise);
    expect(c.allDone).toBe(false);
  });
  it("chỉ có cột mốc hoặc nhãn dán → vẫn chúc mừng đúng việc đã làm", () => {
    expect(buildCelebration(result({ milestone: 5 }))!.line.text).toBe(milestoneLine(5));
    const s = buildCelebration(result({ sticker: { story_id: "x", title: "Tấm Cám", cover_image_url: null } }))!;
    expect(s.line.text).toBe(STICKER_LINE);
    expect(s.stars).toBe(0);
  });
});

const okToday = today([{ id: "nghe-het-truyen", done: false }]);
const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://x/api/missions/listen", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
const STORY = "9b2f8c1e-4a5d-4e6f-8a7b-1c2d3e4f5a6b";

describe("API /api/missions", () => {
  beforeEach(() => {
    getUser.mockReset();
    rpc.mockReset();
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
  });
  it("GET: cần đăng nhập; cờ tắt → 404; dữ liệu lạ → 503; hợp lệ → no-store", async () => {
    const { GET } = await import("@/app/api/missions/route");
    getUser.mockResolvedValueOnce({ data: { user: null } });
    expect((await GET()).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "Action unavailable" } });
    expect((await GET()).status).toBe(404);
    rpc.mockResolvedValueOnce({ data: { date: "hôm nay" }, error: null });
    expect((await GET()).status).toBe(503);
    rpc.mockResolvedValueOnce({ data: okToday, error: null });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.json()).toEqual(okToday);
    expect(rpc).toHaveBeenLastCalledWith("missions_today");
  });
  it("GET album: trả nhãn dán và cột mốc đã kiểm tra", async () => {
    const { GET } = await import("@/app/api/missions/album/route");
    const album = { stickers: [{ story_id: STORY, title: "Tấm Cám", cover_image_url: null, earned_on: "2026-03-05" }], milestones: [1] };
    rpc.mockResolvedValueOnce({ data: album, error: null });
    expect(await (await GET()).json()).toEqual(album);
    rpc.mockResolvedValueOnce({ data: { stickers: "x" }, error: null });
    expect((await GET()).status).toBe(503);
  });
  it("POST listen: chặn cross-site, body lạ, trả mã lỗi rõ ràng", async () => {
    const { POST } = await import("@/app/api/missions/listen/route");
    expect((await POST(post({ action: "start", storyId: STORY }, { "sec-fetch-site": "cross-site" }))).status).toBe(403);
    for (const bad of [{}, { action: "start", storyId: "abc" }, { action: "start", storyId: STORY, stars: 9 }, { action: "award" }])
      expect((await POST(post(bad))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValueOnce({ data: null, error: { code: "22023" } });
    expect((await POST(post({ action: "start", storyId: STORY }))).status).toBe(400);
    rpc.mockResolvedValueOnce({ data: null, error: { code: "54000" } });
    expect((await POST(post({ action: "start", storyId: STORY }))).status).toBe(429);
    rpc.mockResolvedValueOnce({ data: null, error: { code: "XX000" } });
    expect((await POST(post({ action: "start", storyId: STORY }))).status).toBe(503);
    rpc.mockResolvedValueOnce({ data: { session_id: STORY, min_seconds: 83 }, error: null });
    expect(await (await POST(post({ action: "start", storyId: STORY }))).json()).toEqual({ session_id: STORY, min_seconds: 83 });
    expect(rpc).toHaveBeenLastCalledWith("missions_start_listen", { p_story: STORY });
  });
  it("POST complete: chuẩn hoá kết quả; không ghi nhận vẫn 200 kèm lý do", async () => {
    const { POST } = await import("@/app/api/missions/listen/route");
    rpc.mockResolvedValueOnce({ data: { counted: false, reason: "too_fast" }, error: null });
    expect(await (await POST(post({ action: "complete", sessionId: STORY }))).json()).toEqual({
      counted: false,
      reason: "too_fast",
      completed: [],
      sticker: null,
      milestone: null,
      today: null,
    });
    expect(rpc).toHaveBeenLastCalledWith("missions_complete_listen", { p_session: STORY });
    rpc.mockResolvedValueOnce({
      data: { counted: true, completed: ["nghe-het-truyen"], sticker: null, milestone: 1, today: okToday },
      error: null,
    });
    const r = await (await POST(post({ action: "complete", sessionId: STORY }))).json();
    expect(r).toMatchObject({ counted: true, completed: ["nghe-het-truyen"], milestone: 1, today: okToday });
  });
});
