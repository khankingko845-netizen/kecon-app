"use client";
import { useToast } from "@/components/ui/Toast";
import { useEffect, useRef, useState } from "react";
import { AMBIENT_TRACKS, cachedAmbientTypes, downloadAmbientLibrary } from "@/lib/ambient-library";
/** Shared offline and credits controls. */
export default function AmbientLibraryControls() {
 const { toast } = useToast();
  const [saved, setSaved] = useState(0);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState("");
  const abort = useRef<AbortController | null>(null);
  useEffect(() => {
    let active = true;
    void cachedAmbientTypes().then(types => { if (active) setSaved(types.length); }).catch(() => {});
    return () => { active = false; abort.current?.abort(); };
  }, []);
  async function download() {
    const controller = new AbortController(); abort.current = controller; setError(""); setProgress(0);
    try {
      const types = await downloadAmbientLibrary(done => {
        if (!controller.signal.aborted) setProgress(done);
      }, controller.signal);
      if (!controller.signal.aborted) {setSaved(types.length);toast("success","Đã lưu thư viện âm nền trên thiết bị này.");}
    } catch (e) {
      if (!controller.signal.aborted) {
        toast("error","Chưa tải đủ âm nền offline. Hãy thử lại.");
        setError((e as Error).message);
        const types = await cachedAmbientTypes().catch(() => []);
        if (!controller.signal.aborted) setSaved(types.length);
      }
    } finally { if (!controller.signal.aborted) setProgress(null); }
  }
  const count = AMBIENT_TRACKS.length;
  return (
    <div className="my-4 space-y-2 text-[12px] text-moon-2">
      <button type="button" onClick={download} disabled={progress !== null || saved === count}
        className="min-h-11 w-full rounded-xl border border-moon/30 px-3 font-bold text-moon disabled:opacity-70">
        {progress !== null ? `Đang tải âm nền: ${progress}/${count}` : saved === count ?
          `${count}/${count} âm nền đã lưu offline` : `Lưu ${count} âm nền để nghe offline`}
      </button>
      <p aria-live="polite">{saved}/{count} file đã lưu trên thiết bị này · khoảng {Math.ceil(AMBIENT_TRACKS.reduce((n,t) => n+t.bytes,0)/1e6)} MB.
        Offline cần tải đủ trước; trình duyệt có thể tự dọn cache.</p>
      {error && <p role="alert" aria-label="Lỗi lưu âm nền offline" className="text-[#FBCDC5]">{error}</p>}
      <details>
        <summary className="min-h-11 cursor-pointer py-3 font-bold text-moon">Nguồn &amp; giấy phép âm thanh</summary>
        <ul className="space-y-2">
          {AMBIENT_TRACKS.map(track => <li key={track.id}>
            <a href={track.source} target="_blank" rel="noopener noreferrer" className="underline">{track.label}</a>
            {" — "}{track.author} · <a href={track.licenseUrl} target="_blank" rel="noopener noreferrer" className="underline">{track.license}</a>
            {track.kind === "music" ? " · bản nhạc, không phải tiếng thiên nhiên" : ""}
            {" · đã cắt, cân mức âm và nối vòng lặp."}
          </li>)}
        </ul>
      </details>
    </div>
  );
}
