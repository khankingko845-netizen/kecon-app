/**
 * Trình nghe thu gọn (MiniPlayer): the story keeps playing after the child
 * leaves the full player, page after page, until the story ends — then it
 * credits the story (stars/sticker) like the full player would.
 *
 * Framework-free on purpose: the page logic is unit-tested with fake audio
 * elements (tests/unit/background-player.test.ts); the React provider only
 * mirrors the snapshot (src/lib/audio-player-context.tsx).
 *
 * Lượt nghe: a listen that began in the full player goes on here (same row in
 * play_sessions, see src/lib/listen-log.ts) — its clock runs only while the
 * story plays, and it is written when the story ends, is closed or replaced.
 */
import { getPageAtTime } from "@/lib/audio-merger";
import type { Celebration } from "@/lib/missions";
import type { AudioOwner, SharedAudio } from "@/lib/shared-audio";

export interface PageAudio {
  pageNumber: number;
  audioUrl: string;
}

/** One listen of a story so far — it travels between the full player and the mini player. */
export interface ListenLog {
  /** Listening time (ms). */
  ms: number;
  /** Pages heard, 1-based, each once. */
  pages: number[];
}

/** Where a listen is written: the first save adds it, later saves update it (src/lib/listen-log.ts). */
export interface ListenSink {
  save(log: ListenLog): unknown;
}

export interface CarriedListen {
  log: ListenLog;
  sink: ListenSink;
}

export interface AudioTrack {
  storyId: string;
  storyTitle: string;
  /** 1-based page that is audible now. */
  pageNumber: number;
  totalPages: number;
  audioUrl: string;
  coverUrl?: string | null;
  /** Per-page mode: pages whose audio URL is already known (looked up by pageNumber). */
  allPages?: PageAudio[];
  /** Per-page mode: cached audio or fresh narration for a page not listed in allPages. */
  resolvePage?: (pageNumber: number) => Promise<string | null>;
  /** Continuous mode: one merged file; page i starts at pageMarkers[i] seconds. */
  pageMarkers?: number[];
  /** Breath between pages in per-page mode — same pace as the full player. */
  pageGapMs?: number;
  /** Bedtime sleep timer carried over from the full player (epoch ms). */
  sleepEndAt?: number | null;
  /** The last page finished in the mini player: credit the story (stars, "complete"). */
  onComplete?: () => Promise<Celebration | null> | void;
  /** blob: URLs this track owns — revoked when the track is dropped, kept when handed back. */
  ownedUrls?: string[];
  /** Opaque state the full player needs to take the audio back without a restart. */
  handoff?: unknown;
  /** The listen the full player had begun: it goes on here instead of counting a second one. */
  listen?: CarriedListen;
  /** Where a new listen of this story is written ("Nghe lại từ đầu" after the end). */
  newListen?: () => ListenSink;
}

export type PlayerStatus = "idle" | "playing" | "paused" | "turning" | "ended" | "error";

export interface PlayerSnapshot {
  track: AudioTrack | null;
  status: PlayerStatus;
  /** Playing, or turning to the next page on its own. */
  isPlaying: boolean;
  /** 0–100 inside the current page. */
  progress: number;
  currentTime: number;
  duration: number;
  error: string | null;
  /** Page being fetched/started ("turning") or that failed ("error"). */
  pendingPage: number | null;
  celebration: Celebration | null;
}

export interface Released {
  /** The element keeps playing — null while the player was between two pages. */
  audio: HTMLAudioElement | null;
  /** `track.listen`: the listen in progress goes on in the full player (none after the story ended). */
  track: AudioTrack;
  /** The child was listening (playing or turning the page). */
  playing: boolean;
}

type Timer = ReturnType<typeof setTimeout>;

export interface PlayerDeps {
  /**
   * The element that plays `url`. The app hands out its one shared narration
   * element (src/lib/shared-audio.ts — iPhone only lets an element that was
   * started by a tap play on its own) and calls `lost` when the full player
   * takes it for another story.
   */
  createAudio: (url: string, lost: () => void) => HTMLAudioElement;
  /** The full player's element is ours now (hand-over); `lost` as above. */
  claimAudio?: (audio: HTMLAudioElement, lost: () => void) => void;
  revoke: (url: string) => void;
  now: () => number;
  setTimer: (fn: () => void, ms: number) => Timer;
  clearTimer: (t: Timer) => void;
  /** Monotonic ms for listening time (default: `now`). */
  clock?: () => number;
}

