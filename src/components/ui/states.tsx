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
import { Button3D, ProgressBar } from "@/components/ui/kit";
import Mascot, { type MascotState } from "@/components/ui/Mascot";
import { RotateCcw } from "@/components/ui/icons";
import { DOM_LINES } from "@/lib/dom-lines";
import { useFeedbackOnMount } from "@/lib/feedback-context";

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
  /** Small uppercase label above the title (board: "ĐANG TẠO", "LỖI MẠNG"). */
  tag?: string;
  size?: number;
  tone?: Tone;
  /** Fill the viewport (screen-level state) instead of an inline card. */
  fullScreen?: boolean;
  children?: ReactNode;
  role?: "status" | "alert";
  className?: string;
  testId: string;
  /** Warm gradient card for celebrations (board `.sc.ok`). */
  warm?: boolean;
}

/**
 * Concept board screen 6: inline states are white cards with Đóm on the left;
 * screen-level states centre Đóm on the cream (or night) background.
 */
function StateFrame({
  mascot,
  title,
  message,
  tag,
  size,
  tone = "day",
  fullScreen = false,
  children,
  role,
  className = "",
  testId,
  warm = false,
}: StateFrameProps) {
  const night = tone === "night";
  const text = (
    <>
      {tag && (
        <p className={`text-[12px] font-black uppercase tracking-[0.05em] ${night ? "text-moon-2" : "text-ink-2 dark:text-moon-2"}`}>{tag}</p>
      )}
      <p className={`mb-1.5 mt-1 font-display text-[21px] font-bold leading-[1.15] ${night ? "text-moon" : "text-ink dark:text-moon"}`}>{title}</p>
      {message && (
        <p className={`text-[14.5px] font-bold leading-snug ${night ? "text-moon-2" : "text-ink-2 dark:text-moon-2"}`}>{message}</p>
      )}
      {children}
    </>
  );

  if (fullScreen) {
    return (
      <div
        role={role}
        aria-live={role === "status" ? "polite" : undefined}
        data-testid={testId}
        className={`flex min-h-screen flex-col items-center justify-center px-8 text-center ${night ? "bg-night" : "bg-cream dark:bg-night"} ${className}`}
      >
        <Mascot state={mascot} size={size ?? 150} label={null} priority />
        <div className="mt-2 flex max-w-xs flex-col items-center">{text}</div>
      </div>
    );
  }

  return (
    <div
      role={role}
      aria-live={role === "status" ? "polite" : undefined}
      data-testid={testId}
      className={`mx-auto my-6 flex w-full max-w-md items-center gap-3.5 rounded-[26px] px-4 py-3.5 text-left shadow-[0_4px_14px_rgba(43,35,80,0.07)] ${
        night ? "bg-night-card" : warm ? "bg-gradient-to-br from-[#FFF6DD] to-white" : "bg-white"
      } ${className}`}
    >
      <Mascot state={mascot} size={size ?? 112} label={null} className="flex-none" />
      <div className="min-w-0 flex-1">{text}</div>
    </div>
  );
}

const FUN_FACTS = [
  "Bé có biết? Đom đóm phát sáng để gọi bạn bè đấy!",
  "Bé có biết? Mặt trăng không tự sáng, nó mượn ánh sáng mặt trời.",
  "Bé có biết? Cá heo ngủ mà vẫn mở một mắt.",
];

export function KidLoading({
  title = "Đóm đang chuẩn bị…",
  message,
  tag = "Chờ Đóm một chút",
  progress,
  funFact = false,
  size,
  tone,
  fullScreen,
  className,
}: {
  title?: string;
  message?: ReactNode;
  tag?: string;
  /** 0–100 → glow→coral progress bar (board "Đang tạo"); omit for glowing dots. */
  progress?: number;
  /** Show a "Bé có biết?" fact as the message. */
  funFact?: boolean;
  size?: number;
  tone?: Tone;
  fullScreen?: boolean;
  className?: string;
}) {
  const fact = funFact ? FUN_FACTS[title.length % FUN_FACTS.length] : undefined;
  return (
    <StateFrame
      mascot={progress !== undefined ? "story" : "thinking"}
      title={title}
      message={message ?? fact}
      tag={tag}
      size={size}
      tone={tone}
      fullScreen={fullScreen}
      role="status"
      className={className}
      testId="kid-loading"
    >
      {progress !== undefined ? (
        <ProgressBar value={progress} tone="glow" className="mt-2.5 h-2.5 w-full min-w-[160px]" label={title} />
      ) : (
        <GlowDots size={9} className={`mt-3 text-glow ${fullScreen ? "" : "self-start"}`} />
      )}
    </StateFrame>
  );
}

export function KidError({
  title = "Ối, có chút trục trặc",
  message,
  tag = "Có lỗi",
  onRetry,
  retryLabel = "Thử lại",
  size,
  tone,
  fullScreen,
  className,
}: {
  title?: string;
  message?: ReactNode;
  tag?: string;
  onRetry?: () => void;
  retryLabel?: string;
  size?: number;
  tone?: Tone;
  fullScreen?: boolean;
  className?: string;
}) {
  // UI-11: gentle "hmm?" + Đóm reads its default line (custom messages stay silent).
  useFeedbackOnMount("oops", { say: message === undefined ? "oops" : undefined, bubble: false });
  return (
    <StateFrame
      mascot="oops"
      title={title}
      message={message ?? DOM_LINES.oops.text}
      tag={tag}
      size={size}
      tone={tone}
      fullScreen={fullScreen}
      role="alert"
      className={className}
      testId="kid-error"
    >
      {onRetry && (
        <Button3D tone="brand" size="sm" onClick={onRetry} className="mt-2.5">
          <RotateCcw size={18} weight="bold" /> {retryLabel}
        </Button3D>
      )}
    </StateFrame>
  );
}

export function KidSuccess({
  title,
  message,
  tag = "Thành tích",
  action,
  size,
  tone,
  className,
}: {
  title: string;
  message?: ReactNode;
  tag?: string;
  /** Optional next step, e.g. "Nghe ngay". */
  action?: { label: string; onClick: () => void };
  size?: number;
  tone?: Tone;
  className?: string;
}) {
  useFeedbackOnMount("celebrate");
  return (
    <StateFrame
      mascot="celebrate"
      title={title}
      message={message}
      tag={tag}
      size={size}
      tone={tone}
      role="status"
      className={className}
      testId="kid-success"
      warm
    >
      {action && (
        <Button3D tone="cta" size="sm" onClick={action.onClick} className="mt-2.5">
          {action.label}
        </Button3D>
      )}
    </StateFrame>
  );
}
