"use client";

import { useState } from "react";
import { X, Copy, Check, Link2, MessageCircle } from "lucide-react";
import { createShareLink, type StoryShareRow } from "@/lib/db";

interface ShareModalProps {
  storyId: string;
  storyTitle: string;
  onClose: () => void;
}

export default function ShareModal({ storyId, storyTitle, onClose }: ShareModalProps) {
  const [share, setShare] = useState<StoryShareRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generateLink = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await createShareLink(storyId);
      setShare(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tạo được link");
    } finally {
      setLoading(false);
    }
  };

  const shareUrl = share
    ? `${window.location.origin}?share=${share.share_token}`
    : "";

  const copyLink = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      const textarea = document.createElement("textarea");
      textarea.value = shareUrl;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const shareNative = () => {
    if (!shareUrl || !navigator.share) return;
    navigator.share({
      title: `KểCon — ${storyTitle}`,
      text: `Nghe truyện "${storyTitle}" trên KểCon!`,
      url: shareUrl,
    }).catch(() => {});
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-[430px] bg-[#160C33] rounded-t-3xl p-6 pb-9 animate-[slideUp_0.3s_ease] border-t border-white/10">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-[17px] font-black tracking-tight text-white flex items-center gap-2">
            <Link2 size={18} className="text-accent-2" /> Chia Sẻ Truyện
          </h3>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white dark:bg-white/[0.04]/10 flex items-center justify-center text-white/70"
          >
            <X size={16} />
          </button>
        </div>

        <p className="text-[14px] font-bold text-white/80 mb-1">{storyTitle}</p>
        <p className="text-[12px] text-white/40 mb-5">
          Tạo link chia sẻ để bạn bè và gia đình cùng nghe truyện này.
        </p>

        {error && (
          <div className="mb-4 p-3 rounded-xl bg-red-500/20 border border-red-500/30 text-[13px] text-red-300">
            {error}
          </div>
        )}

        {!share ? (
          <button
            onClick={generateLink}
            disabled={loading}
            className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-accent to-pink-500 text-white font-bold text-[15px] flex items-center justify-center gap-2 shadow-lg shadow-accent/30 active:scale-[0.98] transition-transform disabled:opacity-60"
          >
            {loading ? (
              <div className="w-5 h-5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
            ) : (
              <Link2 size={18} />
            )}
            {loading ? "Đang tạo..." : "Tạo link chia sẻ"}
          </button>
        ) : (
          <div className="space-y-3">
            {/* Link display */}
            <div className="flex items-center gap-2 p-3 rounded-xl bg-white dark:bg-white/[0.04]/5 border border-white/10">
              <p className="flex-1 text-[13px] text-white/60 truncate font-mono">
                {shareUrl}
              </p>
              <button
                onClick={copyLink}
                className={`shrink-0 w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${
                  copied
                    ? "bg-emerald-500/20 text-emerald-400"
                    : "bg-white dark:bg-white/[0.04]/10 text-white/70"
                }`}
              >
                {copied ? <Check size={18} /> : <Copy size={18} />}
              </button>
            </div>

            {/* Share actions */}
            <div className="flex gap-3">
              <button
                onClick={copyLink}
                className="flex-1 py-3 rounded-xl bg-white dark:bg-white/[0.04]/10 text-white text-[13px] font-bold flex items-center justify-center gap-2"
              >
                <Copy size={15} />
                {copied ? "Đã sao chép!" : "Sao chép"}
              </button>
              {typeof navigator !== "undefined" && "share" in navigator && (
                <button
                  onClick={shareNative}
                  className="flex-1 py-3 rounded-xl bg-accent/20 text-accent text-[13px] font-bold flex items-center justify-center gap-2"
                >
                  <MessageCircle size={15} />
                  Chia sẻ
                </button>
              )}
            </div>

            {/* View count */}
            <p className="text-center text-[11px] text-white/30">
              Link đã được xem {share.view_count} lần
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
