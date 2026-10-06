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
    default:
      return "Không lưu được mã PIN, vui lòng thử lại.";
  }
}
