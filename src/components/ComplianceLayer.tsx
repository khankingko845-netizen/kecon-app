"use client";

import { useEffect, useState } from "react";
import { WifiOff } from "@/components/ui/icons";

// Offline indicator + offline app-shell service worker. Parent consent is no
// longer a local banner: since T11 it is recorded and enforced on the server
// (ConsentGate in AppShell, migration 042).
export default function ComplianceLayer() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
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

  if (!offline) return null;
  return (
    <div
      role="status"
      className="fixed top-0 left-1/2 -translate-x-1/2 z-[60] mt-2 flex items-center gap-1.5 rounded-full bg-ink px-3.5 py-2 font-parent text-[13px] font-semibold text-cream shadow-lg"
    >
      <WifiOff size={15} /> Đang ngoại tuyến — dùng nội dung đã lưu
    </div>
  );
}
