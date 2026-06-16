"use client";

import { useEffect, useState } from "react";
import { ShieldCheck, WifiOff, X } from "lucide-react";

const CONSENT_KEY = "kecon-consent-v1";

// COPPA/GDPR consent banner + offline indicator. The banner is shown once and
// the choice is stored locally; offline state is reflected live so parents know
// when playback falls back to cached content.
export default function ComplianceLayer() {
  const [showConsent, setShowConsent] = useState(false);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!localStorage.getItem(CONSENT_KEY)) setShowConsent(true);

    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);

    // Register the offline app-shell service worker (best-effort).
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const accept = () => {
    localStorage.setItem(CONSENT_KEY, JSON.stringify({ at: Date.now(), accepted: true }));
    setShowConsent(false);
  };

  return (
    <>
      {offline && (
        <div className="fixed top-0 left-1/2 -translate-x-1/2 z-[60] mt-2 px-3 py-1.5 rounded-full bg-gray-900 text-white text-[12px] font-semibold flex items-center gap-1.5 shadow-lg">
          <WifiOff size={13} /> Đang ngoại tuyến — dùng nội dung đã lưu
        </div>
      )}

      {showConsent && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-[430px] bg-white dark:bg-white/[0.04] rounded-t-3xl p-6 pb-8 animate-[slideUp_0.3s_ease]">
            <div className="w-11 h-11 rounded-2xl bg-emerald-50 flex items-center justify-center text-emerald-600 mb-3">
              <ShieldCheck size={22} />
            </div>
            <h2 className="text-[18px] font-black tracking-tight mb-2">
              Quyền riêng tư & Trẻ em
            </h2>
            <p className="text-[13px] text-txt-secondary dark:text-white/50 leading-relaxed mb-4">
              KểCon tuân thủ COPPA & GDPR. Ứng dụng dành cho phụ huynh tạo nội
              dung cho con. Chúng tôi chỉ lưu dữ liệu cần thiết (giọng nói, truyện)
              trong tài khoản của bạn và không chia sẻ với bên thứ ba. Bạn có thể
              xuất hoặc xoá dữ liệu bất cứ lúc nào trong Cài đặt.
            </p>
            <button
              onClick={accept}
              className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-accent to-pink-500 text-white font-bold text-[15px] active:scale-[0.98] transition-transform"
            >
              Tôi đồng ý
            </button>
            <button
              onClick={() => setShowConsent(false)}
              className="absolute top-5 right-5 w-8 h-8 rounded-full bg-gray-100 dark:bg-white/[0.06] flex items-center justify-center text-gray-500 dark:text-white/40"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
