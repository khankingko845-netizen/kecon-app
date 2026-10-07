/**
 * Fish Audio (https://fish.audio) — text-to-speech + account credit.
 * Docs: https://docs.fish.audio/api-reference/endpoint/openapi-v1/text-to-speech
 *
 * Auth: `Authorization: Bearer <key>`; the TTS model goes in the `model` header.
 * Errors: 401 key sai · 402 hết credit · 403/404 giọng không thuộc key này ·
 * 429 quá số request đồng thời · 5xx lỗi máy chủ (→ src/lib/key-pool.ts).
 * Every failure is thrown as a {@link ProviderHttpError}.
 */
import { ProviderHttpError, providerHttpError } from "@/lib/provider-keys";
import { stripEmotionTags } from "@/lib/elevenlabs";

export const FISH_MODELS = [
  { id: "s2.1-pro", name: "S2.1 Pro (khuyên dùng)" },
  {
    id: "s2.1-pro-free",
    name: "S2.1 Pro Free (miễn phí, không cam kết độ trễ)",
  },
  { id: "s2-pro", name: "S2 Pro (đời trước)" },
  { id: "s1", name: "S1 (đời cũ)" },
] as const;
export const DEFAULT_FISH_MODEL = "s2.1-pro";

export function isFreeFishModel(model: string): boolean {
  return model.endsWith("-free");
}

function fishBase(): string {
  return (process.env.FISH_AUDIO_API_BASE || "https://api.fish.audio").replace(
    /\/+$/,
    "",
  );
}

const TIMEOUT_MS = 60_000;

async function fishFetch(
  path: string,
  apiKey: string,
  init: RequestInit = {},
  what = "lỗi",
  fetchImpl: (input: string, init?: RequestInit) => Promise<Response> = fetch,
): Promise<Response> {
  let res: Response;
  try {
    res = await fetchImpl(`${fishBase()}${path}`, {
      ...init,
      redirect: "error",
      signal: init.signal ?? AbortSignal.timeout(TIMEOUT_MS),
      headers: { Authorization: `Bearer ${apiKey}`, ...(init.headers ?? {}) },
    });
  } catch (err) {
    if (err instanceof Error && err.name === "MeteringUnavailableError")
      throw err;
    throw new ProviderHttpError(
      "fishaudio",
      0,
      "network",
      `Fish Audio không phản hồi (${err instanceof Error ? err.name : "lỗi mạng"})`,
    );
  }
  if (!res.ok) throw await providerHttpError("fishaudio", res, what);
  return res;
}

/** Speak `text` with the Fish Audio voice model `referenceId` → MP3. */
export async function fishTextToSpeech(
  apiKey: string,
  referenceId: string,
  text: string,
  opts: {
    model?: string;
    fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
  } = {},
): Promise<Blob> {
  const res = await fishFetch(
    "/v1/tts",
    apiKey,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        model: opts.model || DEFAULT_FISH_MODEL,
      },
      body: JSON.stringify({
        text: stripEmotionTags(text),
        reference_id: referenceId,
        format: "mp3",
        mp3_bitrate: 128,
        normalize: true,
        latency: "normal",
      }),
    },
    "TTS lỗi",
    opts.fetchImpl,
  );
  return new Blob([await res.arrayBuffer()], { type: "audio/mpeg" });
}

/** API credit balance (USD) of the account that owns the key. */
export async function fishGetCredit(
  apiKey: string,
): Promise<{ balance: number; hasFreeCredit: boolean }> {
  const res = await fishFetch(
    "/wallet/self/api-credit",
    apiKey,
    {},
    "kiểm tra credit lỗi",
  );
  const body = (await res.json().catch(() => ({}))) as {
    credit?: string | number;
    has_free_credit?: boolean | null;
  };
  const balance = Number(body.credit ?? 0);
  return {
    balance: Number.isFinite(balance) ? balance : 0,
    hasFreeCredit: Boolean(body.has_free_credit),
  };
}

export interface FishVoiceModel {
  id: string;
  title: string;
  languages: string[];
  visibility: string | null;
  cover_image: string | null;
}

/** Look up a voice model (public, or private to the key's account). */
export async function fishGetModel(
  apiKey: string,
  referenceId: string,
): Promise<FishVoiceModel> {
  const res = await fishFetch(
    `/model/${encodeURIComponent(referenceId)}`,
    apiKey,
    {},
    "tra cứu giọng lỗi",
  );
  const m = (await res.json().catch(() => ({}))) as {
    _id?: string;
    title?: string;
    languages?: string[];
    visibility?: string;
    cover_image?: string;
  };
  return {
    id: m._id || referenceId,
    title: m.title || referenceId,
    languages: Array.isArray(m.languages) ? m.languages : [],
    visibility: m.visibility ?? null,
    cover_image: m.cover_image ?? null,
  };
}
