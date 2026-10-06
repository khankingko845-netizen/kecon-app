import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/admin-permissions";
import { auditAdmin } from "@/lib/admin-audit";
import { getSystemSetting, isSafePublicBaseUrl } from "@/lib/server-settings";
import { GEMINI_BASE_URL } from "@/lib/llm";
import { z } from "zod";
import { optionalText, parseJsonBody, requiredText } from "@/lib/api-validation";

const TestProviderBody = z.object({
  provider: z.enum(["openai", "dalle", "gemini", "anthropic", "elevenlabs", "custom"]),
  apiKey: requiredText(512),
  baseUrl: optionalText(2048).pipe(z.url().optional()),
});

/**
 * GET /api/admin/test-provider?voice_id=xxx
 * Looks up a voice by ID from ElevenLabs. Uses system API key.
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

  // Get ElevenLabs API key from system settings
  const apiKey = await getSystemSetting("elevenlabs_api_key");
  if (!apiKey) {
    return Response.json(
      { ok: false, error: "ElevenLabs API key chưa được cài đặt" },
      { status: 200 }
    );
  }

  try {
    // Try fetching the voice directly (works for own voices + added from library)
    const res = await fetch(`https://api.elevenlabs.io/v1/voices/${voiceId}`, {
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
        `https://api.elevenlabs.io/v1/shared-voices?search=${voiceId}&page_size=5`,
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
      error: err instanceof Error ? err.message : "Lookup failed",
    });
  }
}

/**
 * POST /api/admin/test-provider
 * Tests an API key + fetches available models from a provider.
 * Body: { provider, apiKey, baseUrl? }
 * Returns: { ok, models?, voices?, error? }
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  // A-02: permission check shared with RLS (has_permission).
  const denied = await requirePermission(supabase, "secrets.manage");
  if (denied) return denied;

  const parsed = await parseJsonBody(request, TestProviderBody);
  if (!parsed.ok) return parsed.response;
  const { provider, apiKey, baseUrl } = parsed.data;
  // A-03: the key itself is never logged — only which provider / host was tried.
  const auditFailed = await auditAdmin(supabase, request, {
    action: "provider.test",
    targetType: "provider",
    targetId: provider,
    after: { host: baseUrl ? new URL(baseUrl).host : null },
  });
  if (auditFailed) return auditFailed;

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
        // 1. Fetch user's own voices (cloned + added)
        const ownRes = await fetch("https://api.elevenlabs.io/v1/voices", {
          headers: { "xi-api-key": apiKey },
        });
        if (!ownRes.ok) {
          throw new Error(`ElevenLabs returned ${ownRes.status}`);
        }
        const ownData = await ownRes.json();
        const ownVoices = (
          ownData.voices as {
            voice_id: string;
            name: string;
            category: string;
            labels: Record<string, string>;
          }[]
        ).map((v) => ({
          voice_id: v.voice_id,
          name: v.name,
          category: v.category,
          language: v.labels?.language || "",
          source: "own" as const,
        }));

        // 2. Search shared voice library for each target language
        const targetLanguages = [
          { code: "vi", label: "Vietnamese" },
          { code: "en", label: "English" },
          { code: "ja", label: "Japanese" },
        ];

        const libraryVoices: {
          voice_id: string;
          name: string;
          category: string;
          language: string;
          source: "library";
          public_owner_id: string;
        }[] = [];

        await Promise.all(
          targetLanguages.map(async ({ code, label }) => {
            try {
              const searchUrl = new URL(
                "https://api.elevenlabs.io/v1/shared-voices"
              );
              searchUrl.searchParams.set("language", code);
              searchUrl.searchParams.set("page_size", "15");
              searchUrl.searchParams.set("sort", "usage_character_count_1d");

              const libRes = await fetch(searchUrl.toString(), {
                headers: { "xi-api-key": apiKey },
              });
              if (!libRes.ok) return;

              const libData = await libRes.json();
              const voices = (
                libData.voices as {
                  voice_id: string;
                  public_owner_id: string;
                  name: string;
                  category: string;
                  accent?: string;
                  gender?: string;
                  descriptive?: string;
                }[]
              ).slice(0, 10);

              for (const v of voices) {
                libraryVoices.push({
                  voice_id: v.voice_id,
                  name: `${v.name}${v.accent ? ` (${v.accent})` : ""}${v.gender ? ` · ${v.gender}` : ""}`,
                  category: v.category || "library",
                  language: label,
                  source: "library",
                  public_owner_id: v.public_owner_id,
                });
              }
            } catch {
              // Skip language on error
            }
          })
        );

        // Combine: own voices first, then library voices
        const allVoices = [
          ...ownVoices.map((v) => ({ ...v, public_owner_id: "" })),
          ...libraryVoices,
        ];

        return Response.json({ ok: true, voices: allVoices });
      }

      case "custom": {
        if (!baseUrl) {
          throw new Error("Base URL required for custom provider");
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
    return Response.json({ ok: false, error: message }, { status: 200 });
  }
}
