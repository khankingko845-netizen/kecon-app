"use client";

/**
 * T11 · Đồng ý của bố mẹ (migration 042, docs/parent-consent.md). Shown instead
 * of the whole app until the signed-in parent accepted the CURRENT version of the
 * parent policy: first use, a new policy version, or after a withdrawal. The
 * parent reads the summary (full text one tap away), ticks the box, then proves
 * they are the adult through the parent gate (PIN when set — the server checks
 * the proof — otherwise the adult question). The server records version + hash.
 */
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  acceptConsent,
  consentErrorMessage,
  markConsentAccepted,
  refreshConsent,
  type ConsentGateState,
} from "@/lib/consent";
import { getParentProof } from "@/lib/parent-proof";
import ParentGate from "@/components/parent/ParentGate";
import PolicyText from "@/components/parent/PolicyText";
import Mascot from "@/components/ui/Mascot";
import { Bubble, Button3D, Card } from "@/components/ui/kit";
import { ChevronDown, Loader2, LogOut, ShieldCheck } from "@/components/ui/icons";

export function formatPolicyDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Ho_Chi_Minh" });
}

export default function ConsentGate({ state, onSignOut }: { state: ConsentGateState; onSignOut: () => void }) {
  const [step, setStep] = useState<"read" | "confirm" | "saving">("read");
  const [agreed, setAgreed] = useState(false);
  const [showFull, setShowFull] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const status = state.status;
  const uid = state.uid;

  async function retry() {
    if (!uid) return;
    setRetrying(true);
    await refreshConsent(uid);
    setRetrying(false);
  }

  async function submit() {
    if (!uid || !status) return;
    setStep("saving");
    setError(null);
    const result = await acceptConsent(createClient(), status.document, getParentProof());
    if (result.ok) {
      markConsentAccepted(uid, result);
      return;
    }
    if (result.reason === "stale") {
      await refreshConsent(uid);
      setAgreed(false);
      setShowFull(false);
    }
    setError(consentErrorMessage(result.reason));
    setStep("read");
  }

  if (step === "confirm" && status) {
    return (
      <ParentGate
        title="Bố mẹ xác nhận"
        bubble="Bố mẹ xác nhận giúp Đóm là người lớn trong nhà nhé."
        cancelLabel="Quay lại"
        onCancel={() => setStep("read")}
        onUnlock={submit}
        onPinReset={submit}
      />
    );
  }

  // No answer from the server and nothing cached: say so, never open the app.
  if (!status) {
    return (
      <div className="min-h-screen bg-parent-bg px-5 pb-16 pt-12 font-parent" data-consent-gate="error">
        <div className="flex items-end gap-3">
          <Mascot state="oops" size={92} label="Đóm chưa kết nối được" />
          <Bubble className="mb-4 flex-1 text-[16px] leading-snug">Đóm chưa kiểm tra được đồng ý của bố mẹ.</Bubble>
        </div>
        <Card className="mt-4 p-5">
          <h1 className="font-parent text-[20px] font-bold text-ink dark:text-white">Chưa mở được KểCon</h1>
          <p role="alert" className="mt-2 text-[14px] leading-relaxed text-ink-2 dark:text-white/70">
            {consentErrorMessage(state.reason ?? "unavailable")}
          </p>
          <Button3D tone="brand" size="md" block className="mt-5" onClick={retry} disabled={retrying}>
            {retrying ? <Loader2 size={20} className="animate-spin" /> : null} Thử lại
          </Button3D>
        </Card>
        <SignOutButton onSignOut={onSignOut} />
      </div>
    );
  }

  const doc = status.document;
  const updated = Boolean(status.previous);
  const withdrawn = !updated && Boolean(status.withdrawnAt);
  const title = updated ? "Chính sách đã cập nhật" : withdrawn ? "Bố mẹ đã rút đồng ý" : "Chào bố mẹ!";
  const bubble = updated
    ? `KểCon có chính sách bản ${doc.version}. Bố mẹ xem lại và đồng ý để tiếp tục nhé.`
    : withdrawn
      ? "Bố mẹ đã rút đồng ý nên KểCon đang tạm dừng. Đồng ý lại để tiếp tục nhé."
      : "Trước khi bé nghe truyện, bố mẹ đọc giúp Đóm cách KểCon giữ dữ liệu của gia đình nhé.";
  const saving = step === "saving";

  return (
    <div className="min-h-screen bg-parent-bg px-5 pb-16 pt-12 font-parent" data-consent-gate={updated ? "updated" : withdrawn ? "withdrawn" : "first"}>
      <h1 className="font-parent text-[24px] font-bold leading-tight text-ink dark:text-white">{title}</h1>
      <div className="mt-2 flex items-end gap-3">
        <Mascot state="hello" size={84} label="Đóm chào bố mẹ" />
        <Bubble className="mb-3 flex-1 text-[15px] leading-snug">{bubble}</Bubble>
      </div>

      <Card className="mt-4 p-5" as="section" aria-labelledby="consent-doc-title">
        <span className="inline-flex items-center gap-1.5 rounded-xl bg-success-soft px-2.5 py-1.5 text-[12.5px] font-semibold text-success">
          <ShieldCheck size={15} weight="fill" /> Quyền riêng tư của gia đình
        </span>
        <h2 id="consent-doc-title" className="mt-3 font-parent text-[18px] font-bold leading-snug text-ink dark:text-white">
          {doc.title}
        </h2>
        <p className="mt-1 text-[13px] font-medium text-ink-2 dark:text-white/50">
          Bản {doc.version}
          {formatPolicyDate(doc.published_at) && ` · áp dụng từ ${formatPolicyDate(doc.published_at)}`}
        </p>
        <PolicyText text={doc.summary} className="mt-2" />

        <button
          type="button"
          aria-expanded={showFull}
          aria-controls="consent-full-text"
          onClick={() => setShowFull((v) => !v)}
          className="mt-4 flex min-h-11 w-full items-center justify-between rounded-2xl bg-parent-bg px-4 text-left text-[14.5px] font-semibold text-brand-ink dark:bg-white/[0.06]"
        >
          {showFull ? "Thu gọn toàn văn" : "Đọc toàn văn chính sách"}
          <ChevronDown size={18} className={showFull ? "rotate-180 transition-transform" : "transition-transform"} />
        </button>
        {showFull && doc.body && (
          <div id="consent-full-text" className="mt-3 max-h-[50vh] overflow-y-auto rounded-2xl border border-[#EEE9F8] p-4 dark:border-white/10" tabIndex={0} aria-label="Toàn văn chính sách">
            <PolicyText text={doc.body} />
          </div>
        )}

        <label className="mt-5 flex cursor-pointer items-start gap-3 text-[14.5px] leading-snug text-ink dark:text-white/90">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-0.5 h-6 w-6 shrink-0 accent-[var(--color-brand)]"
          />
          <span>Tôi là bố/mẹ hoặc người giám hộ của bé. Tôi đã đọc và đồng ý với chính sách này.</span>
        </label>

        {error && (
          <p role="alert" className="mt-3 rounded-2xl bg-[#FDE8E3] px-3 py-2 text-[13.5px] font-semibold text-cta-ink">
            {error}
          </p>
        )}

        <Button3D tone="cta" size="md" block className="mt-5" disabled={!agreed || saving} onClick={() => setStep("confirm")}>
          {saving ? <Loader2 size={20} className="animate-spin" /> : null}
          {saving ? "Đang lưu…" : "Đồng ý và tiếp tục"}
        </Button3D>
        <p className="mt-3 text-[12.5px] leading-snug text-ink-2 dark:text-white/50">
          Bố mẹ có thể rút đồng ý bất cứ lúc nào trong Bố mẹ › Quyền riêng tư &amp; dữ liệu.
        </p>
      </Card>
      <SignOutButton onSignOut={onSignOut} />
    </div>
  );
}

function SignOutButton({ onSignOut }: { onSignOut: () => void }) {
  return (
    <button
      type="button"
      onClick={onSignOut}
      className="mx-auto mt-5 flex min-h-11 items-center gap-2 rounded-2xl px-4 text-[14px] font-semibold text-ink-2 dark:text-white/60"
    >
      <LogOut size={17} /> Đăng xuất
    </button>
  );
}
