"use client";

import { ArrowLeft } from "@/components/ui/icons";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;

/** Big on-screen number pad (≥56px targets) shared by the PIN and adult-question gates. */
export default function Keypad({
  onDigit,
  onBackspace,
  disabled,
}: {
  onDigit: (digit: string) => void;
  onBackspace: () => void;
  disabled?: boolean;
}) {
  const key =
    "flex h-14 items-center justify-center rounded-[18px] bg-parent-bg font-parent text-[22px] font-bold text-ink active:bg-brand-soft disabled:opacity-40";
  return (
    <div className="mt-4 grid grid-cols-3 gap-2.5" role="group" aria-label="Bàn phím số">
      {KEYS.map((d) => (
        <button key={d} type="button" className={key} disabled={disabled} onClick={() => onDigit(d)}>
          {d}
        </button>
      ))}
      <span aria-hidden />
      <button type="button" className={key} disabled={disabled} onClick={() => onDigit("0")}>
        0
      </button>
      <button type="button" className={key} disabled={disabled} onClick={onBackspace} aria-label="Xoá số cuối">
        <ArrowLeft size={24} weight="bold" />
      </button>
    </div>
  );
}
