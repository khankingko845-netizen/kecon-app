import { describe, expect, it, vi } from "vitest";
import { BackgroundPlayer, IDLE, markerFor, mergedPosition, visiblePage, type AudioTrack, type PlayerDeps } from "@/lib/background-player";
import type { Celebration } from "@/lib/missions";

/**
 * Trình nghe thu gọn (MiniPlayer) — page logic with fake audio elements and a
 * manual clock. Regressions from the mobile audit (PR #61): the mini player
 * stopped after 1–2 pages, jumped back to page 1, froze in continuous mode,
 * never credited the story and lost the sleep timer.
 */

class FakeAudio {
  paused = true;
  ended = false;
  currentTime = 0;
  duration = NaN;
  plays = 0;
  failPlay = false;
  onloadedmetadata: (() => void) | null = null;
  ontimeupdate: (() => void) | null = null;
  onplaying: (() => void) | null = null;
  onpause: (() => void) | null = null;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public src: string) {}
  play() {
    this.plays++;
    if (this.failPlay) return Promise.reject(new Error("NotAllowedError"));
    this.paused = false;
    this.ended = false;
    queueMicrotask(() => this.onplaying?.());
    return Promise.resolve();
  }
  pause() {
    if (this.paused) return;
    this.paused = true;
    // Like browsers: the "pause" event arrives later, not inside pause().
    queueMicrotask(() => this.onpause?.());
  }
  // ── test helpers ──
  load(duration: number) {
    this.duration = duration;
    this.onloadedmetadata?.();
  }
  at(time: number) {
    this.currentTime = time;
    this.ontimeupdate?.();
  }
  end() {
    this.currentTime = this.duration;
    this.paused = true;
    this.ended = true;
    this.onpause?.();
    this.onended?.();
  }
}