export const IDLE: PlayerSnapshot = Object.freeze({
  track: null,
  status: "idle",
  isPlaying: false,
  progress: 0,
  currentTime: 0,
  duration: 0,
  error: null,
  pendingPage: null,
  celebration: null,
}) as PlayerSnapshot;

const clamp = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 0);

/**
 * PlayerDeps.createAudio/claimAudio on the shared narration element: every page
 * plays on that one element (iPhone), and the player is told when the full
 * player takes it.
 */
export function sharedElementAudio(shared: SharedAudio): Pick<PlayerDeps, "createAudio" | "claimAudio"> {
  let onLost = () => {};
  const owner: AudioOwner = { lost: () => onLost() };
  return {
    createAudio: (url, lost) => {
      onLost = lost;
      return shared.take(owner, url);
    },
    claimAudio: (_audio, lost) => {
      onLost = lost;
      shared.adopt(owner);
    },
  };
}

/** The page the child sees: the one being fetched/started ("turning") or that failed, else the audible one. */
export function visiblePage(s: Pick<PlayerSnapshot, "track" | "status" | "pendingPage">): number {
  if (!s.track) return 0;
  return s.status === "turning" || s.status === "error" ? (s.pendingPage ?? s.track.pageNumber) : s.track.pageNumber;
}

/** Where a page starts in continuous mode (0 when unknown). */
export function markerFor(track: Pick<AudioTrack, "pageMarkers">, pageNumber: number): number {
  return track.pageMarkers?.[pageNumber - 1] ?? 0;
}

/** Page (1-based) and progress inside it for continuous playback at `time`. */
export function mergedPosition(markers: number[], time: number, duration: number): { pageNumber: number; progress: number } {
  const idx = getPageAtTime(time, markers);
  const start = markers[idx] ?? 0;
  const end = markers[idx + 1] ?? duration;
  return { pageNumber: idx + 1, progress: end > start ? clamp(((time - start) / (end - start)) * 100) : 0 };
}

export class BackgroundPlayer {
  private audio: HTMLAudioElement | null = null;
  private snap: PlayerSnapshot = IDLE;
  private listeners = new Set<() => void>();
  /** Bumped by every action that changes what plays: late async work from before is dropped. */
  private gen = 0;
  private turnTimer: Timer | null = null;
  private sleepTimer: Timer | null = null;
  private pendingSeek: number | null = null;
  /** Page to start when the child taps play after pausing between two pages / an error. */
  private resumePage: number | null = null;
  /** Fresh narration (blob:) for the current page that the player made itself. */
  private pageBlob: string | null = null;
  private completed = false;
  /** The listen in progress; `since` = when its clock last started (null: stopped). */
  private listen: { log: ListenLog; sink: ListenSink; since: number | null } | null = null;

  /** "Giọng đọc truyện" switch: off → nothing may play. */
  private on: boolean;

  constructor(
    private deps: PlayerDeps,
    enabled = true,
  ) {
    this.on = enabled;
  }

