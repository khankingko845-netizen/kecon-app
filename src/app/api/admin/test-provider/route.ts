import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/admin/test-provider
 * Tests an API key + fetches available models from a provider.
 * Body: { provider, apiKey, baseUrl? }
 * Returns: { ok, models?, voices?, error? }
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Check admin role
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (!profile || !["admin", "super_admin"].includes(profile.role)) {
    return Response.json({ error: "Admin only" }, { status: 403 });
  }

  const body = await request.json();
  const { provider, apiKey, baseUrl } = body as {
    provider: string;
    apiKey: string;
    baseUrl?: string;
  };

  if (!apiKey) {
    return Response.json({ error: "API key is required" }, { status: 400 });
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
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
        );
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
        const url = baseUrl.replace(/\/+$/, "") + "/models";
        const res = await fetch(url, {
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
