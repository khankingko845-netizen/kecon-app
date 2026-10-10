/**
 * Admin v2 · A-04b — kho nhiều API key giọng nói (ElevenLabs + Fish Audio).
 *
 * Shared by the admin screen and the server: provider metadata, the row shape
 * returned by `list_provider_keys()` (migration 022 — never contains a key),
 * the HTTP error every provider client throws, and display helpers.
 * The rotation / failover engine is server-only: `src/lib/key-pool.ts`.
 */

export const VOICE_PROVIDERS = ["elevenlabs", "fishaudio"] as const;
export type VoiceProvider = (typeof VOICE_PROVIDERS)[number];

export const VOICE_PROVIDER_INFO: Record<VoiceProvider, { label: string; keysUrl: string; placeholder: string; envVar: string }> = {
  elevenlabs: {
    label: "ElevenLabs",
    keysUrl: "https://elevenlabs.io/app/settings/api-keys",
    placeholder: "sk_...",
    envVar: "ELEVENLABS_API_KEY",
  },
  fishaudio: {
    label: "Fish Audio",
    keysUrl: "https://fish.audio/app/api-keys/",
    placeholder: "Fish Audio API key",
    envVar: "FISH_API_KEY",
  },
};

export function isVoiceProvider(value: unknown): value is VoiceProvider {
  return typeof value === "string" && (VOICE_PROVIDERS as readonly string[]).includes(value);
}

/** Fish Audio voices are addressed as `fish:<reference_id>` everywhere a voice id is stored (default voices, stories). */
export const FISH_VOICE_PREFIX = "fish:";
export function isFishVoiceId(voiceId: string): boolean {
  return voiceId.startsWith(FISH_VOICE_PREFIX);
}
export function voiceProviderOf(voiceId: string): VoiceProvider {
  return isFishVoiceId(voiceId) ? "fishaudio" : "elevenlabs";
}
/** The id the provider itself knows (`fish:abc` → `abc`). */
export function providerVoiceRef(voiceId: string): string {
  return isFishVoiceId(voiceId) ? voiceId.slice(FISH_VOICE_PREFIX.length) : voiceId;
}
/** Voice ids accepted by the API: ElevenLabs ids, or `fish:` + a Fish Audio model id. */
export const VOICE_ID_PATTERN = /^(?:fish:)?[\w-]+$/;

export type ProviderKeyState = "active" | "exhausted" | "invalid";

/** Credit read by "Kiểm tra" — ElevenLabs: characters this period; Fish Audio: USD balance. */
export type ProviderCredit =
  | { unit: "characters"; used: number; limit: number; remaining: number; reset_at: string | null; tier?: string | null }
  | { unit: "usd"; balance: number }
  | { unit: "unknown"; note: string };

/** One row of `list_provider_keys()` — status only, never the key. */
export interface ProviderKeyRow {
  id: string;
  provider: VoiceProvider;
  label: string;
  last4: string | null;
  enabled: boolean;
  status: ProviderKeyState;
  cooldown_until: string | null;
  last_error: string | null;
  use_count: number;
  char_count: number;
  last_used_at: string | null;
  credit: ProviderCredit | null;
  credit_checked_at: string | null;
  created_at: string;
  created_by_email: string | null;
  updated_at: string;
}

/** Result of POST /api/admin/provider-keys/check for one key. */
export interface ProviderKeyCheckResult {
  id: string;
  provider: VoiceProvider;
  status: ProviderKeyState;
  ok: boolean;
  error: string | null;
  credit: ProviderCredit | null;
}

/** Thrown by the ElevenLabs / Fish Audio clients for any non-2xx answer. */
export class ProviderHttpError extends Error {
  constructor(
    readonly provider: VoiceProvider,
    readonly status: number,
    /** Machine code from the body when there is one (ElevenLabs `detail.status`, e.g. `quota_exceeded`). */
    readonly code: string | null,
    message: string
  ) {
    super(message);
    this.name = "ProviderHttpError";
  }
}

/** Build a {@link ProviderHttpError} from a failed response (ElevenLabs `{detail}` / Fish Audio `{message, status}` bodies). */
/** Provider error codes worth explaining in Vietnamese (shown as "Lỗi gần nhất" in the key pool). */
const PROVIDER_CODE_HINTS: Record<string, string> = {
  detected_unusual_activity:
    "ElevenLabs đã khoá Free Tier của tài khoản này (phát hiện bất thường: VPN / proxy hoặc nhiều tài khoản free) — cần nâng cấp gói trả phí hoặc dùng tài khoản khác",
};

export async function providerHttpError(provider: VoiceProvider, res: Response, what: string): Promise<ProviderHttpError> {
  const text = await res.text().catch(() => "");
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  let code: string | null = null;
  let detail = "";
  if (body && typeof body === "object") {
    const b = body as { detail?: unknown; message?: unknown; error?: unknown };
    if (b.detail && typeof b.detail === "object") {
      const d = b.detail as { status?: unknown; code?: unknown; message?: unknown };
      code = typeof d.status === "string" ? d.status : typeof d.code === "string" ? d.code : null;
      detail = typeof d.message === "string" ? d.message : "";
    } else if (typeof b.detail === "string") {
      detail = b.detail;
    } else if (typeof b.message === "string") {
      detail = b.message;
    } else if (typeof b.error === "string") {
      detail = b.error;
    }
  } else if (text && text.length < 200 && !/^\s*</.test(text)) {
    detail = text.trim();
  }
  const label = VOICE_PROVIDER_INFO[provider].label;
  const hint = code ? PROVIDER_CODE_HINTS[code] : undefined;
  if (hint) detail = hint;
  return new ProviderHttpError(provider, res.status, code, `${label} ${what} ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
}

const fmtInt = (n: number) => Math.round(n).toLocaleString("vi-VN");

export function providerCreditText(credit: ProviderCredit | null | undefined): string | null {
  if (!credit) return null;
  if (credit.unit === "characters") {
    const reset = credit.reset_at ? ` · làm mới ${new Date(credit.reset_at).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" })}` : "";
    return `Còn ${fmtInt(credit.remaining)} / ${fmtInt(credit.limit)} ký tự${reset}`;
  }
  if (credit.unit === "usd") return `Số dư $${credit.balance.toFixed(2)}`;
  return credit.note;
}

/** Vietnamese status chip for one key. */
export function providerKeyStatusText(row: Pick<ProviderKeyRow, "enabled" | "status" | "cooldown_until">, now = Date.now()): {
  text: string;
  tone: "ok" | "warn" | "error" | "off";
} {
  if (!row.enabled) return { text: "Đã tắt", tone: "off" };
  if (row.status === "invalid") return { text: "Key sai / bị khoá", tone: "error" };
  if (row.status === "exhausted") {
    const until = row.cooldown_until ? Date.parse(row.cooldown_until) : NaN;
    let when = " · sẽ thử lại";
    if (Number.isFinite(until) && until > now) {
      const at = new Date(until);
      const pad = (n: number) => String(n).padStart(2, "0");
      const time = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
      // ElevenLabs quota resets monthly → show the day too when it isn't today.
      const sameDay = at.toDateString() === new Date(now).toDateString();
      when = ` · thử lại ${sameDay ? time : `${pad(at.getDate())}/${pad(at.getMonth() + 1)} ${time}`}`;
    }
    return { text: `Hết credit${when}`, tone: "warn" };
  }
  return { text: "Đang dùng", tone: "ok" };
}