function harness(enabled = true) {
  let now = 1_000_000;
  let nextId = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const created: FakeAudio[] = [];
  const revoked: string[] = [];
  const deps: PlayerDeps = {
    createAudio: (url) => {
      const a = new FakeAudio(url);
      created.push(a);
      return a as unknown as HTMLAudioElement;
    },
    revoke: (url) => {
      revoked.push(url);
    },
    now: () => now,
    setTimer: (fn, ms) => {
      const id = ++nextId;
      timers.set(id, { at: now + ms, fn });
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: (t) => {
      timers.delete(t as unknown as number);
    },
  };
  const player = new BackgroundPlayer(deps, enabled);
  return {
    player,
    created,
    revoked,
    timers,
    snap: () => player.getSnapshot(),
    last: () => created[created.length - 1],
    /** Move the clock; due timers fire, then pending promises settle. */
    async tick(ms: number) {
      now += ms;
      for (const [id, t] of [...timers]) {
        if (t.at <= now) {
          timers.delete(id);
          t.fn();
        }
      }
      await flush();
    },
  };
}

const flush = () => new Promise<void>((done) => setTimeout(done, 0));

function playing(src: string, time = 0, duration = 10) {
  const a = new FakeAudio(src);
  a.paused = false;
  a.duration = duration;
  a.currentTime = time;
  return a;
}

const celebration = { kind: "listen", stars: 1 } as unknown as Celebration;

function track(over: Partial<AudioTrack> = {}): AudioTrack {
  return {
    storyId: "s1",
    storyTitle: "Sóc Nhỏ tìm hạt dẻ",
    pageNumber: 1,
    totalPages: 3,
    audioUrl: "https://cdn/p1.mp3",
    allPages: [
      { pageNumber: 1, audioUrl: "https://cdn/p1.mp3" },
      { pageNumber: 2, audioUrl: "https://cdn/p2.mp3" },
    ],
    pageGapMs: 1200,
    ...over,
  };
}

describe("BackgroundPlayer — taking over from the full player", () => {
  it("keeps the very same element playing (no restart, no second element)", async () => {
    const h = harness();
    const el = playing("https://cdn/p1.mp3", 4, 10);
    h.player.adopt(el as unknown as HTMLAudioElement, track());
    expect(h.created).toHaveLength(0);
    expect(el.plays).toBe(0);
    expect(el.paused).toBe(false);
    expect(h.snap()).toMatchObject({ status: "playing", isPlaying: true, currentTime: 4, duration: 10, progress: 40 });
    el.at(5);
    expect(h.snap().progress).toBe(50);
    await flush();
    expect(h.snap().status).toBe("playing");
  });

  it("a paused element is adopted as paused, and resumes in place", async () => {
    const h = harness();
    const el = playing("https://cdn/p1.mp3", 3, 10);
    el.paused = true;
    h.player.adopt(el as unknown as HTMLAudioElement, track());
    expect(h.snap()).toMatchObject({ status: "paused", isPlaying: false });
    h.player.resume();
    await flush();
    expect(el.plays).toBe(1);
    expect(el.currentTime).toBe(3);
    expect(h.created).toHaveLength(0);
    expect(h.snap()).toMatchObject({ status: "playing", isPlaying: true });
  });

  it("late media events do not contradict the element (pause then quick resume, and the reverse)", async () => {
    const h = harness();
    const el = playing("https://cdn/p1.mp3", 6, 10);
    h.player.adopt(el as unknown as HTMLAudioElement, track());
    h.player.pause();
    h.player.resume(); // the "pause" event of the first tap arrives after this
    await flush();
    expect(el.paused).toBe(false);
    expect(h.snap()).toMatchObject({ status: "playing", isPlaying: true });
    h.player.pause(); // a "playing" event from the resume arrives after this
    await flush();
    expect(el.paused).toBe(true);
    expect(h.snap()).toMatchObject({ status: "paused", isPlaying: false });
  });

  it("a system pause (phone call, headphones out) shows as paused; resume keeps the position", async () => {
    const h = harness();
    const el = playing("https://cdn/p1.mp3", 6, 10);
    h.player.adopt(el as unknown as HTMLAudioElement, track());
    el.pause();
    await flush();
    expect(h.snap()).toMatchObject({ status: "paused", isPlaying: false });
    h.player.resume();
    await flush();
    expect(el.currentTime).toBe(6);
    expect(h.created).toHaveLength(0);
    expect(h.snap().status).toBe("playing");
  });
});

describe("BackgroundPlayer — page after page until the story ends", () => {
  it("auto-advances with a breath, narrates unknown pages, credits the story once", async () => {
    const h = harness();
    const onComplete = vi.fn(async () => celebration);
    const resolvePage = vi.fn(async (n: number) => `blob:fresh-${n}`);
    const p1 = playing("https://cdn/p1.mp3", 9, 10);
    h.player.adopt(p1 as unknown as HTMLAudioElement, track({ resolvePage, onComplete }));

    p1.end();
    expect(h.snap()).toMatchObject({ status: "turning", isPlaying: true, pendingPage: 2, progress: 100 });
    expect(visiblePage(h.snap())).toBe(2);
    await flush();
    expect(h.created).toHaveLength(0); // still breathing between pages
    await h.tick(1199);
    expect(h.created).toHaveLength(0);
    await h.tick(1);
    expect(h.last().src).toBe("https://cdn/p2.mp3"); // known page: no narration
    expect(resolvePage).not.toHaveBeenCalled();
    expect(h.snap()).toMatchObject({ status: "playing", pendingPage: null, progress: 0 });
    expect(h.snap().track).toMatchObject({ pageNumber: 2, audioUrl: "https://cdn/p2.mp3" });

    h.last().load(8);
    h.last().end();
    await h.tick(1200);
    expect(resolvePage).toHaveBeenCalledWith(3);
    expect(h.last().src).toBe("blob:fresh-3");
    expect(h.snap().track?.pageNumber).toBe(3);

    h.last().load(5);
    h.last().end();
    await flush();
    expect(h.snap()).toMatchObject({ status: "ended", isPlaying: false, progress: 100, celebration });
    expect(onComplete).toHaveBeenCalledTimes(1);
    h.last().onended?.(); // a stray second "ended" does not credit twice
    await flush();
    expect(onComplete).toHaveBeenCalledTimes(1);

    h.player.dismissCelebration();
    expect(h.snap().celebration).toBeNull();
    h.player.stop();
    expect(h.revoked).toContain("blob:fresh-3"); // narration the player made itself
    expect(h.snap()).toBe(IDLE);
  });

  it("a page missing from allPages goes on to the NEXT page, never back to page 1", async () => {
    const h = harness();
    const resolvePage = vi.fn(async (n: number) => `blob:fresh-${n}`);
    // Page 2 was narrated fresh in the full player, so only page 1 is listed.
    const p2 = playing("blob:full-player-2", 7, 8);
    h.player.adopt(p2 as unknown as HTMLAudioElement, track({ pageNumber: 2, audioUrl: "blob:full-player-2", allPages: [{ pageNumber: 1, audioUrl: "https://cdn/p1.mp3" }], resolvePage }));
    p2.end();
    await h.tick(1200);
    expect(resolvePage).toHaveBeenCalledTimes(1);
    expect(resolvePage).toHaveBeenCalledWith(3);
    expect(h.created.map((a) => a.src)).toEqual(["blob:fresh-3"]);
    expect(h.snap().track?.pageNumber).toBe(3);
  });

  it("without any way to get the next page it shows an error instead of looping", async () => {
    const h = harness();
    const p2 = playing("https://cdn/p2.mp3", 7, 8);
    h.player.adopt(p2 as unknown as HTMLAudioElement, track({ pageNumber: 2, audioUrl: "https://cdn/p2.mp3" }));
    p2.end();
    await h.tick(1200);
    expect(h.created).toHaveLength(0);
    expect(h.snap()).toMatchObject({ status: "error", isPlaying: false, pendingPage: 3, error: "Chưa tải được trang 3" });
  });

  it("next/previous follow the page the child sees and stop at the ends", async () => {
    const h = harness();
    h.player.play(track({ pageNumber: 3, audioUrl: "https://cdn/p3.mp3", allPages: [...track().allPages!, { pageNumber: 3, audioUrl: "https://cdn/p3.mp3" }] }));
    expect(h.created.map((a) => a.src)).toEqual(["https://cdn/p3.mp3"]);
    h.player.nextPage(); // last page: nothing to skip to
    await flush();
    expect(h.created).toHaveLength(1);

    h.player.prevPage();
    expect(h.created[0].paused).toBe(true); // a jump silences the page right away
    expect(h.snap()).toMatchObject({ status: "turning", pendingPage: 2 });
    await flush();
    expect(h.last().src).toBe("https://cdn/p2.mp3");
    expect(h.snap().track?.pageNumber).toBe(2);

    h.player.prevPage();
    await flush();
    expect(h.snap().track?.pageNumber).toBe(1);

    // Auto-advance breath from page 1 → "Sang trang 2…": next goes to page 3, not page 2 again.
    h.last().load(5);
    h.last().end();
    expect(visiblePage(h.snap())).toBe(2);
    h.player.nextPage();
    await flush();
    expect(h.timers.size).toBe(0); // the breath was cancelled
    expect(h.last().src).toBe("https://cdn/p3.mp3");
    expect(h.snap().track?.pageNumber).toBe(3);
  });

  it("pausing during the breath between pages holds the next page until resume", async () => {
    const h = harness();
    const p1 = playing("https://cdn/p1.mp3", 9, 10);
    h.player.adopt(p1 as unknown as HTMLAudioElement, track());
    p1.end();
    h.player.pause();
    expect(h.snap()).toMatchObject({ status: "paused", isPlaying: false });
    await h.tick(5000);
    expect(h.created).toHaveLength(0);
    h.player.resume();
    await flush();
    expect(h.last().src).toBe("https://cdn/p2.mp3");
    expect(h.snap()).toMatchObject({ status: "playing", isPlaying: true });
    expect(h.snap().track?.pageNumber).toBe(2);
  });

  it("a page that cannot be narrated shows an error; tapping play tries that page again", async () => {
    const h = harness();
    const resolvePage = vi.fn().mockRejectedValueOnce(new Error("TTS 503")).mockResolvedValueOnce("blob:retry-3");
    const p2 = playing("https://cdn/p2.mp3", 7, 8);
    h.player.adopt(p2 as unknown as HTMLAudioElement, track({ pageNumber: 2, audioUrl: "https://cdn/p2.mp3", resolvePage }));
    p2.end();
    await h.tick(1200);
    expect(h.snap()).toMatchObject({ status: "error", isPlaying: false, pendingPage: 3, error: "Chưa tải được trang 3" });
    h.player.resume();
    await flush();
    expect(resolvePage).toHaveBeenCalledTimes(2);
    expect(h.last().src).toBe("blob:retry-3");
    expect(h.snap()).toMatchObject({ status: "playing", error: null });
  });

  it("drops (and revokes) narration that arrives after the child moved on", async () => {
    const h = harness();
    let finish: (u: string) => void = () => {};
    const resolvePage = vi.fn(() => new Promise<string>((done) => (finish = done)));
    const p2 = playing("https://cdn/p2.mp3", 7, 8);
    h.player.adopt(p2 as unknown as HTMLAudioElement, track({ pageNumber: 2, audioUrl: "https://cdn/p2.mp3", resolvePage, pageGapMs: 0 }));
    p2.end();
    await flush();
    expect(visiblePage(h.snap())).toBe(3); // "Sang trang 3…"
    h.player.prevPage(); // back to page 2 while page 3 is still being narrated
    await flush();
    expect(h.last().src).toBe("https://cdn/p2.mp3");
    finish("blob:late-3");
    await flush();
    expect(h.revoked).toContain("blob:late-3");
    expect(h.created.map((a) => a.src)).toEqual(["https://cdn/p2.mp3"]);
    expect(h.snap().track?.pageNumber).toBe(2);
  });

  it("an element that fails to play shows an error and resume restarts that page", async () => {
    const h = harness();
    h.player.play(track());
    h.last().onerror?.();
    expect(h.snap()).toMatchObject({ status: "error", error: "Chưa phát được trang 1", pendingPage: 1 });
    h.player.resume();
    await flush();
    expect(h.created).toHaveLength(2);
    expect(h.snap()).toMatchObject({ status: "playing", error: null });
  });

  it("autoplay refused by the browser leaves a paused player (tap to continue)", async () => {
    const h = harness();
    const deps = (h.player as unknown as { deps: PlayerDeps }).deps;
    const create = deps.createAudio;
    deps.createAudio = (url) => {
      const a = create(url) as unknown as FakeAudio;
      a.failPlay = true;
      return a as unknown as HTMLAudioElement;
    };
    h.player.play(track());
    await flush();
    expect(h.snap()).toMatchObject({ status: "paused", isPlaying: false });
  });

  it("an empty audioUrl (left between two pages) fetches that page first", async () => {
    const h = harness();
    h.player.play(track({ pageNumber: 2, audioUrl: "" }));
    expect(h.snap()).toMatchObject({ status: "turning", pendingPage: 2 });
    await flush();
    expect(h.last().src).toBe("https://cdn/p2.mp3");
  });

  it("replay after the end starts again from page 1", async () => {
    const h = harness();
    const onComplete = vi.fn();
    const p3 = playing("https://cdn/p3.mp3", 4, 5);
    h.player.adopt(p3 as unknown as HTMLAudioElement, track({ pageNumber: 3, audioUrl: "https://cdn/p3.mp3", onComplete }));
    p3.end();
    expect(h.snap().status).toBe("ended");
    h.player.resume(); // the main button after the end = "Nghe lại từ đầu"
    await flush();
    expect(h.last().src).toBe("https://cdn/p1.mp3");
    expect(h.snap()).toMatchObject({ status: "playing" });
    expect(h.snap().track?.pageNumber).toBe(1);
  });
});

describe("BackgroundPlayer — one merged file (continuous mode)", () => {
  const merged = () => track({ audioUrl: "blob:merged", allPages: undefined, pageMarkers: [0, 10, 20], ownedUrls: ["blob:merged"] });

  it("follows the page from the markers, and next/previous jump inside the file", async () => {
    const h = harness();
    const onComplete = vi.fn();
    const el = playing("blob:merged", 2, 30);
    h.player.adopt(el as unknown as HTMLAudioElement, { ...merged(), onComplete });
    el.at(15);
    expect(h.snap().track?.pageNumber).toBe(2);
    expect(h.snap().progress).toBe(50);

    h.player.nextPage();
    expect(el.currentTime).toBe(20);
    expect(h.snap().track?.pageNumber).toBe(3);
    h.player.nextPage(); // already on the last page
    expect(el.currentTime).toBe(20);

    h.player.prevPage();
    expect(el.currentTime).toBe(10);
    expect(h.snap().track?.pageNumber).toBe(2);
    expect(h.created).toHaveLength(0); // same element all along

    h.player.seekTo(50);
    expect(el.currentTime).toBe(15);
    await flush();

    el.end();
    await flush();
    expect(h.snap().status).toBe("ended");
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("play() of a merged track starts at the page's marker once metadata is known", () => {
    const h = harness();
    h.player.play({ ...merged(), pageNumber: 2 });
    const el = h.last();
    expect(el.currentTime).toBe(0);
    el.load(30);
    expect(el.currentTime).toBe(10);
    expect(h.snap().track?.pageNumber).toBe(2);
  });

  it("helpers: markerFor and mergedPosition", () => {
    expect(markerFor({ pageMarkers: [0, 10, 20] }, 3)).toBe(20);
    expect(markerFor({ pageMarkers: undefined }, 2)).toBe(0);
    expect(mergedPosition([0, 10, 20], 25, 30)).toEqual({ pageNumber: 3, progress: 50 });
    expect(mergedPosition([0, 10, 20], 0, 30)).toEqual({ pageNumber: 1, progress: 0 });
  });
});

describe("BackgroundPlayer — bedtime sleep timer", () => {
  it("pauses at the deadline carried over from the full player, then forgets it", async () => {
    const h = harness();
    const el = playing("https://cdn/p1.mp3", 1, 10);
    h.player.adopt(el as unknown as HTMLAudioElement, track({ sleepEndAt: 1_000_000 + 60_000 }));
    await h.tick(59_999);
    expect(el.paused).toBe(false);
    await h.tick(1);
    expect(el.paused).toBe(true);
    expect(h.snap()).toMatchObject({ status: "paused", isPlaying: false });
    expect(h.snap().track?.sleepEndAt).toBeNull();
    h.player.resume(); // the child (or parent) taps play again: no new deadline
    await flush();
    expect(el.paused).toBe(false);
    expect(h.timers.size).toBe(0);
  });

  it("also stops when timers were throttled in the background (checked on timeupdate)", async () => {
    const h = harness();
    const el = playing("https://cdn/p1.mp3", 1, 10);
    h.player.adopt(el as unknown as HTMLAudioElement, track({ sleepEndAt: 1_000_000 + 1_000 }));
    h.timers.clear(); // the OS never ran the timer
    await h.tick(2_000);
    el.at(3);
    expect(el.paused).toBe(true);
    expect(h.snap().status).toBe("paused");
  });

  it("a deadline reached during the breath between pages does not start the next page", async () => {
    const h = harness();
    const p1 = playing("https://cdn/p1.mp3", 9, 10);
    h.player.adopt(p1 as unknown as HTMLAudioElement, track({ sleepEndAt: 1_000_000 + 500 }));
    p1.end();
    await h.tick(1200);
    expect(h.created).toHaveLength(0);
    expect(h.snap()).toMatchObject({ status: "paused", isPlaying: false });
    h.player.resume();
    await flush();
    expect(h.last().src).toBe("https://cdn/p2.mp3");
  });
});

describe("BackgroundPlayer — handing back, stopping, switching", () => {
  it("release() hands the playing element back to the full player of the same story", async () => {
    const h = harness();
    const el = playing("https://cdn/p1.mp3", 4, 10);
    const t = track({ ownedUrls: ["blob:prefetch-2"] });
    h.player.adopt(el as unknown as HTMLAudioElement, t);
    expect(h.player.release("other-story")).toBeNull();
    const r = h.player.release("s1");
    expect(r?.audio).toBe(el);
    expect(r?.playing).toBe(true);
    expect(r?.track.pageNumber).toBe(1);
    expect(el.paused).toBe(false); // keeps playing for the full player
    expect(el.onended).toBeNull(); // no longer driven by the mini player
    expect(h.snap()).toBe(IDLE);
    expect(h.revoked).toEqual([]); // blobs go back with the track
  });

  it("release() between two pages tells the full player which page comes next", async () => {
    const h = harness();
    const p1 = playing("https://cdn/p1.mp3", 9, 10);
    h.player.adopt(p1 as unknown as HTMLAudioElement, track());
    p1.end();
    const r = h.player.release("s1");
    expect(r).toMatchObject({ audio: null, playing: true });
    expect(r?.track.pageNumber).toBe(2);
    await h.tick(1200);
    expect(h.created).toHaveLength(0); // the turn was cancelled
  });

  it("stop() silences the story and revokes the blobs it owns", () => {
    const h = harness();
    const el = playing("blob:merged", 4, 10);
    h.player.adopt(el as unknown as HTMLAudioElement, track({ ownedUrls: ["blob:merged", "blob:prefetch-2"] }));
    h.player.stop();
    expect(el.paused).toBe(true);
    expect(h.revoked.sort()).toEqual(["blob:merged", "blob:prefetch-2"]);
    expect(h.snap()).toBe(IDLE);
  });

  it("another story replaces the current one: the old element stops (never two voices)", () => {
    const h = harness();
    const a = playing("https://cdn/a1.mp3", 4, 10);
    h.player.adopt(a as unknown as HTMLAudioElement, track({ ownedUrls: ["blob:a"] }));
    const b = playing("https://cdn/b1.mp3", 0, 10);
    h.player.adopt(b as unknown as HTMLAudioElement, track({ storyId: "s2", storyTitle: "Thỏ con", audioUrl: "https://cdn/b1.mp3" }));
    expect(a.paused).toBe(true);
    expect(a.onended).toBeNull();
    expect(b.paused).toBe(false);
    expect(h.revoked).toEqual(["blob:a"]);
    expect(h.snap().track?.storyId).toBe("s2");
  });

  it("with narration switched off nothing plays", () => {
    const h = harness(false);
    const el = playing("https://cdn/p1.mp3", 4, 10);
    h.player.adopt(el as unknown as HTMLAudioElement, track());
    expect(el.paused).toBe(true);
    expect(h.snap()).toBe(IDLE);
    h.player.play(track());
    expect(h.created).toHaveLength(0);

    const on = harness();
    const el2 = playing("https://cdn/p1.mp3", 4, 10);
    on.player.adopt(el2 as unknown as HTMLAudioElement, track());
    on.player.setEnabled(false);
    expect(el2.paused).toBe(true);
    expect(on.snap()).toBe(IDLE);
  });

  it("listeners hear every change and can unsubscribe", () => {
    const h = harness();
    const fn = vi.fn();
    const off = h.player.subscribe(fn);
    h.player.play(track());
    expect(fn).toHaveBeenCalled();
    off();
    fn.mockClear();
    h.player.stop();
    expect(fn).not.toHaveBeenCalled();
  });
});
