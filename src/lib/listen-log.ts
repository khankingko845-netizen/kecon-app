/**
 * Lượt nghe — one row in play_sessions per listen of a story, wherever it is
 * heard. The full player writes it when the child leaves (or the app goes to
 * the background); when the story goes on in the trình nghe thu gọn
 * (MiniPlayer), that same row is updated until the story ends or is closed.
 * One listen = one play counted (stories.play_count) and its minutes added
 * once to the reading streak — reopening the story from the mini player is
 * the same listen, not a second one.
 *
 * Framework-free and unit-tested (tests/unit/listen-log.test.ts); the database
 * calls are injected (`playSessionStore` in src/lib/db.ts).
 */
import type { ListenLog, ListenSink } from "@/lib/background-player";

export type { ListenLog } from "@/lib/background-player";

/** Shorter than this is a mis-tap, not a listen (same rule as before). */
export const MIN_LISTEN_SECONDS = 2;

export interface PlaySessionData {
  /** Seconds. */
  duration: number;
  pagesListened: number;
  completed: boolean;
}

/** What the row says about a listen — null when it is too short to count. */
export function playSessionOf(log: ListenLog, totalPages: number): PlaySessionData | null {
  const duration = Math.round(Math.max(0, Number.isFinite(log.ms) ? log.ms : 0) / 1000);
  if (duration < MIN_LISTEN_SECONDS) return null;
  const total = Math.max(1, Math.floor(totalPages) || 1);
  const pagesListened = new Set(log.pages.filter((p) => Number.isInteger(p) && p >= 1 && p <= total)).size;
  return { duration, pagesListened, completed: pagesListened >= total };
}

/** Whose listen of which story (fixed when the row is added). */
export interface ListenWho {
  storyId: string;
  totalPages: number;
  /** A family voice (voice_profiles) narrating — the database refuses any other id. */
  voiceId: string | null;
  /** The account that listened: nothing is written once another one is signed in. */
  userId: string | null;
}

export interface PlaySessionStore {
  /** Adds the row and counts one play; resolves the row id (null: not written). */
  insert(input: PlaySessionData & { storyId: string; voiceId: string | null; userId: string | null }): Promise<string | null>;
  /** Updates that row; false when it was not written. */
  update(id: string, input: PlaySessionData & { userId: string | null }): Promise<boolean>;
  /** Reading streak: minutes listened today. */
  addMinutes(minutes: number): Promise<unknown>;
}

export class ListenRecord implements ListenSink {
  private rowId: string | null = null;
  /** Minutes of this listen already added to the reading streak. */
  private credited = 0;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    public who: ListenWho,
    private store: PlaySessionStore,
  ) {}

  /** Write the listen so far: the first write adds the row, later ones update it (in order). */
  save(log: ListenLog): Promise<void> {
    const data = playSessionOf(log, this.who.totalPages);
    if (!data) return this.queue;
    const who = { ...this.who };
    this.queue = this.queue.then(() => this.write(data, who)).catch(() => {});
    return this.queue;
  }

  private async write(data: PlaySessionData, who: ListenWho) {
    if (this.rowId === null) {
      const id = await this.store.insert({ ...data, storyId: who.storyId, voiceId: who.voiceId, userId: who.userId });
      if (!id) return;
      this.rowId = id;
    } else if (!(await this.store.update(this.rowId, { ...data, userId: who.userId }))) {
      return;
    }
    const minutes = Math.round(data.duration / 60);
    if (minutes > this.credited) {
      const add = minutes - this.credited;
      this.credited = minutes;
      await this.store.addMinutes(add);
    }
  }
}
