/**
 * Server-side helper to fetch app_settings from Supabase.
 * Used by API routes to get system-wide API keys.
 * Fallback chain: user-provided key → DB admin key → env variable.
 *
 * Secret settings are protected by RLS (admin-only). To let API routes use
 * admin-configured keys for every user, set SUPABASE_SERVICE_ROLE_KEY (server
 * env only). Without it we fall back to the caller's own session and never
 * cache results across users.
 */
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { createClient } from "@/lib/supabase/server";

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

let warnedNoServiceRole = false;

export async function getSystemSetting(key: string): Promise<string> {
  const service = getServiceClient();

  if (service) {
    // Service-role reads are identical for every user → safe to cache.
    const cached = settingsCache.get(key);
    if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.value;
    try {
      const value = await readSetting(service, key);
      settingsCache.set(key, { value, ts: Date.now() });
      return value;
    } catch {
      return "";
    }
  }

  // No service role: read with the caller's session (RLS applies).
  // Never cache — the result depends on who is asking.
  if (!warnedNoServiceRole) {
    console.warn(
      "[server-settings] SUPABASE_SERVICE_ROLE_KEY chưa được cấu hình — user thường sẽ không dùng được API key admin lưu trong app_settings (chỉ dùng biến môi trường hoặc key riêng)."
    );
    warnedNoServiceRole = true;
  }
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

function isPrivateIPv6(ip: string): boolean {
  const addr = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (addr === "::" || addr === "::1") return true;
  // IPv4-mapped / IPv4-compatible (::ffff:a.b.c.d, ::a.b.c.d)
  const v4 = addr.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) return isPrivateIPv4(v4[1]) || addr.startsWith("::ffff:") || addr.startsWith("64:ff9b:");
  if (addr.startsWith("::ffff:")) return true;
  if (addr.startsWith("64:ff9b:")) return true; // NAT64
  const first = parseInt(addr.split(":")[0] || "0", 16);
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((first & 0xff00) === 0xff00) return true; // ff00::/8 multicast
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