  setEnabled(on: boolean) {
    this.on = on;
    if (!on) this.stop();
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getSnapshot = (): PlayerSnapshot => this.snap;

  private set(patch: Partial<PlayerSnapshot>) {
    this.snap = { ...this.snap, ...patch };
    this.syncClock();
    for (const l of this.listeners) l();
  }

  // ── take over / hand back ────────────────────────────────────────────────

  /** The full player was left while narrating: keep that very element playing here. */
  adopt(audio: HTMLAudioElement, track: AudioTrack) {
    if (!this.on) {
      audio.pause();
      return;
    }
    this.gen++;
    this.clearTurn();
    this.openListen(track);
    this.dropElement(audio);
    this.dropOwned(track);
    this.audio = audio;
    this.deps.claimAudio?.(audio, this.lostAudio);
    this.pageBlob = null;
    this.completed = false;
    this.resumePage = null;
    this.wire(audio);
    const playing = !audio.paused && !audio.ended;
    this.snap = { ...IDLE, track: { ...track, listen: undefined }, status: playing ? "playing" : "paused", isPlaying: playing };
    this.tick(audio);
    this.heard(this.snap.track?.pageNumber ?? track.pageNumber);
    this.armSleep(track);
    this.emit();
  }

  /** The full player of the same story opens: it takes the audio back without a restart. */
  release(storyId: string): Released | null {
    const t = this.snap.track;
    if (!t || t.storyId !== storyId) return null;
    const audio = this.audio;
    const { status, isPlaying, pendingPage } = this.snap;
    const listen = this.takeListen();
    this.gen++;
    this.clearTurn();
    this.clearSleep();
    if (audio) this.unwire(audio);
    const handOver = !!audio && !audio.ended && status !== "turning" && status !== "error";
    if (!handOver) {
      audio?.pause();
      if (this.pageBlob) this.deps.revoke(this.pageBlob);
    }
    this.audio = null;
    this.pageBlob = null;
    this.pendingSeek = null;
    this.resumePage = null;
    this.snap = IDLE;
    this.emit();
    if (!handOver) {
      // Between two pages (or a failed one): the full player goes on from that page.
      const page = pendingPage ?? t.pageNumber;
      return { audio: null, track: { ...t, pageNumber: Math.min(t.totalPages, Math.max(1, page)), listen }, playing: status === "turning" && isPlaying };
    }
    return { audio, track: listen ? { ...t, listen } : t, playing: isPlaying && !audio!.paused };
  }

  // ── playback ─────────────────────────────────────────────────────────────

  /**
   * Start `track.audioUrl` at `track.pageNumber` (continuous mode: from that page's marker).
   * No URL yet (the player was between two pages): fetch that page first.
   */
  play(track: AudioTrack) {
    if (!this.on) return;
    this.openListen(track);
    this.dropOwned(track);
    const t = { ...track, listen: undefined };
    if (!track.audioUrl) {
      this.gen++;
      this.clearTurn();
      this.dropElement(null);
      this.resumePage = null;
      this.completed = false;
      this.snap = { ...IDLE, track: t };
      this.emit();
      this.armSleep(t);
      this.turnTo(t.pageNumber, 0);
      return;
    }
    this.startElement(t, t.audioUrl, t.pageMarkers ? markerFor(t, t.pageNumber) : 0, false);
  }

  pause() {
    const s = this.snap;
    if (!s.track) return;
    if (s.status === "turning") {
      this.gen++;
      this.clearTurn();
      this.resumePage = s.pendingPage;
    }
    this.audio?.pause();
    this.set({ isPlaying: false, status: s.status === "ended" ? "ended" : s.status === "error" ? "error" : "paused" });
  }

  resume() {
    const s = this.snap;
    if (!s.track || !this.on) return;
    if (s.status === "ended") return this.replay();
    if (this.resumePage !== null || !this.audio || this.audio.ended) {
      const page = this.resumePage ?? s.track.pageNumber;
      this.resumePage = null;
      return this.goTo(Math.min(s.track.totalPages, Math.max(1, page)));
    }
    const audio = this.audio;
    const gen = this.gen;
    audio.play().catch(() => {
      if (gen === this.gen && audio === this.audio) this.set({ isPlaying: false, status: "paused" });
    });
    this.set({ isPlaying: true, status: "playing", error: null, pendingPage: null });
  }

  /** Listen again from page 1 after the story ended. */
  replay() {
    const t = this.snap.track;
    if (!t) return;
    this.goTo(1);
  }

  stop() {
    this.endListen();
    this.gen++;
    this.clearTurn();
    this.clearSleep();
    this.dropElement(null);
    this.dropOwned(null);
    this.resumePage = null;
    this.completed = false;
    this.snap = IDLE;
    this.emit();
  }

  /** Seek inside the current page (0–100). */
  seekTo(pct: number) {
    const a = this.audio;
    const t = this.snap.track;
    if (!a || !t || !a.duration) return;
    if (t.pageMarkers?.length) {
      const start = markerFor(t, t.pageNumber);
      const end = t.pageMarkers[t.pageNumber] ?? a.duration;
      a.currentTime = start + (clamp(pct) / 100) * (end - start);
    } else {
      a.currentTime = (clamp(pct) / 100) * a.duration;
    }
    this.tick(a);
  }

  /** Relative to the page the child sees (see visiblePage), like the buttons around it. */
  nextPage() {
    const t = this.snap.track;
    if (!t) return;
    const page = visiblePage(this.snap);
    if (page < t.totalPages) this.goTo(page + 1);
  }

  prevPage() {
    const t = this.snap.track;
    if (!t) return;
    this.goTo(Math.max(1, visiblePage(this.snap) - 1));
  }

  dismissCelebration() {
    if (this.snap.celebration) this.set({ celebration: null });
  }

  /** The app goes to the background (it may not come back): write the listen so far — it goes on. */
  checkpoint() {
    const l = this.listen;
    if (!l) return;
    this.syncClock();
    this.saveListen(l);
  }

  // ── internals ────────────────────────────────────────────────────────────

  private emit() {
    this.syncClock();
    for (const l of this.listeners) l();
  }

  // ── lượt nghe ────────────────────────────────────────────────────────────

  private clock() {
    return (this.deps.clock ?? this.deps.now)();
  }

  /** A track arrives from the full player: its listen goes on here (the one before ends). */
  private openListen(track: AudioTrack) {
    this.endListen();
    const c = track.listen;
    if (c) this.listen = { log: { ms: Math.max(0, c.log.ms), pages: [...c.log.pages] }, sink: c.sink, since: null };
  }

  /** A page is heard. No listen open (the story had ended → "Nghe lại từ đầu"): a new one begins. */
  private heard(page: number) {
    if (!this.listen) {
      const sink = this.snap.track?.newListen?.();
      if (!sink) return;
      this.listen = { log: { ms: 0, pages: [] }, sink, since: null };
    }
    if (!this.listen.log.pages.includes(page)) this.listen.log.pages.push(page);
    this.syncClock();
  }

  /** The clock runs while the story plays or turns to the next page on its own — not while paused. */
  private syncClock() {
    const l = this.listen;
    if (!l) return;
    const now = this.clock();
    if (l.since !== null) l.log.ms += Math.max(0, now - l.since);
    l.since = this.snap.isPlaying ? now : null;
  }

  private saveListen(l: { log: ListenLog; sink: ListenSink }) {
    try {
      l.sink.save({ ms: l.log.ms, pages: [...l.log.pages] });
    } catch {
      /* writing the history never stops the story */
    }
  }

  /** The listen is over (story ended, closed, replaced): written once more, then closed. */
  private endListen() {
    const l = this.listen;
    if (!l) return;
    this.syncClock();
    this.listen = null;
    this.saveListen(l);
  }

  /** The full player takes the story back: the listen goes on there (not written here). */
  private takeListen(): CarriedListen | undefined {
    const l = this.listen;
    if (!l) return undefined;
    this.syncClock();
    this.listen = null;
    return { log: { ms: l.log.ms, pages: [...l.log.pages] }, sink: l.sink };
  }

  /** Jump to a page and play it (user action or auto-advance). */
  private goTo(pageNumber: number) {
    const t = this.snap.track;
    if (!t || !this.on) return;
    if (t.pageMarkers?.length && !this.audio && t.audioUrl) {
      // Continuous mode after the full player took the element: the merged file again, from that page.
      this.startElement({ ...t, pageNumber }, t.audioUrl, markerFor(t, pageNumber), false);
      return;
    }
    if (t.pageMarkers?.length && this.audio) {
      const a = this.audio;
      this.gen++;
      this.clearTurn();
      this.resumePage = null;
      this.completed = false;
      a.currentTime = markerFor(t, pageNumber);
      const gen = this.gen;
      a.play().catch(() => {
        if (gen === this.gen && a === this.audio) this.set({ isPlaying: false, status: "paused" });
      });
      this.set({ track: { ...t, pageNumber }, isPlaying: true, status: "playing", progress: 0, error: null, pendingPage: null, celebration: null });
      this.heard(pageNumber);
      return;
    }
    this.turnTo(pageNumber, 0);
  }

  /** Per-page mode: find the page audio (known URL → cache → fresh narration), then play it. */
  private turnTo(pageNumber: number, gapMs: number) {
    const t = this.snap.track;
    if (!t) return;
    const gen = ++this.gen;
    this.clearTurn();
    this.resumePage = null;
    this.set({ status: "turning", isPlaying: true, error: null, pendingPage: pageNumber, celebration: null, ...(gapMs ? { progress: 100 } : {}) });
    // A jump stops the page that is playing right away (auto-advance: it already ended).
    this.audio?.pause();
    const known = t.allPages?.find((p) => p.pageNumber === pageNumber)?.audioUrl ?? null;
    const url: Promise<{ url: string | null; fresh: boolean }> = known
      ? Promise.resolve({ url: known, fresh: false })
      : t.resolvePage
        ? t.resolvePage(pageNumber).then((u) => ({ url: u, fresh: true }))
        : Promise.resolve({ url: null, fresh: false });
    const breath = new Promise<void>((done) => {
      if (gapMs <= 0) return done();
      this.turnTimer = this.deps.setTimer(done, gapMs);
    });
    Promise.all([url, breath])
      .then(([{ url: u, fresh }]) => {
        if (gen !== this.gen) {
          if (fresh && u?.startsWith("blob:")) this.deps.revoke(u);
          return;
        }
        if (!u) return this.failTurn(pageNumber);
        const cur = this.snap.track ?? t;
        this.startElement({ ...cur, pageNumber }, u, 0, fresh);
      })
      .catch(() => {
        if (gen === this.gen) this.failTurn(pageNumber);
      });
  }

  private lostAudio = () => this.onLost();

  /**
   * The full player took the shared narration element for another story: let go
   * of it but keep the place — "Nghe tiếp" starts that page again (the element is
   * the full player's now: not paused or rewired here).
   */
  private onLost() {
    const s = this.snap;
    const t = s.track;
    const a = this.audio;
    if (!t || (!a && s.status !== "turning")) return;
    if (a) this.unwire(a);
    this.audio = null;
    this.pendingSeek = null;
    this.gen++;
    this.clearTurn();
    // Between two pages (or a page that failed): the coming page is the place.
    const between = s.status === "turning" || s.status === "error";
    const page = between ? (s.pendingPage ?? t.pageNumber) : t.pageNumber;
    let track = between ? { ...t, pageNumber: page } : t;
    const blob = this.pageBlob;
    this.pageBlob = null;
    if (blob) {
      // Fresh narration of the page that played: kept for "Nghe tiếp" (revoked with the track).
      track = {
        ...track,
        allPages: [...(t.allPages ?? []).filter((p) => p.pageNumber !== t.pageNumber), { pageNumber: t.pageNumber, audioUrl: blob }],
        ownedUrls: [...(t.ownedUrls ?? []), blob],
      };
    }
    this.resumePage = s.status === "ended" ? null : page;
    if (s.status === "ended" || s.status === "error") return this.set({ track, isPlaying: false });
    this.set({ track, isPlaying: false, status: "paused", pendingPage: null });
  }

  private failTurn(pageNumber: number) {
    this.resumePage = pageNumber;
    this.set({ status: "error", isPlaying: false, error: `Chưa tải được trang ${pageNumber}`, pendingPage: pageNumber });
  }

  private startElement(track: AudioTrack, url: string, seek: number, fresh: boolean) {
    const gen = ++this.gen;
    this.clearTurn();
    const keepBlob = this.pageBlob === url;
    this.dropElement(null, keepBlob);
    const audio = this.deps.createAudio(url, this.lostAudio);
    this.audio = audio;
    this.pageBlob = fresh && url.startsWith("blob:") ? url : keepBlob ? url : null;
    this.pendingSeek = seek > 0 ? seek : null;
    this.resumePage = null;
    this.completed = false;
    this.wire(audio);
    const t = { ...track, audioUrl: url };
    this.snap = { ...this.snap, track: t, status: "playing", isPlaying: true, progress: 0, currentTime: 0, duration: 0, error: null, pendingPage: null, celebration: null };
    this.emit();
    this.heard(t.pageNumber);
    this.armSleep(t);
    audio.play().catch(() => {
      if (gen === this.gen && audio === this.audio) this.set({ isPlaying: false, status: "paused" });
    });
  }

  private wire(audio: HTMLAudioElement) {
    audio.onloadedmetadata = () => {
      if (audio !== this.audio) return;
      if (this.pendingSeek !== null) {
        audio.currentTime = this.pendingSeek;
        this.pendingSeek = null;
      }
      this.tick(audio);
    };
    audio.ontimeupdate = () => {
      if (audio === this.audio) this.tick(audio);
    };
    // Media events arrive later than play()/pause(): trust the element's state, not the event.
    audio.onplaying = () => {
      if (audio === this.audio && !audio.paused && this.snap.status !== "playing") this.set({ isPlaying: true, status: "playing" });
    };
    audio.onpause = () => {
      // Paused by the system (call, headphones out): show it. The end of a page also pauses — ignore.
      if (audio === this.audio && audio.paused && !audio.ended && this.snap.status === "playing") this.set({ isPlaying: false, status: "paused" });
    };
    audio.onended = () => {
      if (audio !== this.audio || !this.on) return;
      this.onEnded();
    };
    audio.onerror = () => {
      if (audio !== this.audio) return;
      const t = this.snap.track;
      this.resumePage = t ? t.pageNumber : null;
      this.set({ isPlaying: false, status: "error", error: t ? `Chưa phát được trang ${t.pageNumber}` : "Chưa phát được", pendingPage: t?.pageNumber ?? null });
    };
  }

  private unwire(audio: HTMLAudioElement) {
    audio.onloadedmetadata = null;
    audio.ontimeupdate = null;
    audio.onplaying = null;
    audio.onpause = null;
    audio.onended = null;
    audio.onerror = null;
  }

  private tick(audio: HTMLAudioElement) {
    const t = this.snap.track;
    if (!t) return;
    const time = audio.currentTime || 0;
    const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    if (t.sleepEndAt && this.deps.now() >= t.sleepEndAt) return this.sleepNow();
    if (t.pageMarkers?.length) {
      const { pageNumber, progress } = mergedPosition(t.pageMarkers, time, duration);
      this.set({ currentTime: time, duration, progress, track: pageNumber !== t.pageNumber ? { ...t, pageNumber } : t });
      if (pageNumber !== t.pageNumber) this.heard(pageNumber);
    } else {
      this.set({ currentTime: time, duration, progress: duration ? clamp((time / duration) * 100) : 0 });
    }
  }

  private onEnded() {
    const t = this.snap.track;
    if (!t) return;
    if (t.pageMarkers?.length || t.pageNumber >= t.totalPages) return this.finish();
    this.turnTo(t.pageNumber + 1, t.pageGapMs ?? 0);
  }

  private finish() {
    const t = this.snap.track;
    if (!t) return;
    this.set({ isPlaying: false, status: "ended", progress: 100 });
    this.endListen();
    if (this.completed) return;
    this.completed = true;
    const r = t.onComplete?.();
    if (r && typeof (r as Promise<Celebration | null>).then === "function") {
      (r as Promise<Celebration | null>)
        .then((c) => {
          if (c && this.snap.track?.storyId === t.storyId) this.set({ celebration: c });
        })
        .catch(() => {});
    }
  }

  private armSleep(track: AudioTrack) {
    this.clearSleep();
    const end = track.sleepEndAt;
    if (!end) return;
    const ms = end - this.deps.now();
    if (ms <= 0) return this.sleepNow();
    this.sleepTimer = this.deps.setTimer(() => this.sleepNow(), ms);
  }

  /** Sleep timer ran out: pause, and the timer is used up. */
  private sleepNow() {
    this.clearSleep();
    const t = this.snap.track;
    if (!t) return;
    if (this.snap.status === "turning") {
      this.gen++;
      this.clearTurn();
      this.resumePage = this.snap.pendingPage;
    }
    this.audio?.pause();
    const status = this.snap.status === "ended" || this.snap.status === "error" ? this.snap.status : "paused";
    this.set({ track: { ...t, sleepEndAt: null }, isPlaying: false, status });
  }

  private clearTurn() {
    if (this.turnTimer !== null) this.deps.clearTimer(this.turnTimer);
    this.turnTimer = null;
  }

  private clearSleep() {
    if (this.sleepTimer !== null) this.deps.clearTimer(this.sleepTimer);
    this.sleepTimer = null;
  }

  /** Pause + detach the current element (unless it is `keep`), revoking narration we made. */
  private dropElement(keep: HTMLAudioElement | null, keepBlob = false) {
    const a = this.audio;
    if (a && a !== keep) {
      a.pause();
      this.unwire(a);
    }
    if (this.pageBlob && !keepBlob) this.deps.revoke(this.pageBlob);
    this.pageBlob = null;
    this.audio = null;
    this.pendingSeek = null;
  }

  /** Revoke blob: URLs of the old track that the next one does not reuse. */
  private dropOwned(next: AudioTrack | null) {
    const old = this.snap.track?.ownedUrls ?? [];
    if (!old.length) return;
    const keep = new Set(next?.ownedUrls ?? []);
    for (const u of old) if (!keep.has(u)) this.deps.revoke(u);
  }
}
