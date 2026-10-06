/**
 * Server-side helper to fetch app_settings from Supabase.
 * Used by API routes to get system-wide API keys.
 * Fallback chain: user-provided key → DB admin key → env variable.
 *
 * A-04: API keys live in Supabase Vault (migration 021). Only the service role
 * can read them (`get_system_secret`), so SUPABASE_SERVICE_ROLE_KEY (server env
 * only) is REQUIRED for keys set in the admin screen; without it secret keys
 * resolve to "" (→ env variables / BYO keys). Plain settings fall back to the
 * caller's own session and are never cached across users.
 */
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { createClient } from "@/lib/supabase/server";
import { isSecretSettingKey } from "@/lib/system-secrets";

const settingsCache: Map<string, { value: string; ts: number }> = new Map();
const CACHE_TTL = 60_000; // 1 minute

let serviceClient: SupabaseClient | null = null;

function getServiceClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  if (!serviceClient) {
    serviceClient = createSupabaseClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return serviceClient;
}

async function readSetting(client: SupabaseClient, key: string): Promise<string> {
  const { data, error } = await client
    .from("app_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  if (error) throw error;
  return data?.value ?? "";
}

/** A-04: decrypt an API key from Vault — service role only (anon / authenticated get "permission denied"). */
async function readSecret(service: SupabaseClient, key: string): Promise<string> {
  const { data, error } = await service.rpc("get_system_secret", { p_key: key });
  if (error) throw error;
  return typeof data === "string" ? data : "";
}

let warnedNoServiceRole = false;

function warnNoServiceRole() {
  if (warnedNoServiceRole) return;
  console.warn(
    "[server-settings] SUPABASE_SERVICE_ROLE_KEY chưa được cấu hình — API key admin lưu trong Vault sẽ không dùng được (chỉ dùng biến môi trường hoặc key riêng của người dùng)."
  );
  warnedNoServiceRole = true;
}

/** Forget cached values (all, or one key) — e.g. after a test. */
export function clearSystemSettingCache(key?: string) {
  if (key) settingsCache.delete(key);
  else settingsCache.clear();
}

export async function getSystemSetting(key: string): Promise<string> {
  const service = getServiceClient();
  const secret = isSecretSettingKey(key);

  if (service) {
    // Service-role reads are identical for every user → safe to cache.
    const cached = settingsCache.get(key);
    if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.value;
    try {
      const value = secret ? await readSecret(service, key) : await readSetting(service, key);
      // Empty = not configured yet: don't cache, so a key an admin has just set works right away.
      if (value) settingsCache.set(key, { value, ts: Date.now() });
      return value;
    } catch {
      return "";
    }
  }

  warnNoServiceRole();
  // Keys in Vault are unreadable without the service role — never ask with the user's session.
  if (secret) return "";

  // No service role: read plain settings with the caller's session (RLS applies).
  // Never cache — the result depends on who is asking.
  try {
    const supabase = await createClient();
    return await readSetting(supabase as unknown as SupabaseClient, key);
  } catch {
    return "";
  }
}

/**
 * Resolve the best available API key for a provider.
 * Priority: userKey (BYO) → admin DB setting → env variable.
 */
export async function resolveApiKey(
  provider: string,
  userKey?: string
): Promise<string> {
  // 1. User-provided key (BYO model)
  if (userKey) return userKey;

  // 2. Admin-configured key from DB
  const dbKeyMap: Record<string, string> = {
    openai: "openai_api_key",
    gemini: "gemini_api_key",
    anthropic: "anthropic_api_key",
    custom: "custom_provider_key",
    elevenlabs: "elevenlabs_api_key",
    dalle: "dalle_api_key",
  };
  const dbKey = dbKeyMap[provider];
  if (dbKey) {
    const dbValue = await getSystemSetting(dbKey);
    if (dbValue) return dbValue;
  }

  // 3. Environment variable fallback
  const envKeyMap: Record<string, string | undefined> = {
    openai: process.env.OPENAI_API_KEY,
    gemini: process.env.GEMINI_API_KEY,
    anthropic: process.env.ANTHROPIC_API_KEY,
    elevenlabs: process.env.ELEVENLABS_API_KEY,
    dalle: process.env.OPENAI_API_KEY, // DALL-E uses OpenAI key
  };
  return envKeyMap[provider] ?? "";
}

// ── SSRF protection for client-supplied base URLs ──────────────────────────

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

const BLOCKED_IPV4_CIDRS: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

function isPrivateIPv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  return BLOCKED_IPV4_CIDRS.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (n & mask) === (ipv4ToInt(base) & mask);
  });
}

