"use client";

import { useEffect, useState } from "react";
import { ShieldCheck, WifiOff, X } from "@/components/ui/icons";
import Mascot from "@/components/ui/Mascot";
import { Button3D } from "@/components/ui/kit";

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
 <div
 role="status"
 className="fixed top-0 left-1/2 -translate-x-1/2 z-[60] mt-2 flex items-center gap-1.5 rounded-full bg-ink px-3.5 py-2 font-parent text-[13px] font-semibold text-cream shadow-lg"
 >
 <WifiOff size={15} /> Đang ngoại tuyến — dùng nội dung đã lưu
 </div>
 )}

 {showConsent && (
 <div className="fixed inset-0 z-[70] flex items-end justify-center bg-ink/40 backdrop-blur-sm">
 <div
 role="dialog"
 aria-modal="true"
 aria-labelledby="consent-title"
 className="relative w-full max-w-[430px] rounded-t-[28px] bg-white px-6 pb-8 pt-6 font-parent animate-[slideUp_0.3s_ease]"
 >
 <button
 type="button"
 onClick={() => setShowConsent(false)}
 aria-label="Đóng"
 className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-parent-bg text-ink-2"
 >
 <X size={18} />
 </button>
 <div className="flex items-center gap-3">
 <Mascot state="hello" size={72} label={null} />
 <span className="flex items-center gap-1.5 rounded-xl bg-success-soft px-2.5 py-1.5 text-[12.5px] font-semibold text-success">
 <ShieldCheck size={15} weight="fill" /> An toàn cho trẻ em
 </span>
 </div>
 <h2 id="consent-title" className="mt-3 font-display text-[22px] font-bold leading-tight text-ink">
 Quyền riêng tư của bé
 </h2>
 <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
 KểCon dành cho bố mẹ tạo và kể truyện cho con. Chúng tôi chỉ lưu dữ liệu cần thiết
 (giọng đọc, truyện) trong tài khoản của bạn, không quảng cáo và không chia sẻ với bên
 thứ ba. Bạn có thể xuất hoặc xoá dữ liệu bất cứ lúc nào trong tab Bố mẹ.
 </p>
 <Button3D tone="brand" size="md" block className="mt-5" onClick={accept}>
 Tôi đồng ý
 </Button3D>
 </div>
 </div>
 )}
 </>
 );
}
