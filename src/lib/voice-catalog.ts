import { elevenFetch } from "@/lib/elevenlabs";
import {
  voiceLanguages,
  normalizeVoiceLanguage,
  type LanguageVoice,
} from "@/lib/voice-selection";
export interface CatalogVoice {
  voice_id: string;
  name: string;
  category: string;
  language: string;
  languages: string[];
  source: "own" | "library";
  public_owner_id?: string;
}
interface ProviderVoice extends LanguageVoice {
  voice_id: string;
  name: string;
  category?: string;
  public_owner_id?: string;
  accent?: string;
}
/** Provider metadata denotes native/verified languages, not universal model capabilities. */
export function catalogVoice(
  v: ProviderVoice,
  source: "own" | "library",
  hint?: string,
): CatalogVoice {
  const languages = voiceLanguages(v);
  if (hint && !languages.length)
    languages.push(normalizeVoiceLanguage(hint) ?? hint);
  return {
    voice_id: v.voice_id,
    name: v.name,
    category: v.category ?? "unknown",
    language: languages[0] ?? "",
    languages,
    source,
    public_owner_id: v.public_owner_id,
  };
}
export async function fetchVoiceCatalog(
  key: string,
  language?: string,
): Promise<{ voices: CatalogVoice[]; warnings: string[] }> {
  const own = await (
    await elevenFetch(
      "/voices",
      key,
      { signal: AbortSignal.timeout(12_000) },
      "đọc danh sách giọng",
    )
  ).json();
  const voices: CatalogVoice[] = (own.voices ?? []).map((v: ProviderVoice) =>
    catalogVoice(v, "own"),
  );
  const warnings: string[] = [];
  await Promise.all(
    (language ? [language] : ["vi", "en", "ja"]).map(async (lang) => {
      try {
        const r = await elevenFetch(
          `/shared-voices?language=${encodeURIComponent(lang)}&page_size=30`,
          key,
          { signal: AbortSignal.timeout(12_000) },
          "đọc thư viện giọng",
        );
        const data = await r.json();
        for (const v of data.voices ?? [])
          voices.push(catalogVoice(v, "library", lang));
      } catch {
        warnings.push(
          `Chưa tải được thư viện ${lang}. Key có thể thiếu quyền Voice Library hoặc nhà cung cấp đang lỗi; giọng trong tài khoản vẫn dùng để lựa chọn.`,
        );
      }
    }),
  );
  // Keep own metadata when an account voice also appears in the library; union languages.
  const unique = new Map<string, CatalogVoice>();
  for (const v of voices) {
    const previous = unique.get(v.voice_id);
    if (previous)
      previous.languages = [
        ...new Set([...previous.languages, ...v.languages]),
      ];
    else unique.set(v.voice_id, v);
  }
  return { voices: [...unique.values()], warnings };
}
