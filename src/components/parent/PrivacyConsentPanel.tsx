"use client";

/**
 * T11 · Bố mẹ › Quyền riêng tư & dữ liệu › Chính sách & đồng ý. Shows the policy
 * version the family accepted (full text, history) and lets the parent withdraw:
 * the server stops new processing at once and the app closes until the parent
 * accepts again (ConsentGate). Stored data is kept — "Xoá toàn bộ dữ liệu" deletes.
 */
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { useI18n } from "@/lib/i18n";
import {
  ConsentError,
  consentErrorMessage,
  fetchConsentStatus,
  markConsentWithdrawn,
  withdrawConsent,
  type ConsentRecord,
  type ConsentStatus,
} from "@/lib/consent";
import { getParentProof } from "@/lib/parent-proof";
import ParentHeader from "@/components/parent/ParentHeader";
import ParentGate from "@/components/parent/ParentGate";
import PolicyText from "@/components/parent/PolicyText";
import { formatPolicyDate } from "@/components/parent/ConsentGate";
import { CARD_SHADOW } from "@/components/ui/kit";
import { ChevronDown, History, Loader2, ShieldCheck } from "@/components/ui/icons";

const METHOD_LABEL = { parent_pin: "xác nhận bằng mã PIN", account_holder: "xác nhận bởi người giữ tài khoản" } as const;

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Ho_Chi_Minh" });
}

function recordLine(r: ConsentRecord): string {
  const accepted = `Bản ${r.version} · đồng ý ${formatDateTime(r.accepted_at)}`;
  return r.withdrawn_at ? `${accepted} · đã rút ${formatDateTime(r.withdrawn_at)}` : `${accepted} · đang hiệu lực`;
}

