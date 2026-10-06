"use client";

/**
 * UI-11 · "Âm thanh & rung" card in tab Bố mẹ: tap sounds, light vibration
 * and Đóm's voice, each switchable; everything goes quiet in Chế độ ngủ.
 */
import type { ReactNode } from "react";
import { CARD_SHADOW } from "@/components/ui/kit";
import { MessageCircle, MoonStars, Play, Vibrate, Volume2 } from "@/components/ui/icons";
import { useFeedback } from "@/lib/feedback-context";
import type { FeedbackPrefs } from "@/lib/feedback";
import type { NightPref } from "@/lib/night-mode";

function SwitchRow({
  icon,
  label,
  hint,
  checked,
  onChange,
}: {
  icon: ReactNode;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex min-h-[64px] w-full items-center gap-3.5 px-4 py-3 text-left transition-colors active:bg-brand-soft/50 dark:active:bg-white/[0.03]"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] bg-brand-soft text-brand-ink">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-parent text-[15px] font-semibold text-ink dark:text-white/90">{label}</span>
        <span className="block font-parent text-[12.5px] font-medium leading-snug text-ink-2 dark:text-white/50">{hint}</span>
      </span>
      <span
        aria-hidden
        className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${checked ? "bg-success" : "bg-[#D9D4E7] dark:bg-white/15"}`}
      >
        <span
          className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-[left] ${checked ? "left-[22px]" : "left-0.5"}`}
        />
      </span>
    </button>
  );
}

export function bedtimeHint(nightPref: NightPref, silenced: boolean): string {
  if (silenced) return "Chế độ ngủ đang bật — âm thanh và giọng Đóm đang tắt.";
  if (nightPref === "off") return "Chế độ ngủ đang tắt — bật lại để Đóm tự im lặng buổi tối.";
  return nightPref === "on"
    ? "Tự im lặng khi bật Chế độ ngủ."
    : "Tự im lặng trong Chế độ ngủ (19:30–6:00). Rung vẫn hoạt động nếu bật.";
}

export default function FeedbackSettings({ nightPref }: { nightPref: NightPref }) {
  const { prefs, setPrefs, supportsHaptics, hasVoice, silencedByBedtime, cue, say } = useFeedback();
  const set = (k: keyof FeedbackPrefs) => (v: boolean) => setPrefs({ [k]: v });

  return (
    <div
      data-testid="feedback-settings"
      className={`overflow-hidden rounded-[20px] bg-white divide-y divide-[#F1EEF8] dark:divide-white/[0.06] dark:bg-white/[0.05] ${CARD_SHADOW}`}
    >
      <SwitchRow
        icon={<Volume2 size={20} weight="duotone" />}
        label="Âm thanh khi chạm"
        hint="Tiếng tách nhẹ khi chạm, chuông nhỏ khi hoàn thành"
        checked={prefs.sound}
        onChange={set("sound")}
      />
      <SwitchRow
        icon={<Vibrate size={20} weight="duotone" />}
        label="Rung nhẹ"
        hint={supportsHaptics ? "Rung khẽ khi bé chạm nút" : "Máy/trình duyệt này không hỗ trợ rung (vd. iPhone)"}
        checked={prefs.haptics}
        onChange={set("haptics")}
      />
      <SwitchRow
        icon={<MessageCircle size={20} weight="duotone" />}
        label="Đóm nói chuyện"
        hint={hasVoice ? "Đóm đọc to câu thoại bằng giọng tiếng Việt của máy" : "Máy chưa có giọng tiếng Việt — Đóm chỉ hiện chữ"}
        checked={prefs.voice}
        onChange={set("voice")}
      />
      <div className="flex items-start gap-3.5 px-4 py-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] bg-glow-soft text-[#9A6A00] dark:text-glow">
          <MoonStars size={20} weight="duotone" />
        </span>
        <p className="flex-1 pt-0.5 font-parent text-[13px] font-medium leading-snug text-ink-2 dark:text-white/55" data-testid="feedback-bedtime-hint">
          {bedtimeHint(nightPref, silencedByBedtime)}
        </p>
        <button
          type="button"
          data-sfx="off"
          onClick={() => {
            cue("success");
            say("poke");
          }}
          className="flex min-h-[40px] shrink-0 items-center gap-1 rounded-2xl bg-brand-soft px-3 font-parent text-[13px] font-bold text-brand-ink active:scale-95"
        >
          <Play size={14} weight="fill" /> Nghe thử
        </button>
      </div>
    </div>
  );
}
