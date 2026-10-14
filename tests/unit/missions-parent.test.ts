import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_PROMPT,
  HABIT_NOTE,
  KINDNESS_NOTE,
  REMINDER_HOURS,
  REMINDER_NOTE,
  conversationPrompt,
  familyLine,
  familySkyLine,
  hourLabel,
} from "@/lib/missions";
import { MissionsTodaySchema, ParentBodySchema, ParentWeekSchema, missionsError } from "@/lib/missions-server";
import { PROOF_MAX_MS, clearParentProof, getParentProof, setParentProof } from "@/lib/parent-proof";
import { openParentGate } from "@/lib/parent-pin";
import { runOnce } from "../../scripts/parent-notify.mjs";

const getUser = vi.fn();
const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { getUser }, rpc })),
}));
const browserRpc = vi.fn(async () => ({ data: null, error: null }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc: browserRpc }) }));

const PROOF = "a".repeat(64);
const SESSION = "9b2f8c1e-4a5d-4e6f-8a7b-1c2d3e4f5a6b";
const days = ["02", "03", "04", "05", "06", "07", "08"].map((d) => ({ date: `2026-03-${d}`, stars: 0, listened: false }));
const summary = {
  date: "2026-03-05",
  missions: [{ id: "nghe-het-truyen", done: true }],
  habits: [{ id: "lam-dung-gio", kind: "habit", title: "Làm xong đúng giờ", line: "Bé đã tự làm xong việc của mình đúng giờ!" }],
  family: { id: "ca-nha-doc-cung", title: "Cả nhà đọc cùng nhau", target: 3, progress: 1, done: false },
  week: { start: "2026-03-02", goal: 4, nights: 1, days },
  totals: { stories: 1, stars: 2, stickers: 1 },
};
const week = {
  summary,
  stories: [{ session_id: SESSION, story_id: SESSION, title: "Su và chiếc đồng hồ cát", category: "educational", date: "2026-03-05", together: true, prompt: null }],
  habits: [{ id: "lam-dung-gio", kind: "habit", title: "Làm xong đúng giờ", label: "Hôm nay bé tự làm xong một việc đúng giờ", prompt: "Hỏi bé: “Hôm nay…”", today: true, week: 1 }],
  family: { ...summary.family, label: "Tuần này cả nhà đọc 3 truyện cùng nhau" },
  notify: { enabled: false, hour: 19, devices: 0 },
};
const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://x/api/missions/parent", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

describe("copy (G-01 rules hold for parents too)", () => {
  const personPraise = /(giỏi|thông minh|xuất sắc|thiên tài|liền|liên tục|liên tiếp|thua|phạt)/iu;
  it("notes, prompts and lines name what was done — no person praise, no streaks, no penalties", () => {
    const all = [HABIT_NOTE, KINDNESS_NOTE, REMINDER_NOTE, DEFAULT_PROMPT, familyLine(0, 3), familyLine(2, 3), familyLine(3, 3), familySkyLine(0, 3), familySkyLine(1, 3), familySkyLine(3, 3)];
    for (const c of ["fairy_tale", "folk", "animal", "bedtime", "adventure", "educational", "x"]) all.push(conversationPrompt({ prompt: null, category: c }));
    for (const line of all) expect(line).not.toMatch(personPraise);
    expect(KINDNESS_NOTE).toMatch(/không đổi lấy sao/);
  });
  it("prompts prefer the story's own question, then the category, then a default", () => {
    expect(conversationPrompt({ prompt: "Hỏi bé: “A?”", category: "folk" })).toBe("Hỏi bé: “A?”");
    expect(conversationPrompt({ prompt: null, category: "animal" })).toMatch(/Bạn thú/);
    expect(conversationPrompt({ prompt: null, category: null })).toBe(DEFAULT_PROMPT);
  });
  it("reminder hours stay in the daytime window the database allows", () => {
    expect(REMINDER_HOURS[0]).toBe(6);
    expect(REMINDER_HOURS.at(-1)).toBe(21);
    expect(hourLabel(7)).toBe("07:00");
  });
});

