import {MeteringUnavailableError} from "@/lib/ai-metering";
/**
 * Admin v2 · A-04b — xoay vòng nhiều API key giọng nói + tự bù key (server only).
 *
 * Kho key (migration 022) được đọc bằng service role và giữ trong bộ nhớ 30 s.
 * Mỗi lần gọi nhà cung cấp:
 *   1. Chọn key: key "chủ" của giọng nhân bản trước (provider_voice_bindings),
 *      rồi key đang ít request nhất, hoà thì key lâu chưa dùng nhất
 *      (round-robin) → nhiều request song song được rải đều các tài khoản.
 *   2. Lỗi → phân loại (classifyProviderError) rồi thử key kế tiếp:
 *        exhausted     hết credit → DB 'exhausted', thử lại sau 1 giờ
 *        invalid       key sai / bị khoá → DB 'invalid', chờ admin
 *        rate_limited  quá số request đồng thời → nghỉ 5 s (chỉ trong bộ nhớ)
 *        transient     5xx / mạng → nghỉ 15 s (chỉ trong bộ nhớ)
 *        voice_missing giọng không có trong tài khoản này → nhớ 30 phút, thử key khác
 *        skip          key thiếu quyền cho thao tác này → thử key khác
 *        fatal         lỗi của chính request (400 / 422…) → trả lỗi luôn, không đổi key
 *   3. Thành công → cộng lượt dùng (gom 15 s / lần ghi DB); key 'exhausted' chạy
 *      được lại → 'active'.
 * Biến môi trường (ELEVENLABS_API_KEY / FISH_API_KEY) là key dự phòng cuối cùng.
 * Không bao giờ trả key ra ngoài; thông báo lỗi đã lọc key.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceClient } from "@/lib/server-settings";
import { ProviderHttpError, VOICE_PROVIDER_INFO, type VoiceProvider } from "@/lib/provider-keys";
import { scrubSecret } from "@/lib/system-secrets";

export type KeyOutcome = "exhausted" | "invalid" | "rate_limited" | "transient" | "voice_missing" | "skip" | "fatal";

/** Decide what a provider failure says about the KEY (not the request). */
export function classifyProviderError(provider: VoiceProvider, err: unknown, opts: { voice?: boolean } = {}): KeyOutcome {
  if (!(err instanceof ProviderHttpError)) return "transient"; // network error, timeout, bad body
  const { status } = err;
  const code = (err.code ?? "").toLowerCase();
  const msg = err.message.toLowerCase();
  if (status === 0 || status >= 500) return "transient";
  if (status === 429) return "rate_limited";
  if (provider === "elevenlabs") {
    if (code === "quota_exceeded" || code === "insufficient_credits" || status === 402) return "exhausted";
    if (code === "voice_not_found" || (status === 404 && opts.voice)) return "voice_missing";
    if (code === "missing_permissions") return "skip";
    if (status === 401) return "invalid"; // invalid_api_key, detected_unusual_activity, unauthorized…
    if (status === 403) return "skip";
    return "fatal";
  }
  // Fish Audio: 401 key sai · 402 hết credit · 403 / 404 giọng không thuộc key / không tồn tại.
  if (status === 402 || /insufficient (balance|credit)/.test(msg)) return "exhausted";
  if (status === 401) return "invalid";
  if (status === 403 || status === 404) return opts.voice ? "voice_missing" : "skip";
  if (status === 400 && opts.voice && /(reference|model|voice).*(not (found|exist)|invalid)/.test(msg)) return "voice_missing";
  return "fatal";
}

export interface PoolKey {
  id: string;
  label: string;
  last4: string | null;
  secret: string;
  status: "active" | "exhausted";
  /** ms epoch; for 'exhausted' keys: don't retry before. */
  cooldownUntil: number | null;
  /** The env-variable fallback (not in the DB: nothing to report). */
  virtual?: boolean;
}

export interface KeyPoolDeps {
  /** Every enabled, not-invalid key of the provider; `null` when the pool can't be read. */
  loadKeys(provider: VoiceProvider): Promise<PoolKey[] | null>;
  envKey(provider: VoiceProvider): string;
  report(id: string, patch: { status?: "active" | "exhausted" | "invalid"; error?: string | null; cooldownUntil?: number | null }): Promise<void>;
  recordUsage(id: string, uses: number, chars: number): Promise<void>;
  voiceOwner(provider: VoiceProvider, voiceRef: string): Promise<string | null>;
  bindVoice(provider: VoiceProvider, voiceRef: string, keyId: string): Promise<void>;
  now(): number;
}

