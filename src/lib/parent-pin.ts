/**
 * Parental PIN (T03). The PIN is hashed (bcrypt) and checked in Postgres via
 * SECURITY DEFINER RPCs (migration 017); the client never sees the hash.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type PinFailureReason =
  | "no_pin"
  | "invalid"
  | "locked"
  | "invalid_format"
  | "unauthenticated"
  | "reauth_required"
  | "unavailable";

export interface PinResult {
  ok: boolean;
  reason?: PinFailureReason;
  attemptsLeft?: number;
  lockedUntil?: Date | null;
}

export interface PinStatus {
  hasPin: boolean;
  resetRequired: boolean;
  lockedUntil: Date | null;
}

export const PIN_PATTERN = /^\d{4,6}$/;

interface RawPinResult {
  ok?: boolean;
  reason?: PinFailureReason;
  attempts_left?: number;
  locked_until?: string | null;
  has_pin?: boolean;
  reset_required?: boolean;
}

function toDate(value: string | null | undefined): Date | null {
  return value ? new Date(value) : null;
}

function toResult(raw: RawPinResult | null, error: unknown): PinResult {
  if (error || !raw) return { ok: false, reason: "unavailable" };
  return {
    ok: Boolean(raw.ok),
    reason: raw.reason,
    attemptsLeft: raw.attempts_left,
    lockedUntil: toDate(raw.locked_until),
  };
}

export async function getParentPinStatus(supabase: SupabaseClient): Promise<PinStatus | null> {
  const { data, error } = await supabase.rpc("parent_pin_status");
  const raw = data as RawPinResult | null;
  if (error || !raw?.ok) return null;
  return {
    hasPin: Boolean(raw.has_pin),
    resetRequired: Boolean(raw.reset_required),
    lockedUntil: toDate(raw.locked_until),
  };
}

export async function setParentPin(
  supabase: SupabaseClient,
  newPin: string,
  currentPin?: string
): Promise<PinResult> {
  if (!PIN_PATTERN.test(newPin)) return { ok: false, reason: "invalid_format" };
  const { data, error } = await supabase.rpc("set_parent_pin", {
    p_new_pin: newPin,
    p_current_pin: currentPin || null,
  });
  return toResult(data as RawPinResult | null, error);
}

export async function verifyParentPin(supabase: SupabaseClient, pin: string): Promise<PinResult> {
  const { data, error } = await supabase.rpc("verify_parent_pin", { p_pin: pin });
  return toResult(data as RawPinResult | null, error);
}

/**
 * Forgot-PIN (T19, migration 018): clears the PIN server-side, but only when
 * the current session signed in again within the last 10 minutes (JWT `amr`).
 * Otherwise returns `reauth_required` — sign in with the account first.
 */
export async function resetParentPin(supabase: SupabaseClient): Promise<PinResult> {
  const { data, error } = await supabase.rpc("reset_parent_pin");
  return toResult(data as RawPinResult | null, error);
}

/** Message for a failed unlock attempt at the parent gate. */
export function unlockErrorMessage(result: PinResult, now: Date = new Date()): string {
  if (result.reason === "invalid") {
    return result.attemptsLeft !== undefined
      ? `Mã PIN chưa đúng. Còn ${result.attemptsLeft} lần thử trước khi bị khoá.`
      : "Mã PIN chưa đúng.";
  }
  if (result.reason === "unavailable") return "Không kiểm tra được mã PIN, vui lòng thử lại.";
  return pinErrorMessage(result, now);
}

/** Vietnamese, parent-facing message for a failed PIN operation. */
export function pinErrorMessage(result: PinResult, now: Date = new Date()): string {
  switch (result.reason) {
    case "invalid_format":
      return "Mã PIN phải gồm 4–6 chữ số.";
    case "invalid":
      return result.attemptsLeft !== undefined
        ? `Mã PIN hiện tại không đúng. Còn ${result.attemptsLeft} lần thử trước khi bị khoá.`
        : "Mã PIN hiện tại không đúng.";
    case "locked": {
      const minutes = result.lockedUntil
        ? Math.max(1, Math.ceil((result.lockedUntil.getTime() - now.getTime()) / 60_000))
        : 15;
      return `Nhập sai quá nhiều lần. Vui lòng thử lại sau ${minutes} phút.`;
    }
    case "no_pin":
      return "Chưa đặt mã PIN.";
    case "unauthenticated":
      return "Phiên đăng nhập đã hết, vui lòng đăng nhập lại.";
    case "reauth_required":
      return "Vui lòng xác minh lại tài khoản để đặt lại mã PIN.";
    default:
      return "Không lưu được mã PIN, vui lòng thử lại.";
  }
}
