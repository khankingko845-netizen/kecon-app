"use client";
/**
 * "Tuần của bé" (G-06 / G-07, docs/missions-parent.md) — parent area only.
 * A parent confirms good habits (one star a day each) and thanks good deeds
 * (words only, never a star), marks stories read together (3 → the family
 * constellation), reads a conversation prompt per story and can turn on one
 * evening reminder for this parent's own device. Every write carries the
 * PIN proof (parent-proof.ts) and is rechecked by the database. No free
 * text, no photos, no comparison with other children.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Bell, CheckCircle, Heart, Leaf, Loader2, LockKey, MessageCircle, Star, Users } from "@/components/ui/icons";
import { Button3D, Card } from "@/components/ui/kit";
import ParentHeader from "@/components/parent/ParentHeader";
import { useToast } from "@/components/ui/Toast";
import { createClient } from "@/lib/supabase/client";
import { getParentPinStatus } from "@/lib/parent-pin";
import { clearParentProof, getParentProof, useHasParentProof } from "@/lib/parent-proof";
import {
  currentPushEndpoint,
  markParentEndpoint,
  readParentEndpoint,
  subscribeParentDevice,
  unsubscribeThisDevice,
} from "@/lib/parent-push";
import {
  HABIT_NOTE,
  KINDNESS_NOTE,
  REMINDER_HOURS,
  REMINDER_NOTE,
  WEEKDAY_LABELS,
  WEEKDAY_NAMES,
  conversationPrompt,
  familyLine,
  hourLabel,
  type ConfirmResult,
  type ParentHabit,
  type ParentNotify,
  type ParentWeekResponse,
  type TogetherResult,
} from "@/lib/missions";
import type { Screen } from "@/lib/types";

interface ParentWeekProps {
  onBack: () => void;
  onNavigate: (screen: Screen, data?: Record<string, string>) => void;
  /** Close the parent area so the gate asks for the PIN again (fresh proof). */
  onRelock: () => void;
}

type PostResult = { ok: true; data: unknown } | { ok: false; proof: boolean; message: string };