export interface KeyPoolOptions {
  ttlMs: number;
  exhaustedRetryMs: number;
  invalidHoldMs: number;
  rateLimitMs: number;
  transientMs: number;
  voiceMissingMs: number;
  maxAttempts: number;
  flushMs: number;
}

const DEFAULT_OPTIONS: KeyPoolOptions = {
  ttlMs: 30_000,
  exhaustedRetryMs: 60 * 60_000,
  invalidHoldMs: 10 * 60_000,
  rateLimitMs: 5_000,
  transientMs: 15_000,
  voiceMissingMs: 30 * 60_000,
  maxAttempts: 8,
  flushMs: 15_000,
};

export type KeyPoolErrorCode = "no_keys" | "all_unavailable" | "voice_missing" | "all_failed";

export interface KeyAttempt {
  key: string; // "…abcd" / label — never the key
  outcome: KeyOutcome;
  status: number | null;
}

/** Nothing usable / every key failed. `message` is safe to show to end users. */
export class KeyPoolError extends Error {
  readonly httpStatus: number;
  constructor(readonly provider: VoiceProvider, readonly code: KeyPoolErrorCode, readonly attempts: KeyAttempt[] = []) {
    const label = VOICE_PROVIDER_INFO[provider].label;
    const message =
      code === "no_keys"
        ? `Chưa cấu hình API key ${label}. Admin cần thêm key trong Cài Đặt Hệ Thống.`
        : code === "voice_missing"
          ? `Không tìm thấy giọng này trong tài khoản ${label} nào của hệ thống.`
          : code === "all_unavailable"
            ? `Mọi key ${label} đang hết credit hoặc tạm nghỉ. Admin cần nạp credit hoặc thêm key.`
            : `Đã thử ${attempts.length} key ${label} nhưng đều lỗi (hết credit / key sai / quá tải). Vui lòng thử lại sau.`;
    super(message);
    this.name = "KeyPoolError";
    this.httpStatus = code === "no_keys" ? 400 : code === "voice_missing" ? 404 : 503;
  }
}

export interface RunOptions<T> {
  /** Provider voice id: prefer its owner key, remember accounts that don't have it. */
  voiceRef?: string;
  /** Characters billed (usage stats). */
  chars?: number;
  /** After success: provider voice id to bind to the key that created it (voice cloning). */
  bindVoiceFrom?: (result: T) => string | null | undefined;
}

