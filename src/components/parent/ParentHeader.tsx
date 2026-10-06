import { ArrowLeft, ShieldCheck } from "@/components/ui/icons";
import { CARD_SHADOW } from "@/components/ui/kit";

/** Parent-area header (UI-10): Be Vietnam Pro title + "Phụ huynh" chip. */
export default function ParentHeader({ title, onBack, subtitle }: { title: string; onBack?: () => void; subtitle?: string }) {
  return (
    <header className="px-5 pt-12 pb-2">
      <div className="flex items-center gap-3">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label="Quay lại"
            className={`w-11 h-11 -ml-1 rounded-[14px] bg-white dark:bg-white/[0.06] flex items-center justify-center text-ink dark:text-white ${CARD_SHADOW}`}
          >
            <ArrowLeft size={22} weight="bold" />
          </button>
        )}
        <h1 className="font-parent text-[24px] font-bold tracking-tight text-ink dark:text-white">{title}</h1>
        <span className="ml-auto flex items-center gap-1.5 whitespace-nowrap rounded-xl bg-success-soft px-2.5 py-1.5 font-parent text-[12.5px] font-semibold text-success">
          <ShieldCheck size={15} weight="fill" /> Phụ huynh
        </span>
      </div>
      {subtitle && <p className="mt-1 font-parent text-[13px] text-ink-2 dark:text-white/45">{subtitle}</p>}
    </header>
  );
}
