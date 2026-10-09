/**
 * Server-side page illustration: provider resolution, image generation and
 * upload to the public `illustrations` bucket (no expiring provider URLs).
 *
 * DALL·E 3 is gone from the OpenAI API; OpenAI uses GPT Image models
 * (base64 output) and Google uses Gemini image models (inline data).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSystemSetting, resolveApiKey } from "@/lib/server-settings";
import { meteredFetch } from "@/lib/ai-metering";

export type IllustrationProvider = "openai" | "gemini" | "custom";
import { DEFAULT_CUSTOM_IMAGE_MODEL, DEFAULT_GEMINI_IMAGE_MODEL, DEFAULT_OPENAI_IMAGE_MODEL } from "@/lib/illustration-models";
export { DEFAULT_CUSTOM_IMAGE_MODEL, DEFAULT_GEMINI_IMAGE_MODEL, DEFAULT_OPENAI_IMAGE_MODEL };
const QUALITIES = ["low", "medium", "high"] as const;
type Quality = (typeof QUALITIES)[number];

export interface IllustrationTarget {
  provider: IllustrationProvider;
  apiKey: string;
  model: string;
  quality: Quality;
  byo: boolean;
  /** custom only: OpenAI-compatible base URL (…/v1). */
  baseUrl?: string;
}

const MODEL_RE = /^[A-Za-z0-9_.:-]{1,80}$/;

/** HTTPS base URL of the admin's OpenAI-compatible gateway, without a trailing slash. */
function customBaseUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "https:" || u.username || u.password) return null;
    return u.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

/**
 * auto → OpenAI (dalle/openai key) → Gemini key → the custom OpenAI-compatible
 * gateway (Settings → AI). `off` disables. BYO keys are OpenAI keys.
 */
export async function resolveIllustrationTarget(userKey?: string): Promise<IllustrationTarget | null> {
  const [pref, modelSetting, qualitySetting] = await Promise.all([
    getSystemSetting("illustration_provider"),
    getSystemSetting("illustration_model"),
    getSystemSetting("illustration_quality"),
  ]);
  const provider = (pref || "auto").toLowerCase();
  if (provider === "off") return null;
  const model = MODEL_RE.test(modelSetting) ? modelSetting : "";
  const quality = (QUALITIES as readonly string[]).includes(qualitySetting) ? (qualitySetting as Quality) : "low";
  if (provider === "auto" || provider === "openai") {
    const key = userKey || (await resolveApiKey("dalle")) || (await resolveApiKey("openai"));
    if (key)
      return {
        provider: "openai",
        apiKey: key,
        model: model && !model.startsWith("gemini") && !model.startsWith("dall-e") ? model : DEFAULT_OPENAI_IMAGE_MODEL,
        quality,
        byo: Boolean(userKey),
      };
    if (provider === "openai") return null;
  }
  if (provider === "auto" || provider === "gemini") {
    const key = await resolveApiKey("gemini");
    if (key)
      return {
        provider: "gemini",
        apiKey: key,
        model: model.startsWith("gemini") ? model : DEFAULT_GEMINI_IMAGE_MODEL,
        quality,
        byo: false,
      };
    if (provider === "gemini") return null;
  }
  if (provider === "auto" || provider === "custom") {
    const [key, url] = await Promise.all([resolveApiKey("custom"), getSystemSetting("custom_provider_url")]);
    const baseUrl = customBaseUrl(url || "");
    if (key && baseUrl)
      return {
        provider: "custom",
        apiKey: key,
        baseUrl,
        model: model.startsWith("gpt-image") ? model : DEFAULT_CUSTOM_IMAGE_MODEL,
        quality,
        byo: false,
      };
  }
  return null;
}

export class IllustrationError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
  }
}

function base64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(Buffer.from(b64, "base64"));
}

async function errorMessage(res: Response): Promise<string> {
  const body = await res.json().catch(() => null);
  const msg = body?.error?.message || body?.error || `HTTP ${res.status}`;
  return String(msg).slice(0, 300);
}