export function createKeyPool(deps: KeyPoolDeps, options: Partial<KeyPoolOptions> = {}) {
  const opt = { ...DEFAULT_OPTIONS, ...options };
  const cache = new Map<VoiceProvider, { keys: PoolKey[]; ts: number }>();
  const inflight = new Map<string, number>();
  const lastPicked = new Map<string, number>();
  const holdUntil = new Map<string, number>(); // local cooldown (rate limit / transient / invalid)
  const missingVoice = new Map<string, number>(); // `${keyId}|${voiceRef}` → until
  const usage = new Map<string, { uses: number; chars: number }>();
  let pickSeq = 0;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  async function keys(provider: VoiceProvider): Promise<PoolKey[]> {
    const now = deps.now();
    const cached = cache.get(provider);
    let stored: PoolKey[];
    if (cached && now - cached.ts < opt.ttlMs) {
      stored = cached.keys;
    } else {
      const loaded = await deps.loadKeys(provider).catch(() => null);
      stored = loaded ?? cached?.keys ?? [];
      // Empty = not configured yet: don't cache, so a key an admin has just added works right away.
      if (loaded?.length) cache.set(provider, { keys: loaded, ts: now });
      else if (loaded) cache.delete(provider);
    }
    const env = deps.envKey(provider);
    if (env && !stored.some((k) => k.secret === env)) {
      stored = [...stored, { id: `env:${provider}`, label: "Biến môi trường", last4: env.length >= 12 ? env.slice(-4) : null, secret: env, status: "active", cooldownUntil: null, virtual: true }];
    }
    return stored;
  }

  function usable(k: PoolKey, now: number): boolean {
    if ((holdUntil.get(k.id) ?? 0) > now) return false;
    if (k.status === "exhausted" && k.cooldownUntil && k.cooldownUntil > now) return false;
    return true;
  }

  /** Candidate order for one call (pure w.r.t. the in-memory state). */
  function order(list: PoolKey[], pinned: string | null, voiceRef: string | undefined, now: number): PoolKey[] {
    const missing = (k: PoolKey) => Boolean(voiceRef && (missingVoice.get(`${k.id}|${voiceRef}`) ?? 0) > now);
    return list
      .map((k, i) => ({ k, i }))
      .filter(({ k }) => usable(k, now))
      .sort((a, b) => {
        const rank = (k: PoolKey) => (k.id === pinned ? 0 : 1) + (missing(k) ? 2 : 0) + (k.virtual ? 4 : 0);
        return (
          rank(a.k) - rank(b.k) ||
          (inflight.get(a.k.id) ?? 0) - (inflight.get(b.k.id) ?? 0) ||
          (lastPicked.get(a.k.id) ?? 0) - (lastPicked.get(b.k.id) ?? 0) ||
          a.i - b.i
        );
      })
      .map(({ k }) => k);
  }

  function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flushUsage();
    }, opt.flushMs);
    (flushTimer as { unref?: () => void }).unref?.();
  }

  async function flushUsage(): Promise<void> {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    const batch = [...usage.entries()];
    usage.clear();
    await Promise.all(batch.map(([id, u]) => deps.recordUsage(id, u.uses, u.chars).catch(() => {})));
  }

  async function onSuccess(provider: VoiceProvider, key: PoolKey, chars: number) {
    if (key.virtual) return;
    const u = usage.get(key.id) ?? { uses: 0, chars: 0 };
    usage.set(key.id, { uses: u.uses + 1, chars: u.chars + Math.max(0, Math.round(chars)) });
    if (key.status === "exhausted") {
      // Credit is back (new month / top-up): the DB flips it to 'active' with the usage write.
      key.status = "active";
      key.cooldownUntil = null;
      await flushUsage();
    } else {
      scheduleFlush();
    }
    void provider;
  }

  async function onFailure(provider: VoiceProvider, key: PoolKey, outcome: KeyOutcome, err: unknown, voiceRef?: string) {
    const now = deps.now();
    const error = scrubSecret(err instanceof Error ? err.message : String(err), key.secret).slice(0, 300);
    switch (outcome) {
      case "exhausted": {
        const until = now + opt.exhaustedRetryMs;
        key.status = "exhausted";
        key.cooldownUntil = until;
        if (!key.virtual) await deps.report(key.id, { status: "exhausted", error, cooldownUntil: until }).catch(() => {});
        break;
      }
      case "invalid": {
        holdUntil.set(key.id, now + opt.invalidHoldMs);
        const cached = cache.get(provider);
        if (cached) cached.keys = cached.keys.filter((k) => k.id !== key.id);
        if (!key.virtual) await deps.report(key.id, { status: "invalid", error }).catch(() => {});
        break;
      }
      case "rate_limited":
        holdUntil.set(key.id, now + opt.rateLimitMs);
        break;
      case "transient":
        holdUntil.set(key.id, now + opt.transientMs);
        break;
      case "voice_missing":
        if (voiceRef) missingVoice.set(`${key.id}|${voiceRef}`, now + opt.voiceMissingMs);
        break;
      default:
        break;
    }
  }

  /**
   * Run `op` with the best key, failing over to the next one on key problems.
   * Throws {@link KeyPoolError} when no key could serve the call, or the
   * provider's (key-scrubbed) error when the request itself is wrong.
   */
  async function run<T>(provider: VoiceProvider, op: (apiKey: string) => Promise<T>, o: RunOptions<T> = {}): Promise<T> {
    const list = await keys(provider);
    if (!list.length) throw new KeyPoolError(provider, "no_keys");
    const pinned = o.voiceRef ? await deps.voiceOwner(provider, o.voiceRef).catch(() => null) : null;
    const candidates = order(list, pinned, o.voiceRef, deps.now()).slice(0, opt.maxAttempts);
    if (!candidates.length) throw new KeyPoolError(provider, "all_unavailable");
    const attempts: KeyAttempt[] = [];
    for (const key of candidates) {
      lastPicked.set(key.id, ++pickSeq);
      inflight.set(key.id, (inflight.get(key.id) ?? 0) + 1);
      try {
        const result = await op(key.secret);
        await onSuccess(provider, key, o.chars ?? 0);
        const ref = o.bindVoiceFrom?.(result);
        if (ref && !key.virtual) await deps.bindVoice(provider, ref, key.id).catch(() => {});
        return result;
      } catch (err) {
        if(err instanceof MeteringUnavailableError)throw err;
        const outcome = classifyProviderError(provider, err, { voice: Boolean(o.voiceRef) });
        attempts.push({
          key: key.last4 ? `…${key.last4}` : key.label,
          outcome,
          status: err instanceof ProviderHttpError ? err.status : null,
        });
        if (outcome === "fatal") {
          const message = scrubSecret(err instanceof Error ? err.message : String(err), key.secret);
          throw err instanceof ProviderHttpError
            ? new ProviderHttpError(err.provider, err.status, err.code, message)
            : new Error(message);
        }
        await onFailure(provider, key, outcome, err, o.voiceRef);
      } finally {
        inflight.set(key.id, Math.max(0, (inflight.get(key.id) ?? 1) - 1));
      }
    }
    const code: KeyPoolErrorCode = attempts.every((a) => a.outcome === "voice_missing") ? "voice_missing" : "all_failed";
    throw new KeyPoolError(provider, code, attempts);
  }

  return {
    run,
    flushUsage,
    /** Any key at all (stored or env) — "configured" for the UI. */
    async configured(provider: VoiceProvider): Promise<boolean> {
      return (await keys(provider)).length > 0;
    },
    /** Keys usable right now. */
    async available(provider: VoiceProvider): Promise<number> {
      const now = deps.now();
      return (await keys(provider)).filter((k) => usable(k, now)).length;
    },
    /** One key for a one-off admin call (no failover) — "" when none is usable. */
    async pickSecret(provider: VoiceProvider): Promise<string> {
      const best = order(await keys(provider), null, undefined, deps.now())[0];
      if (!best) return "";
      lastPicked.set(best.id, ++pickSeq);
      return best.secret;
    },
    /** Forget the cached pool (after the admin changed it) and local cooldowns of those keys. */
    invalidate(provider?: VoiceProvider) {
      for (const p of provider ? [provider] : [...cache.keys()]) {
        for (const k of cache.get(p)?.keys ?? []) holdUntil.delete(k.id);
        cache.delete(p);
      }
    },
    /** Test helper: in-flight counts. */
    _inflight: inflight,
  };
}

