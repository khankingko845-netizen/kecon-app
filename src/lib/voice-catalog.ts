import { elevenFetch } from "@/lib/elevenlabs";
import {
  voiceLanguages,
  nativeVoiceLanguage,
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
}
/** Native ≠ model support/verified languages. Never infer a label from the requested filter. */
export function catalogVoice(
  v: ProviderVoice,
  source: "own" | "library",
): CatalogVoice {
  return {
    voice_id: v.voice_id,
    name: v.name,
    category: v.category ?? "unknown",
    language: nativeVoiceLanguage(v) ?? "",
    languages: voiceLanguages(v),
    source,
    public_owner_id: v.public_owner_id,
  };
}
export async function fetchVoiceCatalog(
  key: string,
  language?: string,
  search = "",
  page = 0,
) {
  const own = await (
    await elevenFetch(
      "/voices",
      key,
      { signal: AbortSignal.timeout(12_000) },
      "đọc danh sách giọng",
    )
  ).json();
  const voices: CatalogVoice[] = (own.voices ?? [])
    .filter(
      (v: ProviderVoice) =>
        !search ||
        `${v.name} ${v.voice_id}`.toLowerCase().includes(search.toLowerCase()),
    )
    .map((v: ProviderVoice) => catalogVoice(v, "own"));
  const warnings: string[] = [];
  let hasMore = false;
  await Promise.all(
    (language ? [language] : ["vi", "en", "ja"]).map(async (lang) => {
      try {
        const params = new URLSearchParams({
          language: lang,
          page_size: "100",
          page: String(page),
          ...(search ? { search } : {}),
        });
        const data = await (
          await elevenFetch(
            `/shared-voices?${params}`,
            key,
            { signal: AbortSignal.timeout(12_000) },
            "đọc thư viện giọng",
          )
        ).json();
        hasMore ||= Boolean(data.has_more);
        for (const v of data.voices ?? [])
          voices.push(catalogVoice(v, "library"));
      } catch {
        warnings.push(
          `Chưa tải được thư viện ${lang}. Key có thể thiếu quyền Voice Library hoặc nhà cung cấp đang lỗi; giọng trong tài khoản vẫn dùng để lựa chọn.`,
        );
      }
    }),
  );
  const unique = new Map<string, CatalogVoice>();
  for (const v of voices) {
    const prev = unique.get(v.voice_id);
    if (prev) {
      prev.languages = [...new Set([...prev.languages, ...v.languages])];
      if (!prev.language) prev.language = v.language;
    } else unique.set(v.voice_id, v);
  }
  return { voices: [...unique.values()], warnings, hasMore, page };
}
/** Exact provider lookup is separate from a bounded catalogue/name search. Try every pool key. */
export async function fetchVoiceById(
  key: string,
  id: string,
): Promise<CatalogVoice> {
  const data = await (
    await elevenFetch(
      `/voices/${encodeURIComponent(id)}`,
      key,
      { signal: AbortSignal.timeout(12_000) },
      "tra cứu ID giọng",
    )
  ).json();
  return catalogVoice(data, "own");
}
