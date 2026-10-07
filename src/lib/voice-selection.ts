/** ISO language normalization is shared by catalogue, creation and playback. Unknown ≠ English. */
export function normalizeVoiceLanguage(value?: string | null): string | null {
  const raw = (value ?? "").trim().toLowerCase();
  const aliases: Record<string, string> = {
    vietnamese: "vi",
    "tiếng việt": "vi",
    english: "en",
    japanese: "ja",
    日本語: "ja",
    korean: "ko",
    chinese: "zh",
    french: "fr",
    german: "de",
    spanish: "es",
    thai: "th",
  };
  return (
    aliases[raw] ??
    (/^[a-z]{2,3}(?:[-_][a-z0-9]+)*$/.test(raw) ? raw.split(/[-_]/)[0] : null)
  );
}
export interface LanguageVoice {
  language?: string;
  languages?: string[];
  labels?: Record<string, string>;
  verified_languages?: { language?: string; locale?: string }[];
}
export function voiceLanguages(v: LanguageVoice): string[] {
  return [
    ...new Set(
      [
        v.language,
        v.labels?.language,
        ...(v.languages ?? []),
        ...(v.verified_languages ?? []).flatMap((l) => [l.language, l.locale]),
      ]
        .map(normalizeVoiceLanguage)
        .filter((s): s is string => !!s),
    ),
  ];
}
export function voiceMatchesLanguage(
  v: LanguageVoice,
  locale: string,
): boolean {
  return voiceLanguages(v).includes(normalizeVoiceLanguage(locale) ?? locale);
}
export interface FamilyNarrator {
  id: string;
  name: string;
  relation?: string;
  elevenlabs_voice_id: string | null;
  is_active?: boolean;
}
export interface CuratedNarrator {
  id: string;
  voice_id: string;
  name: string;
  language: string;
  sort_order?: number;
  is_active?: boolean;
}
export type NarratorChoice = { kind: "family" | "default"; id: string } | null;
export function preferredFamilyVoice<T extends FamilyNarrator>(
  voices: T[],
): T | undefined {
  return voices.find((v) => v.is_active !== false && !!v.elevenlabs_voice_id?.trim());
}
export function rankedDefaultsForLocale<T extends CuratedNarrator>(
  voices: T[],
  locale: string,
): T[] {
  return voices
    .filter((v) => v.is_active !== false && voiceMatchesLanguage(v, locale))
    .sort(
      (a, b) =>
        (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.id.localeCompare(b.id),
    );
}
export function resolveNarratorChoice(
  family: FamilyNarrator[],
  defaults: CuratedNarrator[],
  locale: string,
  selected: NarratorChoice,
): {
  kind: "family" | "default";
  id: string;
  voice_id: string;
  name: string;
} | null {
  const ranked = rankedDefaultsForLocale(defaults, locale);
  if (selected?.kind === "family") {
    const f = family.find((v) => v.id === selected.id && v.is_active !== false && v.elevenlabs_voice_id);
    if (f)
      return {
        kind: "family",
        id: f.id,
        voice_id: f.elevenlabs_voice_id!,
        name: f.name,
      };
  }
  if (selected?.kind === "default") {
    const d = ranked.find((v) => v.voice_id === selected.id);
    if (d)
      return {
        kind: "default",
        id: d.voice_id,
        voice_id: d.voice_id,
        name: d.name,
      };
  }
  const f = preferredFamilyVoice(family);
  if (f)
    return {
      kind: "family",
      id: f.id,
      voice_id: f.elevenlabs_voice_id!,
      name: f.name,
    };
  const d = ranked[0];
  return d
    ? { kind: "default", id: d.voice_id, voice_id: d.voice_id, name: d.name }
    : null;
}
