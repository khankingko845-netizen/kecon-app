import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/admin-permissions";
import { auditAdmin } from "@/lib/admin-audit";
import { getSystemSetting, isSafePublicBaseUrl, resolveApiKey } from "@/lib/server-settings";
import { voiceKeyPool } from "@/lib/key-pool";
import { fetchVoiceCatalog } from "@/lib/voice-catalog";
import { elevenLabsBase } from "@/lib/elevenlabs";
import { fishGetModel } from "@/lib/fishaudio";
import { FISH_VOICE_PREFIX, isFishVoiceId, providerVoiceRef } from "@/lib/provider-keys";
import { scrubSecret } from "@/lib/system-secrets";
import { GEMINI_BASE_URL } from "@/lib/llm";
import { z } from "zod";
import { optionalText, parseJsonBody } from "@/lib/api-validation";

const TestProviderBody = z.object({
  provider: z.enum(["openai", "dalle", "gemini", "anthropic", "elevenlabs", "custom"]),
  /** A-04: omit to test the key already stored in Vault (it never leaves the server). */
  apiKey: optionalText(512),
  baseUrl: optionalText(2048).pipe(z.url().optional()),
});

const PROVIDER_LABEL: Record<z.infer<typeof TestProviderBody>["provider"], string> = {
  openai: "OpenAI",
  dalle: "DALL·E",
  gemini: "Gemini",
  anthropic: "Claude",
  elevenlabs: "ElevenLabs",
  custom: "Custom",
};

/** The key the platform would really use for this provider (Vault → env), like the generation routes. */
async function storedKey(provider: z.infer<typeof TestProviderBody>["provider"]): Promise<string> {
  // A-04b: ElevenLabs keys live in the rotating pool.
  if (provider === "elevenlabs") return voiceKeyPool.pickSecret("elevenlabs");
  if (provider === "dalle") return (await resolveApiKey("dalle")) || (await resolveApiKey("openai"));
  return resolveApiKey(provider);
}