export type KeyPool = ReturnType<typeof createKeyPool>;

// ── Default instance: Supabase (service role) ───────────────────────────────

type PoolRow = { id: string; label: string; last4: string | null; secret: string | null; status: string; cooldown_until: string | null };

function serviceRpc(): SupabaseClient | null {
  return getServiceClient();
}

const ENV_KEYS: Record<VoiceProvider, () => string | undefined> = {
  elevenlabs: () => process.env.ELEVENLABS_API_KEY,
  fishaudio: () => process.env.FISH_API_KEY || process.env.FISH_AUDIO_API_KEY,
};

export const voiceKeyPool: KeyPool = createKeyPool({
  async loadKeys(provider) {
    const service = serviceRpc();
    if (!service) return [];
    const { data, error } = await service.rpc("get_provider_key_pool", { p_provider: provider });
    if (error) {
      console.error("[key-pool] không đọc được kho key", provider, error.code ?? "");
      return null;
    }
    return ((data ?? []) as PoolRow[])
      .filter((r) => r.secret)
      .map((r) => ({
        id: r.id,
        label: r.label,
        last4: r.last4,
        secret: r.secret as string,
        status: r.status === "exhausted" ? "exhausted" : "active",
        cooldownUntil: r.cooldown_until ? Date.parse(r.cooldown_until) : null,
      }));
  },
  envKey: (provider) => (ENV_KEYS[provider]() ?? "").trim(),
  async report(id, patch) {
    const service = serviceRpc();
    if (!service) return;
    await service.rpc("report_provider_key", {
      p_id: id,
      p_status: patch.status ?? null,
      p_error: patch.error ?? null,
      p_cooldown_until: patch.cooldownUntil ? new Date(patch.cooldownUntil).toISOString() : null,
    });
  },
  async recordUsage(id, uses, chars) {
    const service = serviceRpc();
    if (!service) return;
    await service.rpc("record_provider_key_usage", { p_id: id, p_uses: uses, p_chars: chars });
  },
  async voiceOwner(provider, voiceRef) {
    const service = serviceRpc();
    if (!service) return null;
    const { data } = await service.rpc("get_provider_voice_key", { p_provider: provider, p_voice_ref: voiceRef });
    return typeof data === "string" ? data : null;
  },
  async bindVoice(provider, voiceRef, keyId) {
    const service = serviceRpc();
    if (!service) return;
    await service.rpc("bind_provider_voice", { p_provider: provider, p_voice_ref: voiceRef, p_key_id: keyId });
  },
  now: () => Date.now(),
});

/** Map a pool failure to an API response (safe message, no key). */
export function keyPoolErrorResponse(err: unknown, fallback: string): Response {
  if (err instanceof MeteringUnavailableError)return Response.json({error:err.message,code:"measurement_unavailable"},{status:503});
  if (err instanceof KeyPoolError) {
    return Response.json({ error: err.message, code: `key_pool_${err.code}` }, { status: err.httpStatus });
  }
  const message = err instanceof Error ? scrubSecret(err.message) : fallback;
  const status = err instanceof ProviderHttpError && err.status >= 400 && err.status < 500 ? 400 : 502;
  return Response.json({ error: message || fallback }, { status });
}
