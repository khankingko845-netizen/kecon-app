"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { adminAccess, type AdminAccess } from "@/lib/admin-session";
import AdminMfaGate from "./AdminMfaGate";
/** No heartbeat: only real input renews the server lease. Background refreshes do not. */
export default function AdminSessionBoundary({
  initial,
  children,
}: {
  initial: AdminAccess;
  children: ReactNode;
}) {
  const router = useRouter();
  const [access, setAccess] = useState(initial);
  const lastTouch = useRef(0);
  const generation = useRef(0);
  useEffect(() => {
    if (access.state !== "ready") return;
    let live = true,
      pending = false;
    async function check(touch: boolean) {
      if (pending) return;
      pending = true;
      const epoch = generation.current;
      const next = await adminAccess(
        createClient(),
        touch ? "touch_admin_session" : "admin_access_status",
      );
      pending = false;
      if (!live || epoch !== generation.current) return;
      setAccess(next);
      if (next.state === "forbidden") router.refresh();
    }
    function activity() {
      if (
        document.visibilityState === "visible" &&
        Date.now() - lastTouch.current > 30000
      ) {
        lastTouch.current = Date.now();
        void check(true);
      }
    }
    function focus() {
      if (document.visibilityState === "visible") void check(false);
    }
    const timer = setTimeout(
      () => void check(false),
      Math.max(0, Date.parse(access.expires_at!) - Date.now()) + 50,
    );
    for (const event of ["pointerdown", "keydown", "wheel"])
      window.addEventListener(event, activity, { passive: true });
    document.addEventListener("visibilitychange", focus);
    window.addEventListener("focus", focus);
    return () => {
      live = false;
      clearTimeout(timer);
      for (const event of ["pointerdown", "keydown", "wheel"])
        window.removeEventListener(event, activity);
      document.removeEventListener("visibilitychange", focus);
      window.removeEventListener("focus", focus);
    };
  }, [access, router]);
  return access.state === "ready" ? (
    <>
      <div className="border-b bg-white px-5 py-2 text-right text-sm text-ink-2">
        Phiên quản trị khoá sau 30 phút không hoạt động{" "}
        <button
          className="ml-4 min-h-11 underline"
          onClick={async () => {
            const epoch = ++generation.current;
            setAccess({
              ...access,
              state: "session_expired",
              expires_at: null,
            });
            const next = await adminAccess(
              createClient(),
              "close_admin_session",
            );
            if (epoch === generation.current) setAccess(next);
          }}
        >
          Khoá quản trị
        </button>
      </div>
      {children}
    </>
  ) : (
    <AdminMfaGate access={access} />
  );
}
