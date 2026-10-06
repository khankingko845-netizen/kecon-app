/**
 * GET /api/system/status
 * Returns which system-wide services are configured by admin.
 * Does NOT expose actual keys — just booleans.
 */
import { getSystemSetting } from "@/lib/server-settings";
import { voiceKeyPool } from "@/lib/key-pool";

export async function GET() {
  try {
    const [hasElevenLabs, hasFishAudio, storyKey, geminiKey, anthropicKey, customKey, customUrl, elevenModel, defaultModel] =
      await Promise.all([
        // A-04b: voice keys live in the rotating pool (+ env fallback).
        voiceKeyPool.configured("elevenlabs"),
        voiceKeyPool.configured("fishaudio"),
        getSystemSetting("openai_api_key"),
        getSystemSetting("gemini_api_key"),
        getSystemSetting("anthropic_api_key"),
        getSystemSetting("custom_provider_key"),
        getSystemSetting("custom_provider_url"),
        getSystemSetting("elevenlabs_model_id"),
        getSystemSetting("default_ai_model"),
      ]);

    // Determine if at least one story AI provider is configured
    const hasStoryProvider = Boolean(storyKey || geminiKey || anthropicKey || customKey);
    // Determine default story provider
    let defaultStoryProvider = "";
    if (storyKey) defaultStoryProvider = "openai";
    else if (geminiKey) defaultStoryProvider = "gemini";
    else if (anthropicKey) defaultStoryProvider = "anthropic";
    else if (customKey && customUrl) defaultStoryProvider = "custom";

    return Response.json({
      hasElevenLabs,
      hasFishAudio,
      hasStoryProvider,
      defaultStoryProvider,
      defaultStoryModel: defaultModel || "",
      hasCustomUrl: Boolean(customUrl),
      elevenLabsModel: elevenModel || "",
    });
  } catch {
    return Response.json({
      hasElevenLabs: false,
      hasFishAudio: false,
      hasStoryProvider: false,
      defaultStoryProvider: "",
      defaultStoryModel: "",
      hasCustomUrl: false,
      elevenLabsModel: "",
    });
  }
}
