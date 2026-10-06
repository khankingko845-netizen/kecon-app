"use client";

/**
 * T19 · Màn khoá khi hết giờ / tới giờ ngủ. Replaces every kid screen; only
 * the parent gate can grant extra minutes.
 */
import { useState } from "react";
import Mascot from "@/components/ui/Mascot";
import { Bubble, Button3D, Card } from "@/components/ui/kit";
import { Clock, LockKey, MoonStars } from "@/components/ui/icons";
import ParentGate from "@/components/parent/ParentGate";
import { GRANT_OPTIONS } from "@/lib/screen-time";
import { DOM_LINES, type DomMoment } from "@/lib/dom-lines";
import { useFeedbackOnMount } from "@/lib/feedback-context";

const COPY = {
  limit: { title: "Hết giờ nghe truyện hôm nay rồi!", line: "time-up" },
  bedtime: { title: "Đến giờ đi ngủ rồi!", line: "bedtime" },
} as const satisfies Record<string, { title: string; line: DomMoment }>;

export default function ScreenTimeLock({
  reason,
  onGrant,
}: {
  reason: "limit" | "bedtime";
  onGrant: (minutes: number) => void;
}) {
  const [phase, setPhase] = useState<"locked" | "gate" | "grant">("locked");
  const copy = COPY[reason];
  useFeedbackOnMount(null, { say: copy.line, bubble: false });

  if (phase === "gate") {
    return (
      <ParentGate
        title="Bố mẹ mở thêm giờ"
        bubble="Bố mẹ xác nhận để bé dùng thêm một chút nhé."
        cancelLabel="Quay lại"
        onCancel={() => setPhase("locked")}
        onUnlock={() => setPhase("grant")}
      />
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center bg-cream px-6 pb-16 pt-20 text-center" data-screen-time-lock={reason}>
      <Mascot state="sleepy" size={176} priority />
      <h1 className="mt-4 font-display text-[28px] font-bold leading-tight text-ink">{copy.title}</h1>
      <Bubble tail="none" className="mt-4 text-[17px] leading-snug">
        {DOM_LINES[copy.line].text}
      </Bubble>

      {phase === "locked" ? (
        <Button3D tone="glow" size="md" className="mt-8" onClick={() => setPhase("gate")}>
          <LockKey size={20} weight="fill" /> Bố mẹ mở thêm giờ
        </Button3D>
      ) : (
        <Card className="mt-8 w-full p-5 text-left">
          <p className="flex items-center gap-2 font-parent text-[16px] font-semibold text-ink">
            {reason === "bedtime" ? <MoonStars size={20} weight="fill" className="text-brand" /> : <Clock size={20} className="text-brand" />}
            Cho bé dùng thêm
          </p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            {GRANT_OPTIONS.map((m) => (
              <Button3D key={m} tone="brand" size="md" onClick={() => onGrant(m)}>
                {m} phút
              </Button3D>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setPhase("locked")}
            className="mt-3 min-h-[44px] w-full font-parent text-[14.5px] font-semibold text-brand"
          >
            Thôi, để bé nghỉ
          </button>
        </Card>
      )}
    </div>
  );
}
