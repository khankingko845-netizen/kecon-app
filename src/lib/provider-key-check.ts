/**
 * A-04b — "Kiểm tra" one pool key (server only): is it valid, how much credit is left.
 *  - ElevenLabs: GET /v1/user/subscription (needs `user_read`); restricted keys
 *    without it fall back to GET /v1/voices (`voices_read`).
 *  - Fish Audio: GET /wallet/self/api-credit (USD balance). Balance 0 is still
 *    fine with a free model (`s2.1-pro-free`).
 * `status: null` = couldn't tell (network / rate limit) → keep the current status.
 */
import { getSubscription, listVoices } from "@/lib/elevenlabs";
import { fishGetCredit, isFreeFishModel } from "@/lib/fishaudio";
import { classifyProviderError } from "@/lib/key-pool";
import { ProviderHttpError, type ProviderCredit, type ProviderKeyState, type VoiceProvider } from "@/lib/provider-keys";
import { scrubSecret } from "@/lib/system-secrets";

export interface KeyCheck {
  status: ProviderKeyState | null;
  error: string | null;
  credit: ProviderCredit | null;
  cooldownUntil: string | null;
}

const HOUR = 3600_000;

function failure(provider: VoiceProvider, err: unknown, key: string): KeyCheck {
  const outcome = classifyProviderError(provider, err);
  const error = scrubSecret(err instanceof Error ? err.message : String(err), key).slice(0, 300);
  if (outcome === "exhausted") return { status: "exhausted", error, credit: null, cooldownUntil: new Date(Date.now() + HOUR).toISOString() };
  if (outcome === "invalid") return { status: "invalid", error, credit: null, cooldownUntil: null };
  return { status: null, error, credit: null, cooldownUntil: null };
}

export async function checkProviderKey(provider: VoiceProvider, key: string, opts: { fishModel?: string } = {}): Promise<KeyCheck> {
  if (provider === "elevenlabs") {
    try {
      const sub = await getSubscription(key);
      const remaining = Math.max(0, sub.character_limit - sub.character_count);
      const resetAt = sub.next_character_count_reset_unix ? new Date(sub.next_character_count_reset_unix * 1000).toISOString() : null;
      const credit: ProviderCredit = { unit: "characters", used: sub.character_count, limit: sub.character_limit, remaining, reset_at: resetAt, tier: sub.tier };
      if (remaining <= 0) {
        return { status: "exhausted", error: "ElevenLabs: hết ký tự của kỳ này", credit, cooldownUntil: resetAt ?? new Date(Date.now() + HOUR).toISOString() };
      }
      return { status: "active", error: null, credit, cooldownUntil: null };
    } catch (err) {
      if (!(err instanceof ProviderHttpError) || err.code !== "missing_permissions") return failure(provider, err, key);
      try {
        await listVoices(key);
        return { status: "active", error: null, credit: { unit: "unknown", note: "Key giới hạn quyền — không xem được credit (cần quyền user_read)" }, cooldownUntil: null };
      } catch (err2) {
        if (err2 instanceof ProviderHttpError && err2.code === "missing_permissions") {
          return { status: null, error: "Key thiếu quyền user_read / voices_read nên không kiểm tra được — sẽ biết khi đọc truyện", credit: null, cooldownUntil: null };
        }
        return failure(provider, err2, key);
      }
    }
  }
  try {
    const { balance, hasFreeCredit } = await fishGetCredit(key);
    const credit: ProviderCredit = { unit: "usd", balance };
    if (balance <= 0 && !hasFreeCredit && !isFreeFishModel(opts.fishModel ?? "")) {
      return {
        status: "exhausted",
        error: "Fish Audio: số dư $0 — nạp credit hoặc chọn model s2.1-pro-free",
        credit,
        cooldownUntil: new Date(Date.now() + HOUR).toISOString(),
      };
    }
    return { status: "active", error: null, credit, cooldownUntil: null };
  } catch (err) {
    return failure(provider, err, key);
  }
}
