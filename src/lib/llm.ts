/**
 * Shared LLM provider adapter (T04).
 *
 * One place that knows how to talk to OpenAI, OpenAI-compatible ("custom"),
 * Google Gemini and Anthropic. API routes build a prompt and call `callLlm()`;
 * they never construct provider URLs or auth headers themselves.
 *
 * - API keys are always sent in headers (never in the URL / query string).
 * - Custom base URLs never follow redirects (SSRF hardening).
 * - Token usage is returned so callers can record cost (T07).
 * - `fetchImpl` is injectable so tests can use a fake adapter.
 */

export const LLM_PROVIDERS = ["openai", "gemini", "anthropic", "custom"] as const;
export type LlmProvider = (typeof LLM_PROVIDERS)[number];

export function isLlmProvider(value: unknown): value is LlmProvider {
  return typeof value === "string" && (LLM_PROVIDERS as readonly string[]).includes(value);
}

export const OPENAI_BASE_URL = "https://api.openai.com/v1";
export const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
export const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
export const ANTHROPIC_VERSION = "2023-06-01";

const DEFAULT_TIMEOUT_MS = 90_000;
const DEFAULT_ANTHROPIC_MAX_TOKENS = 4096;

export interface LlmImage {
  /** Base64 payload or a full `data:image/...;base64,` URL. */
  data: string;
  /** Used when `data` is raw base64. Defaults to image/png. */
  mimeType?: string;
}

export interface LlmTarget {
  provider: LlmProvider;
  apiKey: string;
  model: string;
  /** Required for `custom`; ignored for other providers. */
  baseUrl?: string;
}