describe("schemas", () => {
  it("parent week parses; summaries from before migration 036 get empty habits/family", () => {
    expect(ParentWeekSchema.parse(week).habits[0].today).toBe(true);
    const old = MissionsTodaySchema.parse({ ...summary, habits: undefined, family: undefined });
    expect(old.habits).toEqual([]);
    expect(old.family).toBeNull();
    expect(ParentWeekSchema.safeParse({ ...week, notify: { enabled: true, hour: 23, devices: 0 } }).success).toBe(false);
  });
  it("actions need a well-formed proof, strict keys, https endpoints and a daytime hour", () => {
    const ok = [
      { action: "confirm", proof: PROOF, templateId: "lam-dung-gio" },
      { action: "together", proof: PROOF, sessionId: SESSION },
      { action: "notify", proof: PROOF, enabled: true, hour: 19 },
      { action: "device", proof: PROOF, endpoint: "https://fcm.googleapis.com/fcm/send/x", p256dh: "B".repeat(87), auth: "a".repeat(22) },
      { action: "device-remove", endpoint: "https://fcm.googleapis.com/fcm/send/x" },
    ];
    for (const b of ok) expect(ParentBodySchema.safeParse(b).success).toBe(true);
    const bad = [
      { action: "confirm", templateId: "lam-dung-gio" },
      { action: "confirm", proof: PROOF.toUpperCase(), templateId: "lam-dung-gio" },
      { action: "confirm", proof: PROOF, templateId: "lam-dung-gio", star: true },
      { action: "notify", proof: PROOF, enabled: true, hour: 5 },
      { action: "device", proof: PROOF, endpoint: "http://push.example/x", p256dh: "B".repeat(87), auth: "a".repeat(22) },
      { action: "award", proof: PROOF },
    ];
    for (const b of bad) expect(ParentBodySchema.safeParse(b).success).toBe(false);
  });
  it("a missing/expired proof is a 403 the client recognises", async () => {
    const res = missionsError({ code: "28000" });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "parent_proof" });
  });
});

