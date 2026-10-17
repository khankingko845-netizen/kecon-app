"use client";

/**
 * T12 · Bố mẹ › Quyền riêng tư & dữ liệu › Đồng ý giọng nói. Every spoken consent of
 * the family (who, when, which text version, the recording to listen to) and the
 * voices made before consents existed. "Rút đồng ý & xoá giọng" stops the voice at
 * once; the ElevenLabs voice, the recordings and the narration made with it are
 * deleted within 24 hours — the deletion status is shown here.
 */
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useData } from "@/lib/data-context";
import { getParentProof } from "@/lib/parent-proof";
import { getVoiceProfiles, type VoiceProfileRow } from "@/lib/db";
import {
  consentAudioPath,
  fetchVoiceConsentList,
  withdrawVoiceConsent,
  type VoiceConsentItem,
  type VoiceConsentList,
  type VoiceDeletionItem,
} from "@/lib/voice-consent";
import ParentHeader from "@/components/parent/ParentHeader";
import ParentGate from "@/components/parent/ParentGate";
import { CARD_SHADOW } from "@/components/ui/kit";
import { Check, Clock, Loader2, Mic, Play, ShieldCheck, Square, Trash2 } from "@/components/ui/icons";

const METHOD_LABEL = { parent_pin: "bố mẹ xác nhận bằng mã PIN", account_holder: "người giữ tài khoản xác nhận" } as const;
const STATE_LABEL: Record<VoiceConsentItem["state"], { text: string; tone: string }> = {
  active: { text: "Đang dùng", tone: "bg-success-soft text-success" },
  ready: { text: "Chưa tạo giọng", tone: "bg-brand-soft text-brand-ink" },
  incomplete: { text: "Chưa lưu xong", tone: "bg-[#FFF4D6] text-[#8A5A00]" },
  expired: { text: "Hết hạn", tone: "bg-[#EFEDF5] text-ink-2" },
  withdrawn: { text: "Đã rút", tone: "bg-[#FDE8E3] text-cta-ink" },
};
const REASON_LABEL: Record<VoiceDeletionItem["reason"], string> = {
  withdrawn: "Rút đồng ý",
  voice_deleted: "Xoá giọng",
  account_deleted: "Xoá dữ liệu",
  clone_unbound: "Giọng tạo dở",
  expired: "Lời đồng ý hết hạn",
};
const PROVIDER_LABEL = { deleted: "đã xoá ở ElevenLabs", already_gone: "ElevenLabs không còn giọng này", not_found: "ElevenLabs không còn giọng này" } as const;

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Ho_Chi_Minh" });
}

export function deletionLine(j: VoiceDeletionItem): string {
  if (j.status === "done") {
    const parts = [j.voice && j.provider_result ? PROVIDER_LABEL[j.provider_result] : null, j.files_removed ? `${j.files_removed} file ghi âm` : null, j.pages_cleared ? `${j.pages_cleared} trang audio truyện` : null].filter(Boolean);
    return `Đã xoá xong ${formatDateTime(j.done_at)}${parts.length ? ` · ${parts.join(" · ")}` : ""}`;
  }
  if (j.overdue) return `Đang xoá — trễ hạn ${formatDateTime(j.deadline_at)}, KểCon đang thử lại`;
  const voice = j.voice ? (j.provider_done_at ? "giọng đã xoá ở ElevenLabs" : "đang xoá giọng ở ElevenLabs") : null;
  return `Đang xoá${voice ? ` · ${voice}` : ""} · xong trước ${formatDateTime(j.deadline_at)}`;
}

type Target = { consentId?: string; profileId?: string; label: string };