/** Generate one 3:2 page picture → image bytes + MIME type. */
export async function generateIllustration(
  target: IllustrationTarget,
  prompt: string,
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>,
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  if (target.provider === "custom") return generateViaGateway(target, prompt, fetchImpl);
  if (target.provider === "openai") {
    const doFetch =
      fetchImpl ?? meteredFetch({ provider: "openai", model: `${target.model}.${target.quality}.1536x1024`, kind: "image", units: 1 });
    const res = await doFetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${target.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: target.model,
        prompt,
        n: 1,
        size: "1536x1024",
        quality: target.quality,
        output_format: "webp",
        output_compression: 80,
      }),
      signal: AbortSignal.timeout(120_000),
      redirect: "error",
    });
    if (!res.ok) throw new IllustrationError(await errorMessage(res), res.status === 429 ? 429 : 502);
    const json = await res.json();
    const b64 = json?.data?.[0]?.b64_json;
    if (typeof b64 !== "string" || !b64) throw new IllustrationError("Không nhận được ảnh");
    return { bytes: base64ToBytes(b64), mimeType: "image/webp" };
  }
  const doFetch = fetchImpl ?? meteredFetch({ provider: "gemini", model: target.model, kind: "image", units: 1 });
  const res = await doFetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(target.model)}:generateContent`,
    {
      method: "POST",
      headers: { "x-goog-api-key": target.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "3:2" } },
      }),
      signal: AbortSignal.timeout(120_000),
      redirect: "error",
    },
  );
  if (!res.ok) throw new IllustrationError(await errorMessage(res), res.status === 429 ? 429 : 502);
  const json = await res.json();
  const parts: { inlineData?: { mimeType?: string; data?: string }; inline_data?: { mime_type?: string; data?: string } }[] =
    json?.candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    const data = part.inlineData?.data ?? part.inline_data?.data;
    const mime = part.inlineData?.mimeType ?? part.inline_data?.mime_type ?? "image/png";
    if (data && mime.startsWith("image/")) return { bytes: base64ToBytes(data), mimeType: mime };
  }
  throw new IllustrationError("Không nhận được ảnh");
}

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

/**
 * OpenAI-compatible gateway (Images API). Gateways differ on optional fields
 * (CometAPI rejects output_format "webp"), so only the common ones are sent and
 * the PNG/JPEG result is re-encoded here to a ~1200px WebP for the book.
 */
async function generateViaGateway(
  target: IllustrationTarget,
  prompt: string,
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>,
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  if (!target.baseUrl) throw new IllustrationError("Chưa cấu hình địa chỉ nhà cung cấp tuỳ chỉnh", 503);
  const doFetch =
    fetchImpl ?? meteredFetch({ provider: "custom", model: `${target.model}.${target.quality}.1536x1024`, kind: "image", units: 1 });
  const res = await doFetch(`${target.baseUrl}/images/generations`, {
    method: "POST",
    headers: { Authorization: `Bearer ${target.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: target.model, prompt, n: 1, size: "1536x1024", quality: target.quality }),
    signal: AbortSignal.timeout(120_000),
    redirect: "error",
  });
  if (!res.ok) throw new IllustrationError(await errorMessage(res), res.status === 429 ? 429 : 502);
  const json = await res.json();
  const item = json?.data?.[0];
  let raw: Uint8Array | null = null;
  if (typeof item?.b64_json === "string" && item.b64_json) raw = base64ToBytes(item.b64_json);
  else if (typeof item?.url === "string" && /^https:\/\//.test(item.url)) {
    const img = await (fetchImpl ?? fetch)(item.url, { signal: AbortSignal.timeout(60_000) });
    if (!img.ok || !(img.headers.get("content-type") ?? "").startsWith("image/"))
      throw new IllustrationError("Không tải được ảnh");
    if (Number(img.headers.get("content-length") ?? 0) > MAX_IMAGE_BYTES) throw new IllustrationError("Ảnh quá lớn");
    raw = new Uint8Array(await img.arrayBuffer());
  }
  if (!raw?.length) throw new IllustrationError("Không nhận được ảnh");
  if (raw.length > MAX_IMAGE_BYTES) throw new IllustrationError("Ảnh quá lớn");
  return { bytes: await toBookWebp(raw), mimeType: "image/webp" };
}

/** Decode → strip metadata → ≤1200px wide WebP (≈40–80 KB instead of ~2 MB PNG). */
async function toBookWebp(raw: Uint8Array): Promise<Uint8Array> {
  const { default: sharp } = await import("sharp");
  try {
    const out = await sharp(raw, { limitInputPixels: 4096 * 4096 })
      .rotate()
      .resize({ width: 1200, withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
    return new Uint8Array(out);
  } catch {
    throw new IllustrationError("Ảnh trả về không hợp lệ");
  }
}

const EXT: Record<string, string> = { "image/webp": "webp", "image/png": "png", "image/jpeg": "jpg" };

/** Upload to `illustrations/<uid>/<story>/p<n>-<random>.<ext>` and return the public URL. */
export async function uploadIllustration(
  supabase: SupabaseClient,
  userId: string,
  storyId: string,
  pageNumber: number,
  image: { bytes: Uint8Array; mimeType: string },
): Promise<string> {
  const ext = EXT[image.mimeType] ?? "png";
  const path = `${userId}/${storyId}/p${pageNumber}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
  const { error } = await supabase.storage
    .from("illustrations")
    .upload(path, image.bytes, { contentType: image.mimeType, upsert: false, cacheControl: "31536000" });
  if (error) throw new IllustrationError(`Không lưu được ảnh: ${error.message}`, 500);
  return supabase.storage.from("illustrations").getPublicUrl(path).data.publicUrl;
}
