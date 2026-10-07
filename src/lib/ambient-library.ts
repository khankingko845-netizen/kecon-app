import manifest from "../../public/audio/ambient/v1/manifest.json";
export type AmbientType = "rain" | "waves" | "wind" | "fire" | "forest" | "night" | "stream" | "lullaby";
export interface AmbientTrack {
  id: AmbientType; label: string; url: string; author: string; source: string;
  license: string; licenseUrl: string; kind: "field-recording" | "sound-recording" | "music";
  sha256: string; bytes: number; duration: number;
}
export const AMBIENT_TRACKS = manifest.tracks as AmbientTrack[];
export const AMBIENT_CACHE = "kecon-ambient-v1";
export const MAX_AMBIENT_LAYERS = 3;
export function ambientTrack(type: AmbientType): AmbientTrack {
  const track = AMBIENT_TRACKS.find(t => t.id === type);
  if (!track) throw new Error("Âm nền chưa có trong thư viện.");
  return track;
}
function abortIfNeeded(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Đã dừng tải âm nền.", "AbortError");
}
async function validResponse(response: Response, track: AmbientTrack) {
  if (response.status !== 200 || !response.headers.get("content-type")?.startsWith("audio/")) return false;
  const bytes = await response.clone().arrayBuffer();
  if (bytes.byteLength !== track.bytes) return false;
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("") === track.sha256;
}
/** Public same-origin files only. Cache failure never prevents online playback. */
export async function ambientResponse(type: AmbientType, signal?: AbortSignal): Promise<Response> {
  abortIfNeeded(signal);
  const track = ambientTrack(type);
  const cache = typeof caches !== "undefined" ? await caches.open(AMBIENT_CACHE).catch(() => null) : null;
  const stored = await cache?.match(track.url).catch(() => undefined);
  if (stored && await validResponse(stored, track).catch(() => false)) {
    abortIfNeeded(signal); return stored;
  }
  if (stored) await cache?.delete(track.url).catch(() => {});
  const response = await fetch(track.url, { signal, credentials: "omit", cache: "no-cache" });
  if (!await validResponse(response, track)) throw new Error(`Không tải được âm nền ${track.label}. Thử lại khi có mạng.`);
  abortIfNeeded(signal);
  await cache?.put(track.url, response.clone()).catch(() => {});
  return response;
}
export async function cachedAmbientTypes(): Promise<AmbientType[]> {
  if (typeof caches === "undefined") return [];
  const cache = await caches.open(AMBIENT_CACHE).catch(() => null);
  if (!cache) return [];
  const rows = await Promise.all(AMBIENT_TRACKS.map(async t => {
    const response = await cache.match(t.url);
    return response && await validResponse(response, t).catch(() => false) ? t.id : null;
  }));
  return rows.filter((id): id is AmbientType => id !== null);
}
/** Explicit download, two concurrent files; no false success on quota/partial failure. */
export async function downloadAmbientLibrary(onProgress: (done: number) => void, signal?: AbortSignal) {
  if (typeof caches === "undefined") throw new Error("Trình duyệt này chưa hỗ trợ lưu âm nền offline.");
  abortIfNeeded(signal);
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener("abort", cancel, { once: true });
  let next = 0, done = 0;
  const workers = [0, 1].map(async () => {
    while (next < AMBIENT_TRACKS.length) {
      abortIfNeeded(controller.signal);
      await ambientResponse(AMBIENT_TRACKS[next++].id, controller.signal);
      abortIfNeeded(controller.signal); onProgress(++done);
    }
  });
  try { await Promise.all(workers); }
  catch (error) { controller.abort(); await Promise.allSettled(workers); throw error; }
  finally { signal?.removeEventListener("abort", cancel); }
  abortIfNeeded(signal);
  const stored = await cachedAmbientTypes();
  if (stored.length !== AMBIENT_TRACKS.length) throw new Error("Chưa lưu đủ âm nền. Kiểm tra dung lượng trình duyệt rồi thử lại.");
  return stored;
}
