import { normalizeVoiceLanguage } from "@/lib/voice-selection";
/** Vietnamese is NOT among Multilingual v2's 29 languages. Never send it there. */
export function modelForLanguage(
  configured: string,
  language?: string,
): string {
  const locale = normalizeVoiceLanguage(language);
  if (
    locale === "vi" &&
    !["eleven_v3", "eleven_turbo_v2_5", "eleven_flash_v2_5"].includes(
      configured,
    )
  )
    return "eleven_flash_v2_5";
  if (
    locale &&
    locale !== "en" &&
    ["eleven_monolingual_v1", "eleven_turbo_v2", "eleven_flash_v2"].includes(
      configured,
    )
  )
    return "eleven_flash_v2_5";
  return configured;
}
export function supportsLanguageCode(model: string): boolean {
  return ["eleven_v3", "eleven_turbo_v2_5", "eleven_flash_v2_5"].includes(
    model,
  );
}
