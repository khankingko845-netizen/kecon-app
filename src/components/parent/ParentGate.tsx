"use client";

/**
 * T19 / UI-10 · Cổng phụ huynh. Shown instead of any parent-area screen
 * until the parent proves they are an adult:
 *   • PIN set   → server-verified PIN (T03: bcrypt, 5 sai → khoá 15 phút).
 *   • No PIN    → adult question (12–19 × 3–9), new question after each miss,
 *                 30 s cool-down after 3 misses.
 *   • Quên PIN  → re-authenticate (password / Google) → reset_parent_pin().
 */
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/auth-context";
import {
  getParentPinStatus,
  PIN_PATTERN,
  resetParentPin,
  unlockErrorMessage,
  verifyParentPin,
} from "@/lib/parent-pin";
import {
  appendDigit,
  CHALLENGE_COOLDOWN_MS,
  createAdultChallenge,
  isChallengeAnswerCorrect,
  MAX_CHALLENGE_ATTEMPTS,
  seconds,
  type AdultChallenge,
} from "@/lib/parent-gate";
import Mascot from "@/components/ui/Mascot";
import { Bubble, Button3D, Card, KidHeader } from "@/components/ui/kit";
import { Loader2, LockKey, ShieldCheck } from "@/components/ui/icons";
import Keypad from "@/components/parent/Keypad";

export interface ParentGateProps {
  onUnlock: () => void;
  onCancel: () => void;
  /** Called after "Quên mã PIN?" succeeded (PIN cleared) — open Parental controls. */
  onPinReset?: () => void;
  title?: string;
  bubble?: string;
  cancelLabel?: string;
}

type Mode = "loading" | "pin" | "math" | "forgot";

const PIN_MAX = 6;

export default function ParentGate({
  onUnlock,
  onCancel,
  onPinReset,
  title = "Khu vực của bố mẹ",
  bubble = "Chỗ này dành cho bố mẹ nhé! Bé nhờ bố mẹ mở giúp nha.",
  cancelLabel = "Về trang chủ",
}: ParentGateProps) {
  const [mode, setMode] = useState<Mode>("loading");
  const [hasPin, setHasPin] = useState(false);
  const [lockedUntil, setLockedUntil] = useState<Date | null>(null);

  useEffect(() => {
    let alive = true;
    getParentPinStatus(createClient())
      .then((status) => {
        if (!alive) return;
        // No status (offline / RPC unavailable) → adult question, never an open door.
        const pin = Boolean(status?.hasPin);
        setHasPin(pin);
        setLockedUntil(status?.lockedUntil ?? null);
        setMode(pin ? "pin" : "math");
      })
      .catch(() => alive && setMode("math"));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="min-h-screen bg-cream px-5 pb-32 pt-12" data-parent-gate={mode}>
      <KidHeader title={title} onBack={onCancel} backLabel={cancelLabel} />
      <div className="mt-3 flex items-end gap-3">
        <Mascot state="thinking" size={92} label="Đóm đang giữ cửa khu vực của bố mẹ" />
        <Bubble className="mb-4 flex-1 text-[16px] leading-snug">{bubble}</Bubble>
      </div>

      <Card className="mt-4 p-5">
        {mode === "loading" && (
          <div className="flex h-40 items-center justify-center" role="status" aria-label="Đang kiểm tra khoá phụ huynh">
            <Loader2 size={26} className="animate-spin text-brand" />
          </div>
        )}
        {mode === "pin" && (
          <PinStep
            lockedUntil={lockedUntil}
            onLocked={setLockedUntil}
            onUnlock={onUnlock}
            onForgot={() => setMode("forgot")}
          />
        )}
        {mode === "math" && <MathStep onUnlock={onUnlock} />}
        {mode === "forgot" && (
          <ForgotStep
            onDone={onPinReset ?? onUnlock}
            onBack={() => setMode(hasPin ? "pin" : "math")}
          />
        )}
      </Card>

      <p className="mt-4 flex items-center justify-center gap-1.5 font-parent text-[13px] font-medium text-ink-2">
        <ShieldCheck size={16} weight="fill" className="text-success" />
        Khoá tự bật lại sau 5 phút không dùng
      </p>
    </div>
  );
}

function GateLabel({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-center gap-2 font-parent text-[16px] font-semibold text-ink">
      <LockKey size={20} weight="fill" className="text-brand" />
      {children}
    </p>
  );
}

function ErrorText({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="mt-3 rounded-2xl bg-[#FDE8E3] px-3 py-2 font-parent text-[13.5px] font-semibold text-cta">
      {children}
    </p>
  );
}

const inputClass =
  "mt-3 h-14 w-full rounded-[18px] bg-parent-bg text-center font-parent text-[26px] font-bold tracking-[0.4em] text-ink outline-none ring-brand focus:ring-2";

function PinStep({
  lockedUntil,
  onLocked,
  onUnlock,
  onForgot,
}: {
  lockedUntil: Date | null;
  onLocked: (until: Date | null) => void;
  onUnlock: () => void;
  onForgot: () => void;
}) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(
    lockedUntil ? unlockErrorMessage({ ok: false, reason: "locked", lockedUntil }) : null
  );
  const locked = Boolean(lockedUntil && lockedUntil.getTime() > Date.now());

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (busy || locked) return;
    if (!PIN_PATTERN.test(pin)) {
      setError("Mã PIN gồm 4–6 chữ số.");
      return;
    }
    setBusy(true);
    const result = await verifyParentPin(createClient(), pin);
    setBusy(false);
    setPin("");
    if (result.ok) {
      onUnlock();
      return;
    }
    if (result.reason === "locked") onLocked(result.lockedUntil ?? new Date(Date.now() + 15 * 60_000));
    setError(unlockErrorMessage(result));
  };

  return (
    <form onSubmit={submit} noValidate>
      <GateLabel>Nhập mã PIN phụ huynh</GateLabel>
      <input
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={PIN_MAX}
        aria-label="Mã PIN phụ huynh"
        value={pin}
        disabled={locked}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, PIN_MAX))}
        className={inputClass}
      />
      <Keypad
        disabled={locked || busy}
        onDigit={(d) => setPin((v) => appendDigit(v, d, PIN_MAX))}
        onBackspace={() => setPin((v) => v.slice(0, -1))}
      />
      {error && <ErrorText>{error}</ErrorText>}
      <Button3D type="submit" tone="brand" size="md" block className="mt-4" disabled={locked || busy || pin.length < 4}>
        {busy ? <Loader2 size={20} className="animate-spin" /> : <LockKey size={20} weight="fill" />}
        Mở khoá
      </Button3D>
      <button type="button" onClick={onForgot} className="mt-3 min-h-[44px] w-full font-parent text-[14.5px] font-semibold text-brand">
        Quên mã PIN?
      </button>
    </form>
  );
}