export default function PrivacyConsentPanel({ onBack }: { onBack: () => void }) {
  const { user } = useAuth();
  const { locale } = useI18n();
  const [status, setStatus] = useState<ConsentStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showFull, setShowFull] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [step, setStep] = useState<"idle" | "pin" | "saving">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchConsentStatus(createClient(), { locale, full: true }).then(
      (s) => alive && setStatus(s),
      (e: unknown) => alive && setLoadError(consentErrorMessage(e instanceof ConsentError ? e.reason : "unavailable")),
    );
    return () => {
      alive = false;
    };
  }, [locale]);

  async function withdraw() {
    if (!user) return;
    setStep("saving");
    setError(null);
    const result = await withdrawConsent(createClient(), getParentProof());
    if (result.ok) {
      markConsentWithdrawn(user.id); // AppShell closes the app and shows the consent gate
      return;
    }
    if (result.reason === "parent_proof_required") {
      setStep("pin");
      return;
    }
    setError(consentErrorMessage(result.reason));
    setStep("idle");
  }

  if (step === "pin") {
    return (
      <ParentGate
        title="Xác nhận rút đồng ý"
        bubble="Bố mẹ nhập mã PIN để rút đồng ý nhé."
        cancelLabel="Quay lại"
        onCancel={() => setStep("idle")}
        onUnlock={withdraw}
        onPinReset={withdraw}
      />
    );
  }

  const doc = status?.document;
  const accepted = status?.accepted;
  return (
    <div className="min-h-screen bg-parent-bg pb-24 font-parent" data-testid="privacy-consent">
      <ParentHeader title="Chính sách & đồng ý" onBack={onBack} />
      <div className="px-5">
        {!status && !loadError && (
          <div className="flex h-40 items-center justify-center" role="status" aria-label="Đang tải chính sách">
            <Loader2 size={26} className="animate-spin text-brand-ink" />
          </div>
        )}
        {loadError && (
          <p role="alert" className="mt-4 rounded-2xl bg-[#FDE8E3] px-3 py-2 text-[13.5px] font-semibold text-cta-ink">
            {loadError}
          </p>
        )}
        {doc && (
          <>
            <section className={`mt-4 rounded-[20px] bg-white p-5 dark:bg-white/[0.05] ${CARD_SHADOW}`} aria-labelledby="privacy-doc-title">
              <h2 id="privacy-doc-title" className="text-[17px] font-bold leading-snug text-ink dark:text-white">
                {doc.title}
              </h2>
              <p className="mt-1 text-[13px] font-medium text-ink-2 dark:text-white/50">
                Bản {doc.version}
                {formatPolicyDate(doc.published_at) && ` · áp dụng từ ${formatPolicyDate(doc.published_at)}`}
              </p>
              {accepted ? (
                <p className="mt-3 flex items-start gap-2 rounded-2xl bg-success-soft px-3 py-2 text-[13.5px] font-semibold text-success">
                  <ShieldCheck size={17} weight="fill" className="mt-px shrink-0" />
                  <span>
                    Bố mẹ đã đồng ý lúc {formatDateTime(accepted.accepted_at)}
                    {accepted.method ? ` (${METHOD_LABEL[accepted.method]})` : ""}.
                  </span>
                </p>
              ) : (
                <p className="mt-3 rounded-2xl bg-[#FFF4D6] px-3 py-2 text-[13.5px] font-semibold text-[#8A5A00]">Chưa có đồng ý cho bản này.</p>
              )}
              <PolicyText text={doc.summary} className="mt-2" />
              <button
                type="button"
                aria-expanded={showFull}
                aria-controls="privacy-full-text"
                onClick={() => setShowFull((v) => !v)}
                className="mt-4 flex min-h-11 w-full items-center justify-between rounded-2xl bg-parent-bg px-4 text-left text-[14.5px] font-semibold text-brand-ink dark:bg-white/[0.06]"
              >
                {showFull ? "Thu gọn toàn văn" : "Đọc toàn văn chính sách"}
                <ChevronDown size={18} className={showFull ? "rotate-180 transition-transform" : "transition-transform"} />
              </button>
              {showFull && doc.body && (
                <div id="privacy-full-text" className="mt-3">
                  <PolicyText text={doc.body} />
                </div>
              )}
            </section>

            {status.history && status.history.length > 0 && (
              <section className={`mt-4 rounded-[20px] bg-white p-5 dark:bg-white/[0.05] ${CARD_SHADOW}`} aria-labelledby="privacy-history-title">
                <h2 id="privacy-history-title" className="flex items-center gap-2 text-[15px] font-bold text-ink dark:text-white">
                  <History size={18} /> Lịch sử đồng ý
                </h2>
                <ul className="mt-2 space-y-1.5 text-[13.5px] text-ink-2 dark:text-white/70">
                  {status.history.map((r, i) => (
                    <li key={i}>{recordLine(r)}</li>
                  ))}
                </ul>
              </section>
            )}

            {accepted && (
              <section className={`mt-4 rounded-[20px] bg-white p-5 dark:bg-white/[0.05] ${CARD_SHADOW}`} aria-labelledby="privacy-withdraw-title">
                <h2 id="privacy-withdraw-title" className="text-[15px] font-bold text-ink dark:text-white">
                  Rút đồng ý
                </h2>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-2 dark:text-white/70">
                  Sau khi rút, KểCon dừng tạo truyện, tranh và giọng đọc bằng AI, nhắc bố mẹ và các xử lý mới khác; app sẽ hỏi lại đồng ý trước khi dùng tiếp.
                  Dữ liệu đã lưu không bị xoá — muốn xoá, dùng “Xoá toàn bộ dữ liệu”.
                </p>
                {error && (
                  <p role="alert" className="mt-3 rounded-2xl bg-[#FDE8E3] px-3 py-2 text-[13.5px] font-semibold text-cta-ink">
                    {error}
                  </p>
                )}
                {!confirming ? (
                  <button
                    type="button"
                    onClick={() => setConfirming(true)}
                    className="mt-4 min-h-11 w-full rounded-2xl bg-[#FDE7DF] px-4 text-[15px] font-bold text-cta-press dark:bg-cta/20 dark:text-cta-ink"
                  >
                    Rút đồng ý
                  </button>
                ) : (
                  <div className="mt-4 rounded-2xl border border-[#F6C9BA] p-4" role="group" aria-label="Xác nhận rút đồng ý">
                    <p className="text-[14px] font-semibold text-ink dark:text-white">Rút đồng ý với chính sách bản {doc.version}?</p>
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        onClick={withdraw}
                        disabled={step === "saving"}
                        className="min-h-11 flex-1 rounded-2xl bg-cta-press px-3 text-[15px] font-bold text-white disabled:opacity-60"
                      >
                        {step === "saving" ? "Đang rút…" : "Xác nhận rút"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirming(false)}
                        disabled={step === "saving"}
                        className="min-h-11 flex-1 rounded-2xl bg-parent-bg px-3 text-[15px] font-bold text-ink dark:bg-white/[0.06] dark:text-white"
                      >
                        Giữ đồng ý
                      </button>
                    </div>
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
