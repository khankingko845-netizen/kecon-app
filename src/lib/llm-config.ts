/**
 * Server-side resolution of "which provider/model/key/base URL should this
 * request use" (T04). Shared by every AI route so the rules live in one place:
 *
 * - BYO key (client supplied its own key): the client's provider, model and
 *   base URL are honoured — the user pays for it.
 * - Platform key: provider comes from the admin setting `default_ai_provider`
 *   (Cài Đặt Hệ Thống → "AI Provider"; legacy name `default_story_provider` is
 *   still read as a fallback); the client may only pick a model from the
 *   provider's catalogue (otherwise the admin default is used), so nobody can
 *   spend the platform key on an arbitrary/expensive model or host.
 */
import {
  isCatalogModel,
  isLlmProvider,
  PROVIDER_MODELS,
  type LlmProvider,
  type LlmTarget,
} from "@/lib/llm";
import { getSystemSetting, resolveApiKey, resolveCustomBaseUrl } from "@/lib/server-settings";

export interface LlmSelection {
  provider?: string | null;
  model?: string | null;
  apiKey?: string | null;
  baseUrl?: string | null;
}

export type ResolvedLlm =
  | { ok: true; target: LlmTarget; byo: boolean }
  | { ok: false; response: Response };

const FALLBACK_PROVIDER: LlmProvider = "openai";
const FALLBACK_MODEL = "gpt-4o-mini";

/** Default model for a provider given the admin's `default_ai_model`. */
export function defaultModelFor(
  provider: LlmProvider,
  adminDefaultModel: string,
  adminDefaultProvider: LlmProvider
): string {
  if (adminDefaultModel && (provider === adminDefaultProvider || isCatalogModel(provider, adminDefaultModel))) {
    return adminDefaultModel;
  }
  return PROVIDER_MODELS[provider].models[0]?.id ?? (adminDefaultModel || FALLBACK_MODEL);
}

export async function resolveLlmTarget(selection: LlmSelection = {}): Promise<ResolvedLlm> {
  const userKey = selection.apiKey?.trim() || undefined;
  const byo = Boolean(userKey);

  // The admin screen saves `default_ai_provider` (migration 007). Older code read
  // `default_story_provider`, which no migration creates → the admin's choice was ignored.
  const adminProviderRaw = (await getSystemSetting("default_ai_provider")) || (await getSystemSetting("default_story_provider"));
  const adminProvider: LlmProvider = isLlmProvider(adminProviderRaw) ? adminProviderRaw : FALLBACK_PROVIDER;
  const adminModel = await getSystemSetting("default_ai_model");

  let provider: LlmProvider = adminProvider;
  if (byo && selection.provider) {
    if (!isLlmProvider(selection.provider)) {
      return {
        ok: false,
        response: Response.json({ error: `Provider không được hỗ trợ: ${selection.provider}` }, { status: 400 }),
      };
    }
    provider = selection.provider;
  }

  const fallbackModel = defaultModelFor(provider, adminModel, adminProvider);
  const requested = selection.model?.trim();
  const model = requested && (byo || requested === fallbackModel || isCatalogModel(provider, requested))
    ? requested
    : fallbackModel;

  const apiKey = await resolveApiKey(provider, userKey);
  if (!apiKey) {
    return {
      ok: false,
      response: Response.json(
        { error: `Chưa cấu hình API key cho ${provider}. Admin cần thêm key trong Cài Đặt Hệ Thống.` },
        { status: 400 }
      ),
    };
  }

  let baseUrl: string | undefined;
  if (provider === "custom") {
    // Client URL is honoured only together with the client's own key.
    baseUrl = (await resolveCustomBaseUrl(selection.baseUrl ?? undefined, userKey)) || undefined;
    if (!baseUrl) {
      return {
        ok: false,
        response: Response.json(
          { error: "Custom provider cần Base URL hợp lệ (OpenAI-compatible, không trỏ tới địa chỉ nội bộ)" },
          { status: 400 }
        ),
      };
    }
  }

  return { ok: true, target: { provider, model, apiKey, baseUrl }, byo };
}