export interface LlmRequest extends LlmTarget {
  system?: string;
  prompt: string;
  images?: LlmImage[];
  /** OpenAI vision detail level. */
  imageDetail?: "low" | "high" | "auto";
  temperature?: number;
  maxTokens?: number;
  /** Ask the provider for a JSON object response. */
  json?: boolean;
  timeoutMs?: number;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface LlmResult {
  text: string;
  usage: LlmUsage | null;
  provider: LlmProvider;
  model: string;
}

export class LlmError extends Error {
  readonly status?: number;
  readonly provider?: LlmProvider;
  constructor(message: string, opts: { status?: number; provider?: LlmProvider } = {}) {
    super(message);
    this.name = "LlmError";
    this.status = opts.status;
    this.provider = opts.provider;
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const DATA_URL_RE = /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]*)$/i;

/** Split an image into mime type + raw base64 (accepts data URLs or raw base64). */
export function normalizeImage(image: LlmImage): { mimeType: string; base64: string } {
  const match = image.data.match(DATA_URL_RE);
  if (match) return { mimeType: match[1].toLowerCase(), base64: match[2] };
  return { mimeType: image.mimeType ?? "image/png", base64: image.data };
}

function trimBase(url: string): string {
  return url.replace(/\/+$/, "");
}

async function readProviderError(res: Response, provider: LlmProvider): Promise<LlmError> {
  const body = (await res.json().catch(() => null)) as { error?: { message?: string } | string } | null;
  const message =
    (typeof body?.error === "string" ? body.error : body?.error?.message) || `${provider} error: ${res.status}`;
  return new LlmError(message, { status: res.status, provider });
}

function buildOpenAI(req: LlmRequest): { url: string; init: RequestInit } {
  const base = req.provider === "custom" ? req.baseUrl : OPENAI_BASE_URL;
  if (!base) throw new LlmError("Thiếu Base URL cho custom provider", { provider: req.provider });

  const userContent = req.images?.length
    ? [
        { type: "text", text: req.prompt },
        ...req.images.map((img) => {
          const { mimeType, base64 } = normalizeImage(img);
          return {
            type: "image_url",
            image_url: { url: `data:${mimeType};base64,${base64}`, detail: req.imageDetail ?? "auto" },
          };
        }),
      ]
    : req.prompt;

  const messages: Array<{ role: string; content: unknown }> = [];
  if (req.system) messages.push({ role: "system", content: req.system });
  messages.push({ role: "user", content: userContent });

  return {
    url: `${trimBase(base)}/chat/completions`,
    init: {
      method: "POST",
      redirect: "error", // never follow redirects (custom base URLs → SSRF)
      headers: { Authorization: `Bearer ${req.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: req.model,
        messages,
        ...(req.temperature !== undefined && { temperature: req.temperature }),
        ...(req.maxTokens !== undefined && { max_tokens: req.maxTokens }),
        ...(req.json && { response_format: { type: "json_object" } }),
      }),
    },
  };
}

function buildGemini(req: LlmRequest): { url: string; init: RequestInit } {
  const parts: unknown[] = [{ text: req.prompt }];
  for (const img of req.images ?? []) {
    const { mimeType, base64 } = normalizeImage(img);
    parts.push({ inline_data: { mime_type: mimeType, data: base64 } });
  }
  const generationConfig: Record<string, unknown> = {};
  if (req.temperature !== undefined) generationConfig.temperature = req.temperature;
  if (req.maxTokens !== undefined) generationConfig.maxOutputTokens = req.maxTokens;
  if (req.json) generationConfig.responseMimeType = "application/json";

  return {
    url: `${GEMINI_BASE_URL}/models/${encodeURIComponent(req.model)}:generateContent`,
    init: {
      method: "POST",
      redirect: "error",
      // Key goes in a header, never in `?key=` (URLs end up in logs/proxies).
      headers: { "x-goog-api-key": req.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(req.system && { system_instruction: { parts: [{ text: req.system }] } }),
        contents: [{ role: "user", parts }],
        generationConfig,
      }),
    },
  };
}

function buildAnthropic(req: LlmRequest): { url: string; init: RequestInit } {
  const content: unknown[] = (req.images ?? []).map((img) => {
    const { mimeType, base64 } = normalizeImage(img);
    return { type: "image", source: { type: "base64", media_type: mimeType, data: base64 } };
  });
  content.push({ type: "text", text: req.prompt });

  return {
    url: ANTHROPIC_MESSAGES_URL,
    init: {
      method: "POST",
      redirect: "error",
      headers: {
        "x-api-key": req.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: req.model,
        max_tokens: req.maxTokens ?? DEFAULT_ANTHROPIC_MAX_TOKENS,
        ...(req.system && { system: req.system }),
        ...(req.temperature !== undefined && { temperature: req.temperature }),
        messages: [{ role: "user", content }],
      }),
    },
  };
}

/** Build the HTTP request for a provider (exported for tests). */
export function buildLlmHttpRequest(req: LlmRequest): { url: string; init: RequestInit } {
  switch (req.provider) {
    case "openai":
    case "custom":
      return buildOpenAI(req);
    case "gemini":
      return buildGemini(req);
    case "anthropic":
      return buildAnthropic(req);
    default:
      throw new LlmError(`Provider không được hỗ trợ: ${String((req as { provider: unknown }).provider)}`);
  }
}

interface OpenAIResponse {
  choices?: Array<{ message?: { content?: unknown } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}
interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}
interface AnthropicResponse {
  content?: Array<{ type?: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

function usageOf(input?: number, output?: number): LlmUsage | null {
  if (input === undefined && output === undefined) return null;
  return { inputTokens: input ?? 0, outputTokens: output ?? 0 };
}

/** Extract text + usage from a provider response body (exported for tests). */
export function parseLlmResponse(provider: LlmProvider, data: unknown): { text: string; usage: LlmUsage | null } {
  let text: unknown;
  let usage: LlmUsage | null = null;

  if (provider === "gemini") {
    const d = data as GeminiResponse;
    text = d.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("");
    usage = usageOf(d.usageMetadata?.promptTokenCount, d.usageMetadata?.candidatesTokenCount);
  } else if (provider === "anthropic") {
    const d = data as AnthropicResponse;
    text = d.content?.filter((c) => c.type === undefined || c.type === "text").map((c) => c.text ?? "").join("");
    usage = usageOf(d.usage?.input_tokens, d.usage?.output_tokens);
  } else {
    const d = data as OpenAIResponse;
    text = d.choices?.[0]?.message?.content;
    usage = usageOf(d.usage?.prompt_tokens, d.usage?.completion_tokens);
  }

  if (typeof text !== "string" || text.length === 0) {
    throw new LlmError("Provider trả về định dạng không hợp lệ", { provider });
  }
  return { text, usage };
}

/** Call an LLM provider and return its text output. */
export async function callLlm(req: LlmRequest, fetchImpl: FetchLike = fetch): Promise<LlmResult> {
  const { url, init } = buildLlmHttpRequest(req);
  let res: Response;
  try {
    res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(req.timeoutMs ?? DEFAULT_TIMEOUT_MS) });
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    throw new LlmError(timedOut ? "AI phản hồi quá lâu, vui lòng thử lại" : "Không kết nối được tới AI provider", {
      provider: req.provider,
    });
  }
  if (!res.ok) throw await readProviderError(res, req.provider);

  const data = await res.json().catch(() => {
    throw new LlmError("Provider trả về dữ liệu không phải JSON", { provider: req.provider });
  });
  const { text, usage } = parseLlmResponse(req.provider, data);
  return { text, usage, provider: req.provider, model: req.model };
}

/**
 * Pull the first JSON object out of a model reply (tolerates markdown fences
 * or chatter around it) and parse it.
 */
export function extractJsonObject(raw: string): unknown {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) throw new LlmError("AI không trả về JSON hợp lệ");
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    throw new LlmError("AI không trả về JSON hợp lệ");
  }
}

/** Convenience: call the model and parse its JSON object reply. */
export async function callLlmJson(
  req: LlmRequest,
  fetchImpl: FetchLike = fetch
): Promise<{ data: unknown; result: LlmResult }> {
  const result = await callLlm({ ...req, json: req.json ?? true }, fetchImpl);
  return { data: extractJsonObject(result.text), result };
}

// ── Model catalogue (also used by the settings UI) ─────────────────────────

export const PROVIDER_MODELS: Record<LlmProvider, { label: string; models: { id: string; name: string }[] }> = {
  openai: {
    label: "OpenAI",
    models: [
      { id: "gpt-4o-mini", name: "GPT-4o Mini (nhanh, rẻ)" },
      { id: "gpt-4o", name: "GPT-4o (chất lượng cao)" },
      { id: "gpt-4.1-mini", name: "GPT-4.1 Mini" },
      { id: "gpt-4.1", name: "GPT-4.1" },
    ],
  },
  gemini: {
    label: "Google Gemini",
    models: [
      { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash (nhanh)" },
      { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
      { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
    ],
  },
  anthropic: {
    label: "Anthropic Claude",
    models: [
      { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4" },
      { id: "claude-3-5-haiku-20241022", name: "Claude 3.5 Haiku (nhanh)" },
    ],
  },
  custom: {
    label: "Custom",
    models: [],
  },
};

export function isCatalogModel(provider: LlmProvider, model: string): boolean {
  return PROVIDER_MODELS[provider].models.some((m) => m.id === model);
}