describe("/api/missions/parent", () => {
  beforeEach(() => {
    getUser.mockReset();
    rpc.mockReset();
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
  });
  it("GET: sign-in, flag, shape; push key only when the server holds the pair", async () => {
    const { GET } = await import("@/app/api/missions/parent/route");
    getUser.mockResolvedValueOnce({ data: { user: null } });
    expect((await GET()).status).toBe(401);
    rpc.mockResolvedValueOnce({ data: null, error: { code: "42501" } });
    expect((await GET()).status).toBe(404);
    rpc.mockResolvedValueOnce({ data: { summary: {} }, error: null });
    expect((await GET()).status).toBe(503);
    vi.stubEnv("VAPID_PUBLIC_KEY", "BPUB");
    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    rpc.mockResolvedValueOnce({ data: week, error: null });
    const res = await GET();
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(((await res.json()) as { push: unknown }).push).toEqual({ publicKey: null });
    vi.stubEnv("VAPID_PRIVATE_KEY", "secret");
    rpc.mockResolvedValueOnce({ data: week, error: null });
    const body = (await (await GET()).json()) as Record<string, unknown>;
    expect(body.push).toEqual({ publicKey: "BPUB" });
    expect(JSON.stringify(body)).not.toContain("secret");
    expect(rpc).toHaveBeenLastCalledWith("missions_parent_week");
  });
  it("POST: cross-site and malformed bodies never reach the database", async () => {
    const { POST } = await import("@/app/api/missions/parent/route");
    expect((await POST(post({ action: "confirm", proof: PROOF, templateId: "lam-dung-gio" }, { "sec-fetch-site": "cross-site" }))).status).toBe(403);
    for (const b of [{}, { action: "confirm", templateId: "lam-dung-gio" }, { action: "confirm", proof: "123", templateId: "x" }])
      expect((await POST(post(b))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("POST: passes the proof through; proof errors → 403 parent_proof; refusals get a parent-readable 400", async () => {
    const { POST } = await import("@/app/api/missions/parent/route");
    rpc.mockResolvedValueOnce({ data: { confirmed: true, kind: "habit", star: true, line: "Bé đã tự làm xong việc của mình đúng giờ!" }, error: null });
    const ok = await POST(post({ action: "confirm", proof: PROOF, templateId: "lam-dung-gio" }));
    expect(await ok.json()).toEqual({ confirmed: true, kind: "habit", star: true, line: "Bé đã tự làm xong việc của mình đúng giờ!" });
    expect(rpc).toHaveBeenLastCalledWith("missions_confirm", { p_proof: PROOF, p_template: "lam-dung-gio" });
    rpc.mockResolvedValueOnce({ data: null, error: { code: "28000" } });
    const denied = await POST(post({ action: "together", proof: PROOF, sessionId: SESSION }));
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ code: "parent_proof" });
    rpc.mockResolvedValueOnce({ data: null, error: { code: "22023" } });
    const child = await POST(post({ action: "device", proof: PROOF, endpoint: "https://push.example/x", p256dh: "B".repeat(87), auth: "a".repeat(22) }));
    expect(child.status).toBe(400);
    expect(((await child.json()) as { error: string }).error).toMatch(/thông báo của bé/);
    rpc.mockResolvedValueOnce({ data: { devices: 0 }, error: null });
    expect(await (await POST(post({ action: "device-remove", endpoint: "https://push.example/x" }))).json()).toEqual({ devices: 0 });
    expect(rpc).toHaveBeenLastCalledWith("parent_device_remove", { p_endpoint: "https://push.example/x" });
    rpc.mockResolvedValueOnce({ data: { enabled: true, hour: 20, devices: 1 }, error: null });
    await POST(post({ action: "notify", proof: PROOF, enabled: true, hour: 20 }));
    expect(rpc).toHaveBeenLastCalledWith("parent_notify_set", { p_proof: PROOF, p_enabled: true, p_hour: 20 });
  });
});

describe("parent proof (memory only)", () => {
  beforeEach(() => clearParentProof());
  it("keeps only well-formed tokens and drops them after 60 minutes", () => {
    setParentProof("not-a-token");
    expect(getParentProof()).toBeNull();
    setParentProof(PROOF, 1_000);
    expect(getParentProof(1_000 + PROOF_MAX_MS - 1)).toBe(PROOF);
    expect(getParentProof(1_000 + PROOF_MAX_MS)).toBeNull();
  });
  it("clearing with revoke ends it on the server too", () => {
    setParentProof(PROOF);
    clearParentProof({ revoke: true });
    expect(getParentProof()).toBeNull();
    expect(browserRpc).toHaveBeenCalledWith("close_parent_gate", { p_token: PROOF });
  });
  it("openParentGate stores the proof only on the right PIN; old databases fall back to verify", async () => {
    const fake = (impl: (fn: string) => unknown) => ({ rpc: vi.fn(async (fn: string) => impl(fn)) }) as unknown as SupabaseClient & { rpc: ReturnType<typeof vi.fn> };
    const wrong = fake(() => ({ data: { ok: false, reason: "invalid", attempts_left: 4 }, error: null }));
    expect(await openParentGate(wrong, "1111")).toMatchObject({ ok: false, reason: "invalid", attemptsLeft: 4 });
    expect(getParentProof()).toBeNull();
    const right = fake(() => ({ data: { ok: true, gate_token: PROOF, gate_expires_at: "2030-01-01T00:00:00Z" }, error: null }));
    expect(await openParentGate(right, "2468")).toMatchObject({ ok: true });
    expect(getParentProof()).toBe(PROOF);
    clearParentProof();
    const old = fake((fn) => (fn === "open_parent_gate" ? { data: null, error: { code: "PGRST202" } } : { data: { ok: true }, error: null }));
    expect(await openParentGate(old, "2468")).toMatchObject({ ok: true });
    expect(old.rpc).toHaveBeenLastCalledWith("verify_parent_pin", { p_pin: "2468" });
    expect(getParentProof()).toBeNull();
  });
});

describe("scripts/parent-notify.mjs", () => {
  it("sends the claimed reminders, reports gone endpoints and logs counts only", async () => {
    const calls: [string, Record<string, unknown>][] = [];
    const fakeRpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
      calls.push([fn, args]);
      if (fn === "parent_notify_claim")
        return {
          data: [
            { user_id: "u1", date: "2026-03-05", title: "Tuần của bé", body: "Tuần này bé đã nghe truyện 2 tối.", devices: [{ endpoint: "https://p/1", p256dh: "k", auth: "a" }, { endpoint: "https://p/gone", p256dh: "k", auth: "a" }] },
            { user_id: "u2", date: "2026-03-05", title: "Tuần của bé", body: "…", devices: [{ endpoint: "https://p/down", p256dh: "k", auth: "a" }] },
          ],
          error: null,
        };
      return { data: null, error: null };
    });
    const send = vi.fn(async (sub: { endpoint: string }, payload: string) => {
      expect(JSON.parse(payload)).toMatchObject({ kind: "parent", title: "Tuần của bé" });
      if (sub.endpoint.endsWith("gone")) throw Object.assign(new Error("gone"), { statusCode: 410 });
      if (sub.endpoint.endsWith("down")) throw Object.assign(new Error("down"), { statusCode: 500 });
    });
    const log = vi.fn();
    const totals = await runOnce({ rpc: fakeRpc, send, log, now: new Date("2026-03-05T12:05:00Z") });
    expect(totals).toEqual({ claimed: 2, sent: 1, failed: 1, gone: 1 });
    expect(calls[0]).toEqual(["parent_notify_claim", { p_now: "2026-03-05T12:05:00.000Z", p_limit: 200 }]);
    expect(calls[1]).toEqual(["parent_notify_finish", { p_user: "u1", p_date: "2026-03-05", p_status: "sent", p_sent: 1, p_gone: ["https://p/gone"] }]);
    expect(calls[2]).toEqual(["parent_notify_finish", { p_user: "u2", p_date: "2026-03-05", p_status: "failed", p_sent: 0, p_gone: [] }]);
    const line = log.mock.calls[0][0] as string;
    expect(line).not.toMatch(/u1|https:|Tuần này/);
  });
});
