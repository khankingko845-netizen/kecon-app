import { describe, expect, it, vi } from "vitest";
import { createSharedAudio, listenErrorMessage, playFailure, SILENCE, TAP_TO_LISTEN, type AudioOwner } from "@/lib/shared-audio";

/**
 * One narration element for the whole app (iPhone fix). On iOS every browser is
 * WebKit: only an element that a tap started may play on its own later, so a
 * new Audio() per page was refused with NotAllowedError ("The request is not
 * allowed by the user agent or the platform in the current context, possibly
 * because the user denied permission.") — and the player showed that text.
 */

const WEBKIT_TEXT = "The request is not allowed by the user agent or the platform in the current context, possibly because the user denied permission.";

class FakeEl {
  src = "";
  preload = "";
  paused = true;
  playCalls: string[] = [];
  pauseCalls = 0;
  refuse = false;
  onended: (() => void) | null = null;
  ontimeupdate: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private listeners = new Map<string, (() => void)[]>();
  addEventListener(type: string, fn: () => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  emit(type: string) {
    for (const fn of this.listeners.get(type) ?? []) fn();
  }
  getAttribute(name: string) {
    return name === "src" && this.src ? this.src : null;
  }
  removeAttribute() {
    this.src = "";
  }
  load() {}
  play() {
    this.playCalls.push(this.src);
    if (this.refuse) return Promise.reject(new DOMException(WEBKIT_TEXT, "NotAllowedError"));
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.pauseCalls++;
    this.paused = true;
  }
}

function setup() {
  const made: FakeEl[] = [];
  const shared = createSharedAudio(() => {
    const el = new FakeEl();
    made.push(el);
    return el as unknown as HTMLAudioElement;
  });
  const owner = (name: string, log: string[]): AudioOwner => ({ lost: () => void log.push(name) });
  return { shared, made, owner, el: () => made[0] };
}

describe("shared narration element", () => {
  it("one element for every page: take() swaps the source, clears the old page's handlers, tells the previous owner once", () => {
    const { shared, made, owner } = setup();
    const lost: string[] = [];
    const full = owner("full", lost);
    const mini = owner("mini", lost);
    const a = shared.take(full, "https://cdn/p1.mp3") as unknown as FakeEl;
    a.onended = () => {};
    a.ontimeupdate = () => {};
    const b = shared.take(full, "blob:p2") as unknown as FakeEl;
    expect(b).toBe(a);
    expect(made).toHaveLength(1);
    expect(b.src).toBe("blob:p2");
    expect(b.onended).toBeNull();
    expect(b.ontimeupdate).toBeNull();
    expect(lost).toEqual([]); // same owner: nobody is told
    shared.take(mini, "blob:p3");
    shared.take(mini, "blob:p4");
    expect(lost).toEqual(["full"]);
    expect(shared.owns(mini)).toBe(true);
    expect(b.pauseCalls).toBeGreaterThanOrEqual(3); // the page playing before stops
  });

  it("adopt() hands the element over as it is (keeps playing, same source, same handlers)", () => {
    const { shared, owner } = setup();
    const lost: string[] = [];
    const full = owner("full", lost);
    const mini = owner("mini", lost);
    const el = shared.take(full, "blob:p1") as unknown as FakeEl;
    void el.play();
    const onended = () => {};
    el.onended = onended;
    const pauses = el.pauseCalls;
    shared.adopt(mini);
    expect(lost).toEqual(["full"]);
    expect(el.paused).toBe(false);
    expect(el.src).toBe("blob:p1");
    expect(el.onended).toBe(onended);
    expect(el.pauseCalls).toBe(pauses);
  });

  it("release(): an owner that left is not told when the element is taken next", () => {
    const { shared, owner } = setup();
    const lost: string[] = [];
    const full = owner("full", lost);
    shared.take(full, "blob:p1");
    shared.release(full);
    shared.take(owner("mini", lost), "blob:p2");
    expect(lost).toEqual([]);
  });

  it("unlock() on a fresh element plays a moment of silence inside the tap, then stops it; once unlocked it does nothing", async () => {
    const { shared, el } = setup();
    expect(shared.unlocked).toBe(false);
    shared.unlock();
    // Synchronously — before any await in the tap handler.
    expect(el().playCalls).toEqual([SILENCE]);
    await Promise.resolve();
    await Promise.resolve();
    expect(shared.unlocked).toBe(true);
    expect(el().paused).toBe(true);
    shared.unlock();
    expect(el().playCalls).toHaveLength(1);
    expect(SILENCE).toMatch(/^data:audio\/wav;base64,UklGR/);
  });

  it("unlock() on a page whose start was refused: play() + pause() at once — the block lifts, nothing is heard, the page stays", () => {
    const { shared, owner } = setup();
    const el = shared.take(owner("full", []), "https://cdn/p1.mp3") as unknown as FakeEl;
    el.refuse = true;
    void el.play().catch(() => {});
    el.refuse = false;
    shared.unlock();
    expect(el.playCalls).toEqual(["https://cdn/p1.mp3", "https://cdn/p1.mp3"]);
    expect(el.paused).toBe(true);
    expect(el.src).toBe("https://cdn/p1.mp3");
  });

  it("an element that really started counts as unlocked ('playing' event)", () => {
    const { shared, owner } = setup();
    const el = shared.take(owner("full", []), "blob:p1") as unknown as FakeEl;
    el.emit("playing");
    expect(shared.unlocked).toBe(true);
    shared.unlock();
    expect(el.playCalls).toEqual([]);
  });
});

describe("what the child/parent reads when sound cannot start", () => {
  it("WebKit's NotAllowedError becomes a Vietnamese hint — never the browser's English text", () => {
    const e = new DOMException(WEBKIT_TEXT, "NotAllowedError");
    expect(playFailure(e)).toBe("blocked");
    expect(listenErrorMessage(e)).toBe(TAP_TO_LISTEN);
    expect(listenErrorMessage(e, { blocked: "Bấm Nghe thử lần nữa để nghe nhé." })).toBe("Bấm Nghe thử lần nữa để nghe nhé.");
    expect(listenErrorMessage(e)).not.toMatch(/user agent/);
  });

  it("an interrupted play() (pause / next page / newer request) shows nothing", () => {
    expect(listenErrorMessage(new DOMException("The play() request was interrupted by a call to pause().", "AbortError"))).toBeNull();
    expect(playFailure(new DOMException("The operation was aborted.", "AbortError"))).toBe("interrupted");
  });

  it("other browser errors get a short Vietnamese fallback; our own Vietnamese messages pass through", () => {
    expect(listenErrorMessage(new DOMException("The operation is not supported.", "NotSupportedError"))).toBe("Chưa phát được giọng đọc. Bấm ▶ để thử lại.");
    expect(listenErrorMessage(new TypeError("Load failed"), { fallback: "Chưa phát được giọng đọc." })).toBe("Chưa phát được giọng đọc.");
    expect(listenErrorMessage(new Error("Giọng đọc đang tắt."))).toBe("Giọng đọc đang tắt.");
    expect(listenErrorMessage("lạ")).toBe("Chưa phát được giọng đọc. Bấm ▶ để thử lại.");
  });

  it("never touches the browser's Audio until used (server render imports the module safely)", () => {
    const make = vi.fn(() => new FakeEl() as unknown as HTMLAudioElement);
    const shared = createSharedAudio(make);
    expect(make).not.toHaveBeenCalled();
    shared.element();
    shared.element();
    expect(make).toHaveBeenCalledTimes(1);
  });
});
