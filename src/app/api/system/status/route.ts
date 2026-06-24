/**
 * GET /api/system/status
 * Returns which system-wide services are configured by admin.
 * Does NOT expose actual keys — just booleans.
 */
import { getSystemSetting } from "@/lib/server-settings";

export async function GET() {
  try {
    const [elevenLabsKey, storyKey, geminiKey, anthropicKey, customKey, customUrl, elevenModel, defaultModel] =
      await Promise.all([
        getSystemSetting("elevenlabs_api_key"),
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
      hasElevenLabs: Boolean(elevenLabsKey),
      hasStoryProvider,
      defaultStoryProvider,
      defaultStoryModel: defaultModel || "",
      hasCustomUrl: Boolean(customUrl),
      elevenLabsModel: elevenModel || "",
    });
  } catch {
    return Response.json({
      hasElevenLabs: false,
      hasStoryProvider: false,
      defaultStoryProvider: "",
      defaultStoryModel: "",
      hasCustomUrl: false,
      elevenLabsModel: "",
    });
  }
}