/** Expand an IPv6 address (incl. embedded IPv4) to 8 numeric groups, or null if invalid. */
function expandIPv6(ip: string): number[] | null {
  let addr = ip.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  const v4 = addr.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a, b, c, d] = v4.slice(1).map(Number);
    addr = addr.slice(0, -v4[0].length) + ((a << 8) | b).toString(16) + ":" + ((c << 8) | d).toString(16);
  }
  const halves = addr.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0) return null;
  const groups = [...head, ...Array(fill).fill("0"), ...tail].map((g) => parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

function isPrivateIPv6(ip: string): boolean {
  const g = expandIPv6(ip);
  if (!g) return true;
  if (g.slice(0, 6).every((x) => x === 0)) return true; // ::/96 (::, ::1, IPv4-compatible)
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return true; // ::ffff:0:0/96 IPv4-mapped
  if (g[0] === 0x64 && g[1] === 0xff9b) return true; // 64:ff9b::/96 NAT64
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (g[0] === 0x2002) return isPrivateIPv4(`${g[1] >> 8}.${g[1] & 0xff}.${g[2] >> 8}.${g[2] & 0xff}`); // 6to4
  return false;
}

function isPrivateIp(ip: string): boolean {
  const kind = isIP(ip.replace(/^\[|\]$/g, ""));
  if (kind === 4) return isPrivateIPv4(ip);
  if (kind === 6) return isPrivateIPv6(ip);
  return true; // not an IP → treat as unsafe
}

const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa", ".lan"];

/**
 * True when the URL is http(s), has no credentials, and its host (after DNS
 * resolution) does not point at a private/internal/reserved address.
 * Note: does not fully prevent DNS rebinding; fetches to custom URLs must
 * also use `redirect: "error"`.
 */
export async function isSafePublicBaseUrl(raw: string): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  if (url.username || url.password) return false;

  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.+$/, "").toLowerCase();
  if (!host || host === "localhost") return false;
  if (BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) return false;

  if (isIP(host)) return !isPrivateIp(host);

  try {
    const records = await lookup(host, { all: true, verbatim: true });
    if (records.length === 0) return false;
    return records.every((r) => !isPrivateIp(r.address));
  } catch {
    return false;
  }
}

/**
 * Resolve custom provider base URL.
 *
 * A client-supplied base URL is honoured ONLY when the client also supplies
 * its own API key (BYO). Otherwise the admin-configured URL is used, so the
 * platform key can never be sent to an attacker-controlled host.
 * Returns "" when the client URL is unsafe (private/internal host).
 */
export async function resolveCustomBaseUrl(userUrl?: string, userKey?: string): Promise<string> {
  if (userUrl && userKey) {
    return (await isSafePublicBaseUrl(userUrl)) ? userUrl : "";
  }
  return await getSystemSetting("custom_provider_url");
}

/** Resolve ElevenLabs model ID. */
export async function resolveElevenLabsModel(userModel?: string): Promise<string> {
  if (userModel) return userModel;
  const dbModel = await getSystemSetting("elevenlabs_model_id");
  return dbModel || "eleven_multilingual_v2";
}

/** Resolve default voice ID for a language from default_voices table. */
export async function resolveDefaultVoice(language?: string): Promise<string> {
  if (!language) return "";
  try {
    const supabase = await createClient();
    let query = supabase
      .from("default_voices")
      .select("voice_id")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .limit(1);

    if (language) {
      query = query.eq("language", language);
    }

    const { data } = await query;
    return data?.[0]?.voice_id ?? "";
  } catch {
    return "";
  }
}
