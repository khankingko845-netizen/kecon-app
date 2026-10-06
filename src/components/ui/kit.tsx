/**
 * KểCon UI v2 kit — shared building blocks taken 1:1 from the concept board
 * (docs/design/ui-v2/mockups/board.html). Every kid screen composes these so
 * spacing, radii, shadows and type stay identical across the app.
 */
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { ArrowLeft, ChevronRight, LockKey, ShieldCheck } from "@/components/ui/icons";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

/** A caller-supplied `absolute`/`fixed` must not fight our default `relative` (CSS order decides). */
export const POSITIONED = /(^|\s)(absolute|fixed|sticky)(\s|$)/;

/** Soft card shadow used by every white card on the cream background. */
export const CARD_SHADOW = "shadow-[0_4px_14px_rgba(43,35,80,0.08)]";

type Button3DProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: "cta" | "brand" | "glow";
  size?: "lg" | "md" | "sm";
  block?: boolean;
};

/** Chunky "pressable" button: solid colour + 6px darker base (board `.btn`). */
export function Button3D({ tone = "cta", size = "lg", block, className, children, ...rest }: Button3DProps) {
  const tones = {
    cta: "bg-cta text-white shadow-[0_6px_0_var(--color-cta-press)] active:shadow-[0_2px_0_var(--color-cta-press)]",
    brand: "bg-brand text-white shadow-[0_5px_0_var(--color-brand-press)] active:shadow-[0_1px_0_var(--color-brand-press)]",
    glow: "bg-glow text-ink shadow-[0_5px_0_#D9A12A] active:shadow-[0_1px_0_#D9A12A]",
  } as const;
  const sizes = {
    // UI-13: heights follow the child's age band (globals.css `html[data-age]`).
    lg: "h-[var(--kid-btn-lg,64px)] rounded-[22px] px-6 text-[22px] gap-2.5",
    md: "h-[var(--kid-btn-md,48px)] rounded-[18px] px-5 text-[18px] gap-2",
    sm: "h-[var(--kid-btn-sm,44px)] rounded-2xl px-4 text-[17px] gap-1.5",
  } as const;
  return (
    <button
      type="button"
      {...rest}
      className={cx(
        "inline-flex items-center justify-center font-display font-extrabold leading-none transition-[transform,box-shadow] duration-100 active:translate-y-1 disabled:opacity-50 disabled:active:translate-y-0",
        tones[tone],
        sizes[size],
        block && "w-full",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** White rounded card (board `.cont`, `.cat`, `.opt`). */
export function Card({ className, children, as = "div", ...rest }: { className?: string; children: ReactNode; as?: "div" | "section" } & Record<string, unknown>) {
  const Tag = as;
  return (
    <Tag {...rest} className={cx("rounded-[24px] bg-white", CARD_SHADOW, className)}>
      {children}
    </Tag>
  );
}

/** Section title row: Baloo 21px + optional indigo link (board `.sec`). */
export function SectionHeader({ title, action, onAction, className }: { title: ReactNode; action?: string; onAction?: () => void; className?: string }) {
  return (
    <div className={cx("mx-0.5 mb-2 mt-4 flex items-baseline justify-between", className)}>
      <h2 className="font-display text-[21px] font-bold leading-tight text-ink">{title}</h2>
      {action && (
        <button type="button" onClick={onAction} className="min-h-[36px] px-1 text-[15px] font-extrabold text-brand">
          {action}
        </button>
      )}
    </div>
  );
}

/** Speech bubble for Đóm. `tail` points at the mascot. */
export function Bubble({ children, tail = "left", className }: { children: ReactNode; tail?: "left" | "bottom" | "none"; className?: string }) {
  return (
    <div className={cx(!POSITIONED.test(className ?? "") && "relative", "rounded-[22px] bg-white px-[18px] py-3 font-extrabold text-ink shadow-[0_6px_18px_rgba(43,35,80,0.12)]", className)}>
      {children}
      {tail === "left" && (
        <span aria-hidden className="absolute -left-[9px] bottom-[18px] h-0 w-0 border-y-[10px] border-r-[10px] border-y-transparent border-r-white" />
      )}
      {tail === "bottom" && (
        <span aria-hidden className="absolute -bottom-[9px] left-6 h-0 w-0 border-x-[10px] border-t-[10px] border-x-transparent border-t-white" />
      )}
    </div>
  );
}

/** Kid screen header: ← + Baloo title + optional right slot (board `.ctop`). */
export function KidHeader({ title, onBack, right, backLabel = "Quay lại" }: { title: ReactNode; onBack?: () => void; right?: ReactNode; backLabel?: string }) {
  return (
    <header className="flex min-h-[48px] items-center gap-2">
      {onBack && (
        <button type="button" onClick={onBack} aria-label={backLabel} className="-ml-2 flex h-11 w-11 items-center justify-center rounded-2xl text-ink active:bg-ink/5">
          <ArrowLeft size={26} />
        </button>
      )}
      <h1 className="font-display text-[22px] font-bold leading-tight text-ink">{title}</h1>
      {right && <div className="ml-auto flex items-center gap-2">{right}</div>}
    </header>
  );
}

/** Mint trust chips under onboarding CTAs (board `.trust`). */
export function TrustChips({ className }: { className?: string }) {
  return (
    <div className={cx("flex flex-wrap justify-center gap-2", className)}>
      <span className="flex items-center gap-1.5 rounded-xl bg-success-soft px-2.5 py-1.5 text-[13px] font-extrabold text-success">
        <ShieldCheck size={15} weight="fill" /> Không quảng cáo
      </span>
      <span className="flex items-center gap-1.5 rounded-xl bg-success-soft px-2.5 py-1.5 text-[13px] font-extrabold text-success">
        <LockKey size={15} weight="fill" /> Khoá phụ huynh
      </span>
    </div>
  );
}

/** Progress bar (board `.bar`): indigo by default, glow→coral for "creating". */
export function ProgressBar({ value, tone = "brand", className, label }: { value: number; tone?: "brand" | "glow" | "amber"; className?: string; label?: string }) {
  const fill = { brand: "bg-brand", glow: "bg-gradient-to-r from-glow to-[#FF7A45]", amber: "bg-amber" }[tone];
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div
      className={cx("h-[7px] overflow-hidden rounded-full bg-[#EEE9FA]", className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      aria-label={label}
    >
      <i className={cx("block h-full rounded-full transition-[width] duration-300", fill)} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** List row used in parent screens (Settings…): icon tile + label + value + caret. */
export function ParentRow({
  icon,
  label,
  value,
  onClick,
  danger,
  children,
}: {
  icon: ReactNode;
  label: string;
  value?: ReactNode;
  onClick?: () => void;
  danger?: boolean;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[56px] w-full items-center gap-3 px-4 py-2.5 text-left active:bg-ink/[0.03]"
    >
      <span className={cx("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", danger ? "bg-[#FDE8E3] text-cta" : "bg-brand-soft text-brand")}>{icon}</span>
      <span className={cx("flex-1 text-[15px] font-semibold", danger ? "text-cta" : "text-ink")}>{label}</span>
      {value != null && <span className="max-w-[45%] truncate text-[13px] font-medium text-ink-2">{value}</span>}
      {children}
      {onClick && <ChevronRight size={16} className="shrink-0 text-ink-2/60" />}
    </button>
  );
}
