/**
 * Kid-flow state library (UI v2, ticket UI-06).
 *
 * Every waiting / failure / success moment in the child's flow is fronted by
 * Đóm instead of a bare spinner:
 * - <KidLoading>  Đóm "thinking" + glowing dots, announced politely to SR.
 * - <KidError>    Đóm "oops" + one clear retry action.
 * - <KidSuccess>  Đóm "celebrate" + optional next action.
 * - <GlowDots>    tiny inline loader for buttons/chips (replaces Loader2).
 * Empty states live in EmptyState.tsx.
 */
import type { ReactNode } from "react";
import Mascot, { type MascotState } from "@/components/ui/Mascot";
import { RotateCcw } from "@/components/ui/icons";

type Tone = "day" | "night";

export function GlowDots({
  size = 6,
  className = "",
  label,
}: {
  /** Dot diameter in px. */
  size?: number;
  className?: string;
  /** Accessible text; omit when the surrounding button already says it. */
  label?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-[0.3em] align-middle ${className}`}
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      data-glow-dots
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="kid-dot rounded-full bg-current"
          style={{ width: size, height: size, animationDelay: `${i * 0.16}s` }}
        />
      ))}
    </span>
  );
}

interface StateFrameProps {
  mascot: MascotState;
  title: string;
  message?: ReactNode;
  size?: number;
  tone?: Tone;
  /** Fill the viewport (screen-level state) instead of an inline block. */
  fullScreen?: boolean;
  children?: ReactNode;
  role?: "status" | "alert";
  className?: string;
  testId: string;
}

function StateFrame({
  mascot,
  title,
  message,
  size = 140,
  tone = "day",
  fullScreen = false,
  children,
  role,
  className = "",
  testId,
}: StateFrameProps) {
  const night = tone === "night";
  return (
    <div
      role={role}
      aria-live={role === "status" ? "polite" : undefined}
      data-testid={testId}
      className={`flex flex-col items-center justify-center text-center px-8 ${
        fullScreen ? `min-h-screen ${night ? "bg-night" : "bg-cream dark:bg-night"}` : "py-12"
      } ${className}`}
    >
      <Mascot state={mascot} size={size} label={null} />
      <p
        className={`mt-3 font-display text-[20px] font-extrabold leading-snug ${
          night ? "text-moon" : "text-ink dark:text-moon"
        }`}
      >
        {title}
      </p>
      {message && (
        <p className={`mt-1 max-w-xs text-[14px] leading-relaxed ${night ? "text-moon-2" : "text-ink-2 dark:text-moon-2"}`}>
          {message}
        </p>
      )}
      {children}
    </div>
  );
}

export function KidLoading({
  title = "Đóm đang chuẩn bị…",
  message,
  size,
  tone,
  fullScreen,
  className,
}: {
  title?: string;
  message?: ReactNode;
  size?: number;
  tone?: Tone;
  fullScreen?: boolean;
  className?: string;
}) {
  return (
    <StateFrame
      mascot="thinking"
      title={title}
      message={message}
      size={size}
      tone={tone}
      fullScreen={fullScreen}
      role="status"
      className={className}
      testId="kid-loading"
    >
      <GlowDots size={9} className="mt-4 text-glow" />
    </StateFrame>
  );
}

export function KidError({
  title = "Ối, có chút trục trặc",
  message = "Đóm chưa tải được. Bé thử lại nhé!",
  onRetry,
  retryLabel = "Thử lại",
  size,
  tone,
  fullScreen,
  className,
}: {
  title?: string;
  message?: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  size?: number;
  tone?: Tone;
  fullScreen?: boolean;
  className?: string;
}) {
  return (
    <StateFrame
      mascot="oops"
      title={title}
      message={message}
      size={size}
      tone={tone}
      fullScreen={fullScreen}
      role="alert"
      className={className}
      testId="kid-error"
    >
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-5 inline-flex min-h-tap-min items-center gap-2 rounded-btn bg-cta px-6 text-[16px] font-extrabold text-white shadow-[0_4px_0_var(--color-cta-press)] active:translate-y-0.5 active:shadow-none transition"
        >
          <RotateCcw size={18} /> {retryLabel}
        </button>
      )}
    </StateFrame>
  );
}

export function KidSuccess({
  title,
  message,
  action,
  size,
  tone,
  className,
}: {
  title: string;
  message?: ReactNode;
  /** Optional next step, e.g. "Nghe ngay". */
  action?: { label: string; onClick: () => void };
  size?: number;
  tone?: Tone;
  className?: string;
}) {
  return (
    <StateFrame
      mascot="celebrate"
      title={title}
      message={message}
      size={size}
      tone={tone}
      role="status"
      className={className}
      testId="kid-success"
    >
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-5 inline-flex min-h-tap-min items-center rounded-btn bg-cta px-6 text-[16px] font-extrabold text-white shadow-[0_4px_0_var(--color-cta-press)] active:translate-y-0.5 active:shadow-none transition"
        >
          {action.label}
        </button>
      )}
    </StateFrame>
  );
}
