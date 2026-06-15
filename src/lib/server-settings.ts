/**
 * Server-side helper to fetch app_settings from Supabase.
 * Used by API routes to get system-wide API keys.
 * Falls back chain: user-provided key → DB admin key → env variable.
 */
import { createClient } from "@/lib/supabase/server";

const settingsCache: Map<string, { value: string; ts: number }> = new Map();
const CACHE_TTL = 60_000; // 1 minute

export async function getSystemSetting(key: string): Promise<string> {
  // Check cache first
  const cached = settingsCache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return cached.value;
  }

  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", key)
      .single();
    const value = data?.value ?? "";
    settingsCache.set(key, { value, ts: Date.now() });
    return value;
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

/** Resolve custom provider base URL. */
export async function resolveCustomBaseUrl(userUrl?: string): Promise<string> {
  if (userUrl) return userUrl;
  return await getSystemSetting("custom_provider_url");
}

/** Resolve ElevenLabs model ID. */
export async function resolveElevenLabsModel(userModel?: string): Promise<string> {
  if (userModel) return userModel;
  const dbModel = await getSystemSetting("elevenlabs_model_id");
  return dbModel || "eleven_multilingual_v2";
}