function MathStep({ onUnlock }: { onUnlock: () => void }) {
  const [challenge, setChallenge] = useState<AdultChallenge>(() => createAdultChallenge());
  const [answer, setAnswer] = useState("");
  const [misses, setMisses] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [nowMs, setNowMs] = useState(0);

  useEffect(() => {
    if (!cooldownUntil) return;
    const tick = () => {
      const t = Date.now();
      setNowMs(t);
      if (t >= cooldownUntil) {
        setCooldownUntil(0);
        setError(null);
      }
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [cooldownUntil]);

  const coolingDown = cooldownUntil > 0;

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (coolingDown || !answer) return;
    if (isChallengeAnswerCorrect(challenge, answer)) {
      onUnlock();
      return;
    }
    const n = misses + 1;
    setAnswer("");
    setChallenge(createAdultChallenge());
    if (n >= MAX_CHALLENGE_ATTEMPTS) {
      setMisses(0);
      setCooldownUntil(Date.now() + CHALLENGE_COOLDOWN_MS);
      setError("Sai nhiều lần quá. Đợi một chút rồi thử lại nhé.");
    } else {
      setMisses(n);
      setError("Chưa đúng. Thử câu khác nhé.");
    }
  };

  return (
    <form onSubmit={submit} noValidate>
      <GateLabel>Câu hỏi cho người lớn</GateLabel>
      <p className="mt-3 text-center font-parent text-[34px] font-bold text-ink" aria-label={challenge.spoken} data-challenge={challenge.question}>
        {challenge.question} = ?
      </p>
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        maxLength={4}
        aria-label="Kết quả phép tính"
        value={answer}
        disabled={coolingDown}
        onChange={(e) => setAnswer(e.target.value.replace(/\D/g, "").slice(0, 4))}
        className={inputClass}
      />
      <Keypad
        disabled={coolingDown}
        onDigit={(d) => setAnswer((v) => appendDigit(v, d, 4))}
        onBackspace={() => setAnswer((v) => v.slice(0, -1))}
      />
      {error && (
        <ErrorText>
          {error}
          {coolingDown && ` (${seconds(cooldownUntil - (nowMs || Date.now()))} giây)`}
        </ErrorText>
      )}
      <Button3D type="submit" tone="brand" size="md" block className="mt-4" disabled={coolingDown || !answer}>
        <LockKey size={20} weight="fill" />
        Mở khoá
      </Button3D>
      <p className="mt-3 text-center font-parent text-[13px] text-ink-2">
        Mẹo: đặt mã PIN trong <b className="font-semibold text-ink">Kiểm soát phụ huynh</b> để khoá chắc hơn.
      </p>
    </form>
  );
}

function ForgotStep({ onDone, onBack }: { onDone: () => void; onBack: () => void }) {
  const { user } = useAuth();
  const [phase, setPhase] = useState<"checking" | "password" | "oauth">("checking");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const providers: string[] = (user?.app_metadata?.providers as string[] | undefined) ?? [user?.app_metadata?.provider ?? "email"];
  const canUsePassword = Boolean(user?.email) && providers.includes("email");

  const tryReset = useCallback(async () => {
    const result = await resetParentPin(createClient());
    if (result.ok) {
      onDone();
      return true;
    }
    if (result.reason !== "reauth_required") setError(unlockErrorMessage(result));
    return false;
  }, [onDone]);

  useEffect(() => {
    // Email accounts always re-type the password here — a fresh login alone
    // isn't enough (a kid could tap "Quên mã PIN?" right after the parent
    // signed in). Google-only accounts come back from a re-login, so a session
    // that signed in within the last 10 minutes may reset straight away.
    if (canUsePassword) {
      setPhase("password");
      return;
    }
    let alive = true;
    tryReset().then((ok) => {
      if (alive && !ok) setPhase("oauth");
    });
    return () => {
      alive = false;
    };
  }, [tryReset, canUsePassword]);

  const submitPassword = async (e: FormEvent) => {
    e.preventDefault();
    if (!user?.email || !password || busy) return;
    setBusy(true);
    setError(null);
    const { error: authError } = await createClient().auth.signInWithPassword({ email: user.email, password });
    if (authError) {
      setBusy(false);
      setPassword("");
      setError("Mật khẩu chưa đúng. Vui lòng thử lại.");
      return;
    }
    const ok = await tryReset();
    setBusy(false);
    if (!ok) setError((prev) => prev ?? "Không đặt lại được mã PIN, vui lòng thử lại.");
  };

  const reauthWithGoogle = async () => {
    setBusy(true);
    await createClient().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  };

  return (
    <div>
      <GateLabel>Quên mã PIN</GateLabel>
      {phase === "checking" && (
        <div className="flex h-24 items-center justify-center" role="status" aria-label="Đang kiểm tra">
          <Loader2 size={24} className="animate-spin text-brand" />
        </div>
      )}
      {phase === "password" && (
        <form onSubmit={submitPassword} noValidate>
          <p className="mt-2 font-parent text-[14px] leading-relaxed text-ink-2">
            Nhập mật khẩu tài khoản <b className="font-semibold text-ink">{user?.email}</b> để xoá mã PIN cũ và đặt mã mới.
          </p>
          <input
            type="password"
            autoComplete="current-password"
            aria-label="Mật khẩu tài khoản"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-3 h-12 w-full rounded-[16px] bg-parent-bg px-4 font-parent text-[16px] text-ink outline-none ring-brand focus:ring-2"
          />
          {error && <ErrorText>{error}</ErrorText>}
          <Button3D type="submit" tone="brand" size="md" block className="mt-4" disabled={busy || !password}>
            {busy && <Loader2 size={20} className="animate-spin" />}
            Xác minh & đặt lại PIN
          </Button3D>
        </form>
      )}
      {phase === "oauth" && (
        <div>
          <p className="mt-2 font-parent text-[14px] leading-relaxed text-ink-2">
            Đăng nhập lại bằng Google, sau đó mở tab <b className="font-semibold text-ink">Bố mẹ</b> → <b className="font-semibold text-ink">Quên mã PIN?</b> trong vòng 10 phút để đặt mã mới.
          </p>
          {error && <ErrorText>{error}</ErrorText>}
          <Button3D tone="brand" size="md" block className="mt-4" disabled={busy} onClick={reauthWithGoogle}>
            Đăng nhập lại bằng Google
          </Button3D>
        </div>
      )}
      <button type="button" onClick={onBack} className="mt-3 min-h-[44px] w-full font-parent text-[14.5px] font-semibold text-brand">
        Quay lại nhập mã PIN
      </button>
    </div>
  );
}