async function postAction(body: Record<string, unknown>): Promise<PostResult> {
  try {
    const res = await fetch("/api/missions/parent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => null)) as { error?: unknown; code?: unknown } | null;
    if (res.ok) return { ok: true, data: json };
    return {
      ok: false,
      proof: res.status === 403 && json?.code === "parent_proof",
      message: typeof json?.error === "string" ? json.error : "Chưa lưu được, bố mẹ thử lại nhé.",
    };
  } catch {
    return { ok: false, proof: false, message: "Mất kết nối, bố mẹ thử lại nhé." };
  }
}

function weekdayOf(date: string, weekStart: string): number {
  const i = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${weekStart}T00:00:00Z`)) / 86_400_000);
  return Math.min(6, Math.max(0, i));
}

const PROOF_LOST = "Phiên mã PIN đã hết. Bố mẹ nhập lại mã PIN nhé.";

export default function ParentWeek({ onBack, onNavigate, onRelock }: ParentWeekProps) {
  const { toast } = useToast();
  const hasProof = useHasParentProof();
  const [data, setData] = useState<ParentWeekResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [hasPin, setHasPin] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [device, setDevice] = useState<"unknown" | "parent" | "other">("unknown");

  useEffect(() => {
    let alive = true;
    fetch("/api/missions/parent", { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error("parent week unavailable");
        const next = (await r.json()) as ParentWeekResponse;
        if (alive) setData(next);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [attempt]);

  useEffect(() => {
    let alive = true;
    getParentPinStatus(createClient())
      .then((s) => alive && setHasPin(Boolean(s?.hasPin)))
      .catch(() => alive && setHasPin(false));
    Promise.all([currentPushEndpoint(), readParentEndpoint()])
      .then(([cur, mark]) => alive && setDevice(cur && cur === mark ? "parent" : "other"))
      .catch(() => alive && setDevice("other"));
    return () => {
      alive = false;
    };
  }, []);

  /** Run one parent action; a lost proof is dropped so the PIN card shows again. */
  const act = useCallback(
    async <T,>(key: string, body: Record<string, unknown>, needsProof = true): Promise<T | null> => {
      const proof = getParentProof();
      if (needsProof && !proof) {
        toast("info", PROOF_LOST);
        return null;
      }
      setBusy(key);
      const res = await postAction(needsProof ? { ...body, proof } : body);
      setBusy(null);
      if (res.ok) return res.data as T;
      if (res.proof) clearParentProof();
      toast("error", res.proof ? PROOF_LOST : res.message);
      return null;
    },
    [toast],
  );

  const confirm = async (h: ParentHabit) => {
    const r = await act<ConfirmResult>(`confirm:${h.id}`, { action: "confirm", templateId: h.id });
    if (!r) return;
    setData((d) =>
      d && { ...d, habits: d.habits.map((x) => (x.id === h.id ? { ...x, today: true, week: x.week + (r.confirmed ? 1 : 0) } : x)) },
    );
    toast("success", r.line ?? (h.kind === "kindness" ? "Đã cảm ơn bé." : "Đã ghi nhận."));
  };

  const together = async (sessionId: string) => {
    const r = await act<TogetherResult>(`together:${sessionId}`, { action: "together", sessionId });
    if (!r) return;
    setData(
      (d) =>
        d && {
          ...d,
          stories: d.stories.map((s) => (s.session_id === sessionId ? { ...s, together: true } : s)),
          family: d.family && { ...d.family, progress: r.progress, done: r.done },
        },
    );
    toast("success", r.line ?? familyLine(r.progress, r.target));
  };

  const saveNotify = async (enabled: boolean, hour: number) => {
    const r = await act<ParentNotify>("notify", { action: "notify", enabled, hour });
    if (r) setData((d) => d && { ...d, notify: r });
  };

  const registerDevice = async () => {
    const key = data?.push.publicKey;
    if (!key) return;
    if (!getParentProof()) {
      toast("info", PROOF_LOST);
      return;
    }
    setBusy("device");
    const keys = await subscribeParentDevice(key);
    setBusy(null);
    if (typeof keys === "string") {
      toast(
        "error",
        keys === "denied"
          ? "Bố mẹ chưa cho phép thông báo trên máy này."
          : keys === "unsupported"
            ? "Trình duyệt này chưa hỗ trợ thông báo."
            : "Chưa đăng ký được máy này, thử lại nhé.",
      );
      return;
    }
    const r = await act<{ devices: number }>("device", { action: "device", ...keys });
    if (!r) return;
    await markParentEndpoint(keys.endpoint);
    setDevice("parent");
    setData((d) => d && { ...d, notify: { ...d.notify, devices: r.devices } });
    toast("success", "Đã lưu máy này là máy của bố mẹ.");
  };

  const removeDevice = async () => {
    const endpoint = await currentPushEndpoint();
    if (!endpoint) return;
    const r = await act<{ devices: number }>("device-remove", { action: "device-remove", endpoint }, false);
    if (!r) return;
    await markParentEndpoint(null);
    await unsubscribeThisDevice();
    setDevice("other");
    setData((d) => d && { ...d, notify: { ...d.notify, devices: r.devices } });
    toast("success", "Đã gỡ máy này khỏi lời nhắc.");
  };

  if (failed || !data)
    return (
      <div className="min-h-screen bg-parent-bg pb-28 font-parent">
        <ParentHeader title="Tuần của bé" onBack={onBack} />
        <div className="px-5">
          {failed ? (
            <Card className="p-5">
              <p className="text-[15px] font-semibold text-ink">Chưa tải được tuần của bé.</p>
              <Button3D tone="brand" size="md" className="mt-3" onClick={() => (setFailed(false), setAttempt((n) => n + 1))}>
                Thử lại
              </Button3D>
            </Card>
          ) : (
            <div className="flex h-48 items-center justify-center" role="status" aria-label="Đang tải tuần của bé">
              <Loader2 size={28} className="animate-spin text-brand-ink" />
            </div>
          )}
        </div>
      </div>
    );

  const { summary, family, notify } = data;
  const week = summary.week;
  const stars = week.days.reduce((n, d) => n + d.stars, 0);
  const habits = data.habits.filter((h) => h.kind === "habit");
  const deeds = data.habits.filter((h) => h.kind === "kindness");
  const locked = !hasProof;

  return (
    <div className="min-h-screen bg-parent-bg pb-28 font-parent" data-testid="parent-week">
      <ParentHeader title="Tuần của bé" subtitle="Thói quen tốt, đọc cùng nhau và gợi ý trò chuyện" onBack={onBack} />
      <div className="mt-2 space-y-3 px-5">
        {locked && (
          <Card className="flex items-start gap-3 p-4" data-testid="parent-proof-card">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-glow-soft text-[#7A4A00]">
              <LockKey size={20} weight="fill" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-semibold text-ink">{hasPin === false ? "Đặt mã PIN để ghi nhận" : "Nhập mã PIN để ghi nhận"}</p>
              <p className="mt-0.5 text-[13px] leading-snug text-ink-2">
                Mỗi lần ghi nhận thói quen hay đọc cùng nhau đều cần mã PIN, để bé không tự bấm thay bố mẹ.
              </p>
              <Button3D
                tone="brand"
                size="sm"
                className="mt-2.5"
                onClick={() => (hasPin === false ? onNavigate("parental-controls") : onRelock())}
              >
                {hasPin === false ? "Đặt mã PIN" : "Nhập mã PIN"}
              </Button3D>
            </div>
          </Card>
        )}

        <Card className="p-4" as="section" aria-labelledby="pw-week">
          <h2 id="pw-week" className="text-[16px] font-bold text-ink">
            Tuần này bé nghe truyện {week.nights} tối
          </h2>
          <p className="text-[13px] text-ink-2">{stars > 0 ? `${stars} ngôi sao trên Bầu trời của Đóm` : "Tối nào nghe xong truyện, bầu trời thêm một ngôi sao."}</p>
          <ol className="mt-3 grid grid-cols-7 gap-1" aria-label="Các tối trong tuần">
            {week.days.map((d, i) => (
              <li
                key={d.date}
                aria-label={`${WEEKDAY_NAMES[i]}: ${d.listened ? "đã nghe truyện" : "chưa có truyện"}`}
                className={`flex flex-col items-center gap-0.5 rounded-xl py-1.5 ${d.date === summary.date ? "bg-brand-soft" : ""}`}
              >
                <Star size={22} weight={d.listened ? "fill" : "regular"} className={d.listened ? "text-[#F2A900]" : "text-ink/25"} aria-hidden />
                <span className="text-[12px] font-semibold text-ink-2" aria-hidden>
                  {WEEKDAY_LABELS[i]}
                </span>
              </li>
            ))}
          </ol>
        </Card>

        <Section id="pw-habits" icon={<Leaf size={18} weight="fill" />} title="Thói quen tốt" note={HABIT_NOTE}>
          {habits.length === 0 ? (
            <p className="text-[13.5px] leading-snug text-ink-2">
              Nghe cùng bé một truyện “Thói quen tốt của Bo và Su” để mở thói quen đầu tiên.
            </p>
          ) : (
            <ul className="divide-y divide-ink/5">
              {habits.map((h) => (
                <HabitRow key={h.id} h={h} busy={busy === `confirm:${h.id}`} disabled={locked || busy !== null} onConfirm={() => confirm(h)} />
              ))}
            </ul>
          )}
        </Section>

        {deeds.length > 0 && (
          <Section id="pw-deeds" icon={<Heart size={18} weight="fill" />} title="Việc tốt cho người khác" note={KINDNESS_NOTE}>
            <ul className="divide-y divide-ink/5">
              {deeds.map((h) => (
                <HabitRow key={h.id} h={h} busy={busy === `confirm:${h.id}`} disabled={locked || busy !== null} onConfirm={() => confirm(h)} />
              ))}
            </ul>
          </Section>
        )}

        {family && (
          <Section id="pw-family" icon={<Users size={18} weight="fill" />} title="Cả nhà đọc cùng nhau" note={family.label}>
            <div className="flex items-center gap-2" aria-label={`Đã đọc cùng ${family.progress}/${family.target} truyện`} role="img">
              {Array.from({ length: family.target }, (_, i) => (
                <Star key={i} size={26} weight={i < family.progress ? "fill" : "regular"} className={i < family.progress ? "text-[#F2A900]" : "text-ink/25"} aria-hidden />
              ))}
              <span className="ml-1 text-[13.5px] font-semibold text-ink">{familyLine(family.progress, family.target)}</span>
            </div>
            {data.stories.length === 0 ? (
              <p className="mt-2 text-[13.5px] leading-snug text-ink-2">Tuần này bé chưa nghe xong truyện nào. Tối nay đọc cùng bé một truyện nhé.</p>
            ) : (
              <ul className="mt-2 divide-y divide-ink/5" aria-label="Truyện bé đã nghe tuần này">
                {data.stories.map((s) => (
                  <li key={s.session_id} className="py-3">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[14.5px] font-semibold text-ink">{s.title ?? "Truyện của bé"}</p>
                        <p className="text-[12.5px] text-ink-2">{WEEKDAY_NAMES[weekdayOf(s.date, week.start)]}</p>
                      </div>
                      {s.together ? (
                        <span className="flex shrink-0 items-center gap-1 text-[13px] font-semibold text-success">
                          <CheckCircle size={18} weight="fill" aria-hidden /> Đã đọc cùng
                        </span>
                      ) : (
                        <Button3D
                          tone="brand"
                          size="sm"
                          className="shrink-0 px-3"
                          disabled={locked || busy !== null}
                          onClick={() => together(s.session_id)}
                          aria-label={`Đánh dấu đã đọc cùng: ${s.title ?? "truyện"}`}
                        >
                          {busy === `together:${s.session_id}` ? <Loader2 size={16} className="animate-spin" /> : "Đọc cùng"}
                        </Button3D>
                      )}
                    </div>
                    <p className="mt-1.5 flex gap-1.5 rounded-xl bg-parent-bg px-2.5 py-2 text-[13px] leading-snug text-ink">
                      <MessageCircle size={16} className="mt-0.5 shrink-0 text-brand-ink" aria-hidden />
                      <span>{conversationPrompt(s)}</span>
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        )}

        <Section id="pw-notify" icon={<Bell size={18} weight="fill" />} title="Nhắc bố mẹ buổi tối" note={REMINDER_NOTE}>
          <div className="flex items-center gap-3">
            <span className="flex-1 text-[14.5px] font-semibold text-ink">Nhắc mỗi tối</span>
            <button
              type="button"
              role="switch"
              aria-checked={notify.enabled}
              aria-label="Nhắc bố mẹ mỗi tối"
              disabled={locked || busy !== null}
              onClick={() => saveNotify(!notify.enabled, notify.hour)}
              className={`h-8 w-14 shrink-0 rounded-full p-1 transition-colors disabled:opacity-50 ${notify.enabled ? "bg-success" : "bg-ink/15"}`}
            >
              <span className={`block h-6 w-6 rounded-full bg-white shadow-sm transition-transform ${notify.enabled ? "translate-x-6" : "translate-x-0"}`} />
            </button>
          </div>
          <label className="mt-3 flex items-center gap-3 text-[14.5px] font-semibold text-ink">
            <span className="flex-1 whitespace-nowrap">Giờ nhắc</span>
            <select
              value={notify.hour}
              disabled={locked || busy !== null}
              onChange={(e) => saveNotify(notify.enabled, Number(e.target.value))}
              className="h-11 w-28 shrink-0 rounded-xl bg-parent-bg px-3 text-[15px] font-semibold text-ink outline-none ring-brand focus:ring-2 disabled:opacity-50"
            >
              {REMINDER_HOURS.map((h) => (
                <option key={h} value={h}>
                  {hourLabel(h)}
                </option>
              ))}
            </select>
          </label>
          <div className="mt-3 rounded-xl bg-parent-bg px-3 py-2.5">
            <p className="text-[13px] text-ink">
              {notify.devices > 0 ? `Đang gửi đến ${notify.devices} máy của bố mẹ.` : "Chưa có máy nào nhận lời nhắc."}
            </p>
            {!data.push.publicKey ? (
              <p className="mt-1 text-[12.5px] text-ink-2">Máy chủ chưa bật gửi thông báo; lựa chọn của bố mẹ vẫn được lưu.</p>
            ) : device === "parent" ? (
              <button type="button" onClick={removeDevice} disabled={busy !== null} className="mt-1.5 min-h-[44px] text-[13.5px] font-semibold text-cta-ink">
                Gỡ máy này khỏi lời nhắc
              </button>
            ) : (
              <Button3D tone="brand" size="sm" className="mt-2" disabled={locked || busy !== null} onClick={registerDevice}>
                {busy === "device" ? <Loader2 size={16} className="animate-spin" /> : <Bell size={16} weight="fill" />}
                Máy này là của bố mẹ
              </Button3D>
            )}
          </div>
        </Section>

        <p className="px-1 pt-1 text-[12.5px] leading-snug text-ink-2">
          Tuần của bé chỉ ghi những gì bố mẹ bấm: không có ô viết, không có ảnh, không so sánh với bé khác.
        </p>
      </div>
    </div>
  );
}

function Section({ id, icon, title, note, children }: { id: string; icon: ReactNode; title: string; note: string; children: ReactNode }) {
  return (
    <Card className="p-4" as="section" aria-labelledby={id}>
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand-soft text-brand-ink" aria-hidden>
          {icon}
        </span>
        <h2 id={id} className="text-[16px] font-bold text-ink">
          {title}
        </h2>
      </div>
      <p className="mt-1 text-[12.5px] leading-snug text-ink-2">{note}</p>
      <div className="mt-2">{children}</div>
    </Card>
  );
}

function HabitRow({ h, busy, disabled, onConfirm }: { h: ParentHabit; busy: boolean; disabled: boolean; onConfirm: () => void }) {
  const deed = h.kind === "kindness";
  return (
    <li className="py-3" data-habit={h.id}>
      <p className="text-[14.5px] font-semibold text-ink">{h.title}</p>
      <p className="text-[13px] leading-snug text-ink-2">{h.label}</p>
      {h.prompt && (
        <p className="mt-1.5 flex gap-1.5 text-[13px] leading-snug text-brand-ink">
          <MessageCircle size={16} className="mt-0.5 shrink-0" aria-hidden />
          <span>{h.prompt}</span>
        </p>
      )}
      <div className="mt-2 flex min-h-[40px] items-center gap-2">
        <span className="text-[12.5px] text-ink-2">{h.week > 0 ? `Tuần này: ${h.week} lần` : "Tuần này: chưa có"}</span>
        {h.today ? (
          <span className="ml-auto flex items-center gap-1 text-[13px] font-semibold text-success">
            <CheckCircle size={18} weight="fill" aria-hidden /> {deed ? "Đã cảm ơn bé hôm nay" : "Đã ghi nhận hôm nay"}
          </span>
        ) : (
          <Button3D tone="brand" size="sm" className="ml-auto px-3" disabled={disabled} onClick={onConfirm} aria-label={`${deed ? "Ghi nhận" : "Bé đã làm hôm nay"}: ${h.title}`}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : deed ? "Ghi nhận" : "Bé đã làm hôm nay"}
          </Button3D>
        )}
      </div>
    </li>
  );
}