export default function VoiceConsentPanel({ onBack }: { onBack: () => void }) {
  const { refreshVoices } = useData();
  const [list, setList] = useState<VoiceConsentList | null>(null);
  const [profiles, setProfiles] = useState<VoiceProfileRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [pending, setPending] = useState<Target | null>(null);
  const [step, setStep] = useState<"idle" | "pin" | "saving">("idle");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    let alive = true;
    Promise.all([fetchVoiceConsentList(createClient()), getVoiceProfiles(true).catch(() => [] as VoiceProfileRow[])]).then(
      ([l, p]) => {
        if (!alive) return;
        setList(l);
        setProfiles(p);
        setLoadError(null);
      },
      (e: unknown) => alive && setLoadError(e instanceof Error ? e.message : "Chưa tải được lời đồng ý giọng nói."),
    );
    return () => {
      alive = false;
    };
  }, [reloadKey]);
  useEffect(() => () => audioRef.current?.pause(), []);

  function togglePlay(id: string) {
    audioRef.current?.pause();
    if (playing === id) {
      setPlaying(null);
      return;
    }
    const audio = new Audio(consentAudioPath(id));
    audioRef.current = audio;
    audio.onended = () => setPlaying(null);
    setPlaying(id);
    audio.play().catch(() => {
      setPlaying(null);
      setError("Chưa phát được bản ghi lời đồng ý.");
    });
  }

  async function withdraw(target: Target | null = pending) {
    if (!target) return;
    setPending(target);
    setStep("saving");
    setError(null);
    audioRef.current?.pause();
    setPlaying(null);
    const r = await withdrawVoiceConsent({ consentId: target.consentId, profileId: target.profileId, proof: getParentProof() });
    if (!r.ok) {
      if (r.reason === "parent_proof_required") {
        setStep("pin");
        return;
      }
      setError(r.message);
      setStep("idle");
      return;
    }
    setConfirming(null);
    setPending(null);
    setStep("idle");
    setNotice(`Đã rút đồng ý: ${target.label} ngừng được dùng ngay. Giọng và các bản ghi được xoá hẳn trước ${formatDateTime(r.deadlineAt)}.`);
    setReloadKey((k) => k + 1);
    await refreshVoices().catch(() => undefined);
  }

  if (step === "pin") {
    return (
      <ParentGate
        title="Xác nhận rút đồng ý"
        bubble="Bố mẹ nhập mã PIN để rút đồng ý giọng nói nhé."
        cancelLabel="Quay lại"
        onCancel={() => setStep("idle")}
        onUnlock={() => withdraw()}
        onPinReset={() => withdraw()}
      />
    );
  }

  const bound = new Set((list?.consents ?? []).map((c) => c.provider_voice_id).filter(Boolean));
  const legacy = profiles.filter((p) => p.elevenlabs_voice_id && !bound.has(p.elevenlabs_voice_id));
  const deletionById = new Map((list?.deletions ?? []).map((d) => [d.id, d]));
  const shownDeletions = new Set((list?.consents ?? []).map((c) => c.deletion_id).filter(Boolean));
  const otherDeletions = (list?.deletions ?? []).filter((d) => !shownDeletions.has(d.id));
  const busy = step === "saving";

  const confirmBox = (key: string, target: Target, what: string) =>
    confirming === key ? (
      <div className="mt-3 rounded-2xl border border-[#F6C9BA] p-4" role="group" aria-label="Xác nhận rút đồng ý">
        <p className="text-[14px] font-semibold text-ink dark:text-white">Rút đồng ý và xoá {what}?</p>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-2 dark:text-white/70">
          Giọng ngừng được dùng ngay. Trong vòng 24 giờ KểCon xoá giọng ở ElevenLabs, bản ghi mẫu, bản ghi lời đồng ý và audio truyện đã đọc bằng giọng này. Không hoàn tác được.
        </p>
        <div className="mt-3 flex gap-2">
          <button type="button" onClick={() => withdraw(target)} disabled={busy} className="min-h-11 flex-1 rounded-2xl bg-cta-press px-3 text-[15px] font-bold text-white disabled:opacity-60">
            {busy ? "Đang rút…" : "Xác nhận rút & xoá"}
          </button>
          <button type="button" onClick={() => setConfirming(null)} disabled={busy} className="min-h-11 flex-1 rounded-2xl bg-parent-bg px-3 text-[15px] font-bold text-ink dark:bg-white/[0.06] dark:text-white">
            Giữ giọng
          </button>
        </div>
      </div>
    ) : (
      <button
        type="button"
        onClick={() => {
          setConfirming(key);
          setError(null);
        }}
        className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-2xl bg-[#FDE7DF] px-4 text-[14.5px] font-bold text-cta-press dark:bg-cta/20 dark:text-cta-ink"
      >
        <Trash2 size={16} /> Rút đồng ý & xoá giọng
      </button>
    );

  return (
    <div className="min-h-screen bg-parent-bg pb-24 font-parent" data-testid="voice-consent-panel">
      <ParentHeader title="Đồng ý giọng nói" onBack={onBack} />
      <div className="px-5">
        <p className="mt-3 text-[13.5px] leading-relaxed text-ink-2 dark:text-white/70">
          Mỗi giọng gia đình có một lời đồng ý do chính người góp giọng đọc to. Rút đồng ý bất cứ lúc nào: giọng ngừng dùng ngay và được xoá hẳn trong vòng 24 giờ.
        </p>
        {!list && !loadError && (
          <div className="flex h-40 items-center justify-center" role="status" aria-label="Đang tải lời đồng ý giọng nói">
            <Loader2 size={26} className="animate-spin text-brand-ink" />
          </div>
        )}
        {loadError && (
          <p role="alert" className="mt-4 rounded-2xl bg-[#FDE8E3] px-3 py-2 text-[13.5px] font-semibold text-cta-ink">
            {loadError}
          </p>
        )}
        {notice && (
          <p role="status" className="mt-4 flex items-start gap-2 rounded-2xl bg-success-soft px-3 py-2 text-[13.5px] font-semibold text-success">
            <Check size={17} className="mt-px shrink-0" /> <span>{notice}</span>
          </p>
        )}
        {error && (
          <p role="alert" className="mt-4 rounded-2xl bg-[#FDE8E3] px-3 py-2 text-[13.5px] font-semibold text-cta-ink">
            {error}
          </p>
        )}

        {list && list.consents.length === 0 && legacy.length === 0 && (
          <section className={`mt-4 rounded-[20px] bg-white p-5 text-center dark:bg-white/[0.05] ${CARD_SHADOW}`}>
            <Mic size={28} className="mx-auto text-brand-ink" />
            <p className="mt-2 text-[15px] font-bold text-ink dark:text-white">Chưa có lời đồng ý giọng nói nào</p>
            <p className="mt-1 text-[13.5px] text-ink-2 dark:text-white/60">Lời đồng ý được ghi ở bước đầu của “Ghi giọng bố mẹ”.</p>
          </section>
        )}

        {list?.consents.map((c) => {
          const label = STATE_LABEL[c.state];
          const job = c.deletion_id ? deletionById.get(c.deletion_id) : undefined;
          const names = c.profiles.map((p) => p.name).join(", ");
          return (
            <section key={c.id} className={`mt-4 rounded-[20px] bg-white p-5 dark:bg-white/[0.05] ${CARD_SHADOW}`} data-testid="voice-consent-item" aria-label={`Lời đồng ý của ${c.speaker_name}`}>
              <div className="flex items-start gap-2">
                <h2 className="flex-1 text-[16px] font-bold leading-snug text-ink dark:text-white">{c.speaker_name}</h2>
                <span className={`shrink-0 rounded-xl px-2.5 py-1 text-[12.5px] font-bold ${label.tone}`}>{label.text}</span>
              </div>
              <p className="mt-1 text-[13px] font-medium text-ink-2 dark:text-white/50">
                Ghi lúc {formatDateTime(c.recorded_at)} · bản {c.version} · {METHOD_LABEL[c.parent_method]}
              </p>
              {names && <p className="mt-1 text-[13px] font-semibold text-ink dark:text-white/80">Giọng: {names}</p>}
              {c.withdrawn_at && (
                <p className="mt-1 text-[13px] font-medium text-ink-2 dark:text-white/50">
                  {c.withdraw_reason === "expired" ? "Hết hạn" : "Đã rút"} lúc {formatDateTime(c.withdrawn_at)}
                </p>
              )}
              <blockquote className="mt-2 rounded-2xl bg-parent-bg px-3 py-2 text-[14px] italic leading-relaxed text-ink dark:bg-white/[0.06] dark:text-white/80">
                “{c.spoken_text}”
              </blockquote>
              {c.audio_available && (
                <button
                  type="button"
                  onClick={() => togglePlay(c.id)}
                  className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-2xl bg-brand-soft px-4 text-[14.5px] font-semibold text-brand-ink"
                >
                  {playing === c.id ? <Square size={14} weight="fill" /> : <Play size={14} weight="fill" />}
                  {playing === c.id ? "Dừng phát" : "Nghe bản ghi lời đồng ý"}
                </button>
              )}
              {job && (
                <p className={`mt-3 flex items-start gap-2 text-[13px] font-semibold ${job.status === "done" ? "text-success" : "text-[#8A5A00] dark:text-[#FFD98A]"}`} data-testid="voice-deletion-status">
                  {job.status === "done" ? <ShieldCheck size={16} weight="fill" className="mt-px shrink-0" /> : <Clock size={16} className="mt-px shrink-0" />}
                  <span>{deletionLine(job)}</span>
                </p>
              )}
              {(c.state === "active" || c.state === "ready") && confirmBox(c.id, { consentId: c.id, label: names ? `giọng ${names}` : `lời đồng ý của ${c.speaker_name}` }, names ? `giọng ${names}` : "lời đồng ý này")}
            </section>
          );
        })}

        {legacy.length > 0 && (
          <section className={`mt-4 rounded-[20px] bg-white p-5 dark:bg-white/[0.05] ${CARD_SHADOW}`} aria-labelledby="voice-legacy-title">
            <h2 id="voice-legacy-title" className="text-[15px] font-bold text-ink dark:text-white">
              Giọng tạo trước khi có lời đồng ý
            </h2>
            <p className="mt-1 text-[13.5px] leading-relaxed text-ink-2 dark:text-white/70">
              Các giọng này tạm dừng đọc truyện. Muốn dùng tiếp, ghi lại giọng trong Giọng đọc (kèm lời đồng ý); hoặc xoá hẳn.
            </p>
            {legacy.map((p) => (
              <div key={p.id} className="mt-3 border-t border-[#EFEDF5] pt-3 first:border-t-0 dark:border-white/10" data-testid="voice-legacy-item">
                <p className="text-[14.5px] font-semibold text-ink dark:text-white">{p.name}</p>
                {confirmBox(`p:${p.id}`, { profileId: p.id, label: `giọng ${p.name}` }, `giọng ${p.name}`)}
              </div>
            ))}
          </section>
        )}

        {otherDeletions.length > 0 && (
          <section className={`mt-4 rounded-[20px] bg-white p-5 dark:bg-white/[0.05] ${CARD_SHADOW}`} aria-labelledby="voice-deletions-title">
            <h2 id="voice-deletions-title" className="text-[15px] font-bold text-ink dark:text-white">
              Lịch sử xoá giọng
            </h2>
            <ul className="mt-2 space-y-2 text-[13px] text-ink-2 dark:text-white/70">
              {otherDeletions.map((d) => (
                <li key={d.id} data-testid="voice-deletion-status">
                  <b className="text-ink dark:text-white">{REASON_LABEL[d.reason]}</b> · {deletionLine(d)}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
