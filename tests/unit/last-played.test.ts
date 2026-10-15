import { beforeEach, describe, expect, it, vi } from "vitest";
import { getLastPlayed, LAST_PLAYED_EVENT, resumePage, saveLastPlayed, updateLastPlayedPage } from "@/lib/last-played";

/** "Nghe tiếp" on Home follows the MiniPlayer and opens the page the child stopped at. */
function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, String(v)),
    removeItem: (k) => void data.delete(k),
    clear: () => data.clear(),
    key: (i) => [...data.keys()][i] ?? null,
    get length() {
      return data.size;
    },
  };
}

let events = 0;
beforeEach(() => {
  events = 0;
  const win = new EventTarget();
  win.addEventListener(LAST_PLAYED_EVENT, () => events++);
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("window", win);
});

describe("last-played (Nghe tiếp)", () => {
  it("saving tells an open Home card to refresh", () => {
    saveLastPlayed({ storyId: "s1", title: "Sóc Nhỏ", page: 2, totalPages: 3, voice: "Giọng Việt mới", category: "animals" });
    expect(events).toBe(1);
    expect(getLastPlayed()).toMatchObject({ storyId: "s1", page: 2, totalPages: 3, voice: "Giọng Việt mới", category: "animals" });
  });

  it("a page turned in the mini player keeps the voice/category saved by the full player", () => {
    saveLastPlayed({ storyId: "s1", title: "Sóc Nhỏ", page: 1, totalPages: 3, voice: "Giọng Việt mới", category: "animals" });
    updateLastPlayedPage({ storyId: "s1", title: "Sóc Nhỏ", page: 3, totalPages: 3 });
    expect(getLastPlayed()).toMatchObject({ page: 3, voice: "Giọng Việt mới", category: "animals" });
    expect(events).toBe(2);
    updateLastPlayedPage({ storyId: "s1", title: "Sóc Nhỏ", page: 3, totalPages: 3 }); // same page: no write
    expect(events).toBe(2);
    updateLastPlayedPage({ storyId: "s2", title: "Thỏ con", page: 1, totalPages: 2 });
    expect(getLastPlayed()).toMatchObject({ storyId: "s2", page: 1, voice: undefined, category: null });
  });

  it("resumePage opens the saved page (clamped), page 1 when nothing was heard", () => {
    expect(resumePage(null)).toBe(1);
    expect(resumePage({ page: 2, totalPages: 2 })).toBe(2); // was: "Trang 2/2" opened page 1
    expect(resumePage({ page: 9, totalPages: 3 })).toBe(3);
    expect(resumePage({ page: 0, totalPages: 3 })).toBe(1);
    expect(resumePage({ page: 2.7, totalPages: 3 })).toBe(2);
  });

  it("storage failures are not fatal", () => {
    vi.stubGlobal("localStorage", { ...memoryStorage(), getItem: () => null, setItem: () => { throw new Error("QuotaExceededError"); } });
    expect(() => saveLastPlayed({ storyId: "s1", title: "A", page: 1, totalPages: 1 })).not.toThrow();
    expect(getLastPlayed()).toBeNull();
  });
});
