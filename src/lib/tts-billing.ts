import { stripEmotionTags } from "@/lib/elevenlabs";

/** The provider receives this text, not display text or the JSON body bytes. */
export function fishSubmittedText(text: string): string {
  return stripEmotionTags(text);
}

/** Fish bills UTF-8 bytes. App quota and key-pool character counts stay separate. */
export function fishBillingUsage(text: string) {
  return {
    units: new TextEncoder().encode(fishSubmittedText(text)).byteLength,
    billingUnit: "utf8_bytes" as const,
    usageVersion: 2 as const,
  };
}