import { describe, expect, it, vi } from "vitest";
import { ListenRecord, MIN_LISTEN_SECONDS, playSessionOf, type ListenWho, type PlaySessionStore } from "@/lib/listen-log";

/**
 * Lượt nghe (PR #62): one play_sessions row per listen. Before, leaving the
 * full player while the story went on in the MiniPlayer wrote a row without
 * the minutes heard there, and reopening the story wrote a second row — two
 * plays counted for one listen.
 */

const who: ListenWho = { storyId: "s1", totalPages: 3, voiceId: null, userId: "u1" };

function store(opts: { insert?: (n: number) => Promise<string | null>; update?: () => Promise<boolean> } = {}) {
  const calls: string[] = [];
  const inserts: unknown[] = [];
  const updates: { id: string; input: unknown }[] = [];
  const minutes: number[] = [];
  const s: PlaySessionStore = {
    insert: vi.fn(async (input) => {
      calls.push("insert");
      inserts.push(input);
      return opts.insert ? opts.insert(inserts.length) : `row-${inserts.length}`;
    }),
    update: vi.fn(async (id, input) => {
      calls.push("update");
      updates.push({ id, input });
      return opts.update ? opts.update() : true;
    }),
    addMinutes: vi.fn(async (m: number) => {
      calls.push(`+${m}min`);
      minutes.push(m);
    }),
  };
  return { s, calls, inserts, updates, minutes };
}

describe("playSessionOf — what the row says", () => {
  it("shorter than 2 s is a mis-tap: nothing is written", () => {
    expect(MIN_LISTEN_SECONDS).toBe(2);
    expect(playSessionOf({ ms: 1400, pages: [1] }, 3)).toBeNull();
    expect(playSessionOf({ ms: Number.NaN, pages: [1] }, 3)).toBeNull();
    expect(playSessionOf({ ms: 2000, pages: [1] }, 3)).toEqual({ duration: 2, pagesListened: 1, completed: false });
  });

  it("counts each page once, only real pages; completed when every page was heard", () => {
    expect(playSessionOf({ ms: 61_600, pages: [1, 2, 2, 0, 4, 1.5] }, 3)).toEqual({ duration: 62, pagesListened: 2, completed: false });
    expect(playSessionOf({ ms: 9000, pages: [3, 1, 2] }, 3)).toEqual({ duration: 9, pagesListened: 3, completed: true });
    expect(playSessionOf({ ms: 9000, pages: [1] }, 0)).toEqual({ duration: 9, pagesListened: 1, completed: true });
  });
});

describe("ListenRecord — one row per listen", () => {
  it("the first save adds the row, later saves update that same row (one play counted)", async () => {
    const st = store();
    const r = new ListenRecord({ ...who }, st.s);
    await r.save({ ms: 5000, pages: [1] });
    await r.save({ ms: 9000, pages: [1, 2] });
    await r.save({ ms: 14_000, pages: [1, 2, 3] });
    expect(st.inserts).toEqual([{ storyId: "s1", voiceId: null, userId: "u1", duration: 5, pagesListened: 1, completed: false }]);
    expect(st.updates).toEqual([
      { id: "row-1", input: { userId: "u1", duration: 9, pagesListened: 2, completed: false } },
      { id: "row-1", input: { userId: "u1", duration: 14, pagesListened: 3, completed: true } },
    ]);
  });

  it("saves issued back to back are written in order — the update waits for the row", async () => {
    let release!: (id: string) => void;
    const st = store({ insert: () => new Promise((done) => (release = done)) });
    const r = new ListenRecord({ ...who }, st.s);
    void r.save({ ms: 3000, pages: [1] });
    const last = r.save({ ms: 8000, pages: [1, 2] });
    await Promise.resolve();
    expect(st.calls).toEqual(["insert"]);
    release("row-x");
    await last;
    expect(st.calls).toEqual(["insert", "update"]);
    expect(st.updates[0].id).toBe("row-x");
  });

  it("minutes go to the reading streak once in total, not once per save", async () => {
    const st = store();
    const r = new ListenRecord({ ...who }, st.s);
    await r.save({ ms: 20_000, pages: [1] }); // 0 min
    await r.save({ ms: 90_000, pages: [1] }); // 2 min (rounded, like before)
    await r.save({ ms: 100_000, pages: [1, 2] }); // still 2
    await r.save({ ms: 200_000, pages: [1, 2, 3] }); // 3
    expect(st.minutes).toEqual([2, 1]);
    expect(st.minutes.reduce((a, b) => a + b, 0)).toBe(Math.round(200 / 60));
  });

  it("too short → nothing written, no play counted", async () => {
    const st = store();
    const r = new ListenRecord({ ...who }, st.s);
    await r.save({ ms: 1200, pages: [1] });
    expect(st.calls).toEqual([]);
  });

  it("not written (signed out, another account, refused) → no minutes; the next save tries to add it again", async () => {
    const st = store({ insert: async (n) => (n === 1 ? null : "row-2") });
    const r = new ListenRecord({ ...who }, st.s);
    await r.save({ ms: 120_000, pages: [1] });
    expect(st.minutes).toEqual([]);
    await r.save({ ms: 130_000, pages: [1, 2] });
    expect(st.calls).toEqual(["insert", "insert", "+2min"]);

    const up = store({ update: async () => false });
    const r2 = new ListenRecord({ ...who }, up.s);
    await r2.save({ ms: 3000, pages: [1] });
    await r2.save({ ms: 200_000, pages: [1] });
    expect(up.minutes).toEqual([]);
  });

  it("a failing database call never breaks later saves", async () => {
    const st = store();
    let fail = true;
    (st.s.insert as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      if (fail) throw new Error("offline");
      return "row-ok";
    });
    const r = new ListenRecord({ ...who }, st.s);
    await expect(r.save({ ms: 3000, pages: [1] })).resolves.toBeUndefined();
    fail = false;
    await r.save({ ms: 4000, pages: [1] });
    expect(st.s.insert).toHaveBeenCalledTimes(2);
  });

  it("who listened is fixed at save time (a later change does not rewrite a queued save)", async () => {
    const st = store();
    const r = new ListenRecord({ ...who, voiceId: "family-voice" }, st.s);
    const p = r.save({ ms: 3000, pages: [1] });
    r.who = { ...r.who, voiceId: "another" };
    await p;
    expect(st.inserts[0]).toMatchObject({ voiceId: "family-voice", userId: "u1" });
  });
});