/**
 * GET /api/admin/test-provider?voice_id=xxx
 * Looks up a voice by ID from ElevenLabs (or `fish:<id>` from Fish Audio). Uses a key of the system pool.
 * Returns: { ok, voice: { voice_id, name, language, category, preview_url } }
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  // A-02: permission check shared with RLS (has_permission).
  const denied = await requirePermission(supabase, "voices.manage");
  if (denied) return denied;

  const voiceId = request.nextUrl.searchParams.get("voice_id");
  if (!voiceId) {
    return Response.json({ error: "voice_id required" }, { status: 400 });
  }
  // A-03: log before spending the system ElevenLabs key.
  const auditFailed = await auditAdmin(supabase, request, { action: "voice.lookup", targetType: "voice", targetId: voiceId.slice(0, 100) });
  if (auditFailed) return auditFailed;

  // A-04b: Fish Audio voice model (`fish:<reference_id>`).
  if (isFishVoiceId(voiceId)) {
    const fishKey = await voiceKeyPool.pickSecret("fishaudio");
    if (!fishKey) return Response.json({ ok: false, error: "Fish Audio API key chưa được cài đặt" }, { status: 200 });
    try {
      const m = await fishGetModel(fishKey, providerVoiceRef(voiceId));
      return Response.json({
        ok: true,
        voice: {
          voice_id: `${FISH_VOICE_PREFIX}${m.id}`,
          name: m.title,
          language: m.languages[0] || "",
          category: m.visibility === "private" ? "fish (riêng)" : "fish",
          preview_url: null,
          gender: null,
        },
      });
    } catch (err) {
      return Response.json({ ok: false, error: err instanceof Error ? scrubSecret(err.message, fishKey) : "Lookup failed" });
    }
  }

  // A-04b: a key of the ElevenLabs pool.
  const apiKey = await voiceKeyPool.pickSecret("elevenlabs");
  if (!apiKey) {
    return Response.json(
      { ok: false, error: "ElevenLabs API key chưa được cài đặt" },
      { status: 200 }
    );
  }

  try {
    // Try fetching the voice directly (works for own voices + added from library)
    const res = await fetch(`${elevenLabsBase()}/voices/${encodeURIComponent(voiceId)}`, {
      headers: { "xi-api-key": apiKey },
    });

    if (res.ok) {
      const v = await res.json() as {
        voice_id: string;
        name: string;
        category: string;
        labels?: Record<string, string>;
        preview_url?: string;
      };
      return Response.json({
        ok: true,
        voice: {
          voice_id: v.voice_id,
          name: v.name,
          language: v.labels?.language || "",
          category: v.category,
          preview_url: v.preview_url || null,
          gender: v.labels?.gender || null,
        },
      });
    }

    // If not found in own voices, try the shared voice library
    if (res.status === 400 || res.status === 404 || res.status === 422) {
      // Search shared voices by voice_id (use search= not voice_id= param)
      const sharedRes = await fetch(
        `${elevenLabsBase()}/shared-voices?search=${encodeURIComponent(voiceId)}&page_size=5`,
        { headers: { "xi-api-key": apiKey } }
      );
      if (sharedRes.ok) {
        const sharedData = await sharedRes.json();
        const voices = sharedData.voices as {
          voice_id: string;
          name: string;
          category: string;
          accent?: string;
          gender?: string;
          language?: string;
          preview_url?: string;
        }[];
        // Find exact match by voice_id (search can return partial matches)
        const exactMatch = voices?.find((v: { voice_id: string }) => v.voice_id === voiceId);
        if (exactMatch) {
          const sv = exactMatch;
          return Response.json({
            ok: true,
            voice: {
              voice_id: sv.voice_id,
              name: `${sv.name}${sv.accent ? ` (${sv.accent})` : ""}`,
              language: sv.language || "",
              category: sv.category || "library",
              preview_url: sv.preview_url || null,
              gender: sv.gender || null,
            },
          });
        }
      }
    }

    return Response.json({
      ok: false,
      error: `Không tìm thấy voice ID "${voiceId}"`,
    });
  } catch (err) {
    return Response.json({
      ok: false,
      error: err instanceof Error ? scrubSecret(err.message, apiKey) : "Lookup failed",
    });
  }
}

/**
 * POST /api/admin/test-provider
 * Tests an API key + fetches available models from a provider — server side.
 * Body: { provider, apiKey?, baseUrl? }
 *  - apiKey given: test that (newly typed) key; custom → the given baseUrl.
 *  - apiKey omitted (A-04): test the stored key; custom → the SAVED base URL
 *    only, so a stored key can never be sent to a host chosen by the browser.
 * Returns: { ok, models?, voices?, error? } — never the key (errors are scrubbed).
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  // A-02: permission check shared with RLS (has_permission).
  const denied = await requirePermission(supabase, "secrets.manage");
  if (denied) return denied;

  const parsed = await parseJsonBody(request, TestProviderBody);
  if (!parsed.ok) return parsed.response;
  const { provider } = parsed.data;
  const usingStored = !parsed.data.apiKey;
  const baseUrl = usingStored
    ? provider === "custom" ? (await getSystemSetting("custom_provider_url")) || undefined : undefined
    : parsed.data.baseUrl;
  // A-03: the key itself is never logged — only which provider / host / key source was tried.
  const auditFailed = await auditAdmin(supabase, request, {
    action: "provider.test",
    targetType: "provider",
    targetId: provider,
    after: { host: baseUrl ? safeHost(baseUrl) : null, key_source: usingStored ? "stored" : "typed" },
  });
  if (auditFailed) return auditFailed;

  const apiKey = parsed.data.apiKey ?? (await storedKey(provider));
  if (!apiKey) {
    return Response.json({ ok: false, error: `Chưa đặt API key ${PROVIDER_LABEL[provider]}` }, { status: 200 });
  }

  try {
    switch (provider) {
      case "openai":
      case "dalle": {
        const res = await fetch("https://api.openai.com/v1/models", {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(
            err.error?.message || `OpenAI returned ${res.status}`
          );
        }
        const data = await res.json();
        // Filter for chat models (gpt-*) and sort by name
        const models = (data.data as { id: string }[])
          .map((m) => m.id)
          .filter(
            (id) =>
              id.includes("gpt") ||
              id.includes("o1") ||
              id.includes("o3") ||
              id.includes("o4")
          )
          .sort();
        return Response.json({ ok: true, models });
      }

      case "gemini": {
        const res = await fetch(`${GEMINI_BASE_URL}/models`, {
          headers: { "x-goog-api-key": apiKey },
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(
            err.error?.message || `Gemini returned ${res.status}`
          );
        }
        const data = await res.json();
        const models = (
          data.models as {
            name: string;
            supportedGenerationMethods?: string[];
          }[]
        )
          .filter((m) =>
            m.supportedGenerationMethods?.includes("generateContent")
          )
          .map((m) => m.name.replace("models/", ""))
          .filter(
            (id) => id.includes("gemini") || id.includes("learnlm")
          )
          .sort();
        return Response.json({ ok: true, models });
      }

      case "anthropic": {
        // Anthropic doesn't have a models list endpoint.
        // Verify key by calling messages with max_tokens=1.
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-20250514",
            max_tokens: 1,
            messages: [{ role: "user", content: "hi" }],
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          // 400 with overloaded/rate limit still means key is valid
          if (res.status === 529 || res.status === 429) {
            // Key works but rate limited
          } else {
            throw new Error(
              err.error?.message || `Anthropic returned ${res.status}`
            );
          }
        }
        // Return known Anthropic models
        const models = [
          "claude-sonnet-4-20250514",
          "claude-3-7-sonnet-20250219",
          "claude-3-5-sonnet-20241022",
          "claude-3-5-haiku-20241022",
          "claude-3-haiku-20240307",
        ];
        return Response.json({ ok: true, models });
      }

      case "elevenlabs": {
        return Response.json({ ok: true, ...(await fetchVoiceCatalog(apiKey)) });
      }

      case "custom": {
        if (!baseUrl) {
          throw new Error(usingStored ? "Chưa lưu Base URL cho Custom provider" : "Base URL required for custom provider");
        }
        if (!(await isSafePublicBaseUrl(baseUrl))) {
          throw new Error("Base URL không hợp lệ hoặc trỏ tới địa chỉ nội bộ");
        }
        const url = baseUrl.replace(/\/+$/, "") + "/models";
        const res = await fetch(url, {
          redirect: "error",
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (!res.ok) {
          throw new Error(`Custom provider returned ${res.status}`);
        }
        const data = await res.json();
        const models = (data.data as { id: string }[])
          .map((m) => m.id)
          .sort();
        return Response.json({ ok: true, models });
      }

      default:
        return Response.json(
          { error: `Unknown provider: ${provider}` },
          { status: 400 }
        );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Connection failed";
    // A-04: providers sometimes echo (part of) the key — scrub before it reaches the browser.
    return Response.json({ ok: false, error: scrubSecret(message, apiKey) }, { status: 200 });
  }
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}
