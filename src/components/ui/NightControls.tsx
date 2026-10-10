"use client";

/**
 * Night-mode controls (UI v2, ticket UI-08), shared by StoryPlayer & Lullaby:
 * - useSleepTimer(): countdown that calls `onExpire` (pause audio).
 * - <SleepTimerButton>: chip showing the countdown, opens a choice sheet.
 * - <NightToggle>: moon button switching the night palette on/off.
 * - <ScreenOff>: black overlay ("tắt màn") — audio keeps playing, tap to wake.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { EyeSlash, Moon, Sun, Timer, X } from "@/components/ui/icons";
import { useTheme } from "@/lib/theme-context";
import { SLEEP_TIMER_OPTIONS, formatCountdown } from "@/lib/night-mode";

/**
 * Timestamp-based countdown: stays accurate when the browser throttles timers
 * (locked screen, background tab) — remaining time is always `endAt - now`.
 */
export function useSleepTimer(onExpire: () => void) {
  const [endAt, setEndAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const expireRef = useRef(onExpire);
  useEffect(() => {
    expireRef.current = onExpire;
  }, [onExpire]);

  useEffect(() => {
    if (endAt === null) return;
    const id = setInterval(() => {
      const t = Date.now();
      if (t >= endAt) {
        clearInterval(id);
        setEndAt(null);
        expireRef.current();
      } else {
        setNow(t);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [endAt]);

  const start = useCallback((minutes: number) => {
    const t = Date.now();
    setNow(t);
    setEndAt(t + Math.round(minutes * 60) * 1000);
  }, []);
  const cancel = useCallback(() => setEndAt(null), []);
  const remaining = endAt === null ? null : Math.max(0, Math.ceil((endAt - now) / 1000));
  return { remaining, active: endAt !== null, start, cancel };
}

/** Overlays render at <body> level so parent stacking contexts (z-10 bars) can't cover them. */
/** Player chip (concept board `.chips span`). */
export const CHIP =
  "flex h-11 items-center gap-1.5 whitespace-nowrap rounded-2xl border border-moon/[0.12] bg-moon/[0.08] px-3 text-[13.5px] font-extrabold text-[#DCD3EE]";

function BodyPortal({ children }: { children: ReactNode }) {
  return typeof document === "undefined"
    ? null
    : createPortal(children, document.body);
}

export function SleepTimerButton({
  remaining,
  onStart,
  onCancel,
  className = "",
  variant = "icon",
}: {
  remaining: number | null;
  onStart: (minutes: number) => void;
  onCancel: () => void;
  className?: string;
  /** "chip" = labelled pill used in the Player chip row (concept board screen 3). */
  variant?: "icon" | "chip";
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={
          remaining !== null
            ? `Hẹn giờ ngủ, còn ${formatCountdown(remaining)}`
            : "Hẹn giờ ngủ"
        }
        data-testid="sleep-timer-button"
        className={
          variant === "chip"
            ? `${CHIP} ${className}`
            : `h-11 min-w-11 px-3 rounded-xl flex items-center justify-center gap-1.5 text-[13px] font-bold ${
                remaining !== null ? "bg-glow/20 text-glow" : "bg-white/5 text-moon-2"
              } ${className}`
        }
      >
        <Timer size={18} weight="fill" className={variant === "chip" ? "text-amber" : ""} />
        {variant === "chip" ? (
          <span className="tabular-nums">
            {remaining !== null ? `Tắt sau ${formatCountdown(remaining)}` : "Hẹn giờ"}
          </span>
        ) : (
          remaining !== null && <span className="tabular-nums">{formatCountdown(remaining)}</span>
        )}
      </button>

      {open && (
        <BodyPortal>
          <div
            className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60"
            onClick={() => setOpen(false)}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Hẹn giờ ngủ"
              className="w-full max-w-md rounded-t-[28px] bg-night-card px-5 pt-5 pb-10 text-moon"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-4 flex items-center justify-between">
                <p className="font-display text-[20px] font-extrabold">
                  Hẹn giờ ngủ
                </p>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Đóng"
                  className="h-11 w-11 rounded-xl bg-white/5 flex items-center justify-center"
                >
                  <X size={20} />
                </button>
              </div>
              <p className="mb-4 text-[14px] text-moon-2">
                Truyện và âm thanh sẽ tự dừng khi hết giờ.
              </p>
              <div className="grid grid-cols-3 gap-2">
                {SLEEP_TIMER_OPTIONS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => {
                      onStart(m);
                      setOpen(false);
                    }}
                    className="min-h-tap-min rounded-2xl bg-white/5 text-[16px] font-extrabold active:bg-white/10"
                  >
                    {m} phút
                  </button>
                ))}
                {remaining !== null && (
                  <button
                    type="button"
                    onClick={() => {
                      onCancel();
                      setOpen(false);
                    }}
                    className="min-h-tap-min rounded-2xl border border-white/10 text-[15px] font-bold text-moon-2"
                  >
                    Tắt hẹn giờ
                  </button>
                )}
              </div>
            </div>
          </div>
        </BodyPortal>
      )}
    </>
  );
}

export function NightToggle({ className = "" }: { className?: string }) {
  const { isNight, setNightPref } = useTheme();
  return (
    <button
      type="button"
      onClick={() => setNightPref(isNight ? "off" : "on")}
      aria-pressed={isNight}
      aria-label={isNight ? "Tắt chế độ Đêm" : "Bật chế độ Đêm"}
      data-testid="night-toggle"
      className={`h-11 w-11 rounded-xl flex items-center justify-center ${
        isNight ? "bg-glow/20 text-glow" : "bg-white/5 text-moon-2"
      } ${className}`}
    >
      {isNight ? <Moon size={20} weight="fill" /> : <Sun size={20} />}
    </button>
  );
}

export function ScreenOffButton({
  onClick,
  className = "",
  variant = "icon",
}: {
  onClick: () => void;
  className?: string;
  variant?: "icon" | "chip";
}) {
  if (variant === "chip") {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label="Tắt màn hình (vẫn phát âm thanh)"
        data-testid="screen-off-button"
        className={`${CHIP} ${className}`}
      >
        <EyeSlash size={18} weight="fill" className="text-amber" />
        Tắt màn
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Tắt màn hình (vẫn phát âm thanh)"
      data-testid="screen-off-button"
      className={`h-11 w-11 rounded-xl bg-white/5 text-moon-2 flex items-center justify-center ${className}`}
    >
      <EyeSlash size={20} />
    </button>
  );
}

export function ScreenOff({
  onWake,
  remaining,
}: {
  onWake: () => void;
  remaining?: number | null;
}) {
  return (
    <BodyPortal>
      <button
        type="button"
        className="night-screen-off"
        onClick={onWake}
        aria-label="Chạm để bật lại màn hình"
        data-testid="screen-off"
      >
        <span className="text-[13px] font-semibold">
          {remaining != null
            ? `Tự dừng sau ${formatCountdown(remaining)} · `
            : ""}
          Chạm để bật màn hình
        </span>
      </button>
    </BodyPortal>
  );
}
