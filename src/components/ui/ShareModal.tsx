"use client";
import { useEffect, useState, useRef } from "react";
import { z } from "zod";
import { X, Link2 } from "@/components/ui/icons";
import { createShareLink, deactivateShare, type StoryShareRow } from "@/lib/db";
import { storyLinkUrl, StoryLinkMetadata } from "@/lib/story-links";
import { useToast } from "@/components/ui/Toast";
import ParentGate from "@/components/parent/ParentGate";
import { useParentUnlock } from "@/lib/use-parent-unlock";
interface Props {
  storyId: string;
  storyTitle: string;
  onClose: () => void;
}
export default function ShareModal({ storyId, storyTitle, onClose }: Props) {
  const gate = useParentUnlock(true);
  const unlocked = useRef(false);
  useEffect(() => {
    unlocked.current = gate.unlocked;
  }, [gate.unlocked]);
  const { toast, showConfirm } = useToast();
  const [share, setShare] = useState<StoryShareRow | null>(null),
    [hours, setHours] = useState<24 | 72 | 168>(168),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [links, setLinks] = useState<z.infer<typeof StoryLinkMetadata>[]>([]);
  useEffect(() => {
    if (!gate.unlocked) return;
    let alive = true;
    void fetch("/api/share/links?storyId=" + encodeURIComponent(storyId), {
      cache: "no-store",
    })
      .then(async (r) => {
        const data = await r.json();
        const p = z.array(StoryLinkMetadata).max(100).safeParse(data);
        if (!r.ok || !p.success) throw new Error();
        if (alive) setLinks(p.data);
      })
      .catch(() => {
        if (alive) setError("Chưa tải được link đã tạo.");
      });
    return () => {
      alive = false;
    };
  }, [gate.unlocked, storyId]);
  const url = share
    ? storyLinkUrl(window.location.origin, share.share_token)
    : "";
  async function create() {
    if (busy || !unlocked.current) return;
    setBusy(true);
    setError("");
    try {
      const l = await createShareLink(storyId, hours);
      setShare(l);
      setLinks((old) => [
        {
          id: l.id,
          expires_at: l.expires_at,
          is_active: l.is_active,
          view_count: l.view_count,
        },
        ...old,
      ]);
      toast("success", "Đã tạo link có hạn.");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Chưa tạo được link.";
      setError(message);
      toast("error", message);
    } finally {
      setBusy(false);
    }
  }
  async function revoke(id: string) {
    if (
      busy ||
      !(await showConfirm(
        "Thu hồi link này?",
        "Người nhận sẽ không mở được link nữa. Nội dung đã sao chép hoặc tải trước đó không thể thu hồi từ thiết bị của họ.",
      ))
    )
      return;
    if (!unlocked.current) return;
    setBusy(true);
    try {
      await deactivateShare(id);
      setLinks((old) =>
        old.map((l) => (l.id === id ? { ...l, is_active: false } : l)),
      );
      if (share?.id === id) setShare(null);
      toast("success", "Đã thu hồi link.");
    } catch {
      toast("error", "Chưa thu hồi được link.");
    } finally {
      setBusy(false);
    }
  }
  async function copy() {
    if (
      !unlocked.current ||
      !url ||
      !share ||
      new Date(share.expires_at).getTime() <= Date.now()
    )
      return;
    try {
      await navigator.clipboard.writeText(url);
      toast("success", "Đã sao chép link.");
    } catch {
      toast(
        "error",
        "Chưa sao chép được. Bố mẹ chọn link và sao chép thủ công.",
      );
    }
  }
  async function nativeShare() {
    if (!unlocked.current || !url || !navigator.share) return;
    try {
      await navigator.share({
        title: `KểCon — ${storyTitle}`,
        text: "Đọc truyện nền tảng công khai trên KểCon.",
        url,
      });
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError"))
        toast("error", "Chưa mở được chia sẻ. Hãy dùng Sao chép link.");
    }
  }
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Chia sẻ truyện"
      className="fixed inset-0 z-[60] flex items-end justify-center bg-ink/50 backdrop-blur-sm"
    >
      {!gate.unlocked ? (
        <div className="max-h-screen w-full max-w-[430px] overflow-y-auto bg-cream">
          <ParentGate
            title="Chia sẻ dành cho bố mẹ"
            bubble="Bố mẹ xác nhận trước khi gửi link ra ngoài nhé."
            onUnlock={gate.unlock}
            onCancel={onClose}
            cancelLabel="Về truyện"
          />
        </div>
      ) : (
        <div className="max-h-[90vh] w-full max-w-[430px] overflow-y-auto rounded-t-3xl bg-cream p-6 pb-9 text-ink">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-display text-xl font-bold">
              <Link2 className="mr-2 inline" size={20} />
              Chia sẻ truyện
            </h2>
            <button
              aria-label="Đóng chia sẻ"
              onClick={onClose}
              className="min-h-11 min-w-11"
            >
              <X size={20} />
            </button>
          </div>
          <p className="font-bold">{storyTitle}</p>
          <p className="mt-2 text-sm text-ink-2">
            Chỉ chia sẻ bản đọc chữ của truyện nền tảng đã công khai. Chưa chia
            sẻ truyện riêng, ảnh hay giọng gia đình; link không cấp quyền vào
            hộ. Nội dung đã đọc/sao chép không thể thu hồi khỏi thiết bị người
            nhận.
          </p>
          {error && (
            <p role="alert" className="mt-3 text-sm text-red-700">
              {error}
            </p>
          )}
          <label className="mt-4 block text-sm font-bold">
            Hạn dùng
            <select
              aria-label="Hạn dùng link"
              value={hours}
              onChange={(e) =>
                setHours(Number(e.target.value) as 24 | 72 | 168)
              }
              disabled={busy}
              className="mt-2 block min-h-11 w-full rounded-xl border bg-white px-3"
            >
              <option value={24}>24 giờ</option>
              <option value={72}>3 ngày</option>
              <option value={168}>7 ngày</option>
            </select>
          </label>
          <button
            onClick={create}
            disabled={busy}
            className="mt-4 min-h-12 w-full rounded-2xl bg-brand-ink px-4 font-bold text-white disabled:opacity-60"
          >
            {busy ? "Đang xử lý…" : "Tạo link mới"}
          </button>
          {url && (
            <div className="mt-4 rounded-xl bg-white p-3">
              <input
                aria-label="Link đã tạo"
                readOnly
                value={url}
                className="w-full text-sm"
              />
              <p className="mt-2 text-sm">
                Hết hạn: {new Date(share!.expires_at).toLocaleString("vi-VN")}
              </p>
              <div className="mt-2 flex gap-3">
                <button
                  onClick={copy}
                  className="min-h-11 rounded-xl bg-parent-bg px-3"
                >
                  Sao chép link
                </button>
                {typeof navigator !== "undefined" && "share" in navigator && (
                  <button
                    onClick={nativeShare}
                    className="min-h-11 rounded-xl bg-parent-bg px-3"
                  >
                    Gửi link
                  </button>
                )}
              </div>
            </div>
          )}
          <h3 className="mt-5 font-bold">Link của bố mẹ cho truyện này</h3>
          <p className="mt-1 text-xs text-ink-2">
            Không lưu lại mã link thô; mất link thì tạo link mới.
          </p>
          {links.map((l) => (
            <div
              key={l.id}
              className="mt-2 flex items-center justify-between gap-3 rounded-xl bg-white p-3"
            >
              <span className="text-sm">
                {l.is_active ? "Có hiệu lực" : "Hết hạn/đã thu hồi"}
                <br />
                {new Date(l.expires_at).toLocaleString("vi-VN")}
              </span>
              {l.is_active && (
                <button
                  disabled={busy}
                  onClick={() => revoke(l.id)}
                  className="min-h-11 rounded-xl bg-red-50 px-3 text-red-700"
                >
                  Thu hồi
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
