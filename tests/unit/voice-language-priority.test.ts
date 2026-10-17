import { describe, expect, it } from "vitest";
import {
  normalizeVoiceLanguage,
  voiceLanguages,
  voiceMatchesLanguage,
  preferredFamilyVoice,
  rankedDefaultsForLocale,
  resolveNarratorChoice,
} from "@/lib/voice-selection";
const family = [
  { id: "f1", name: "Mẹ", relation: "mother", elevenlabs_voice_id: "clone1" },
];
const defaults = [
  { id: "d2", voice_id: "vi2", name: "Vi 2", language: "vi", sort_order: 2 },
  { id: "d1", voice_id: "vi1", name: "Vi 1", language: "vi-VN", sort_order: 0 },
  { id: "en", voice_id: "en1", name: "English", language: "en", sort_order: 0 },
];
describe("voice language and priority", () => {
  it("normalizes language codes, labels, locales; unknown is never guessed English", () => {
    for (const v of ["vi", "VI-vn", "Vietnamese", "Tiếng Việt"])
      expect(normalizeVoiceLanguage(v)).toBe("vi");
    expect(normalizeVoiceLanguage("日本語")).toBe("ja");
    expect(normalizeVoiceLanguage("English")).toBe("en");
    expect(normalizeVoiceLanguage("")).toBeNull();
  });
  it("combines native and verified languages, includes generated/professional categories", () => {
    const v = {
      labels: { language: "Vietnamese" },
      verified_languages: [
        { language: "ja", locale: "ja-JP" },
        { language: "vi" },
      ],
      category: "professional",
    };
    expect(voiceLanguages(v)).toEqual(["vi", "ja"]);
    expect(
      voiceMatchesLanguage({ languages: voiceLanguages(v) }, "vi-VN"),
    ).toBe(true);
    expect(voiceMatchesLanguage({ languages: [] }, "vi")).toBe(false);
  });
  it("sorts curated voices only within language", () =>
    expect(
      rankedDefaultsForLocale(defaults, "vi").map((v) => v.voice_id),
    ).toEqual(["vi1", "vi2"]));
  it("prefers ready family clones over ranked defaults, but honours explicit choice", () => {
    expect(resolveNarratorChoice(family, defaults, "vi", null)).toMatchObject({
      kind: "family",
      id: "f1",
      voice_id: "clone1",
    });
    expect(
      resolveNarratorChoice(family, defaults, "vi", {
        kind: "default",
        id: "vi2",
      }),
    ).toMatchObject({ kind: "default", voice_id: "vi2" });
    expect(resolveNarratorChoice([], defaults, "vi", null)).toMatchObject({
      voice_id: "vi1",
    });
    expect(resolveNarratorChoice([], defaults, "ja", null)).toBeNull();
    expect(
      resolveNarratorChoice([], defaults, "ja", { kind: "default", id: "en1" }),
    ).toBeNull();
  });
  it("never picks an un-cloned family entry", () =>
    expect(
      preferredFamilyVoice([
        { id: "x", name: "Ba", elevenlabs_voice_id: null },
        ...family,
      ])?.id,
    ).toBe("f1"));
  it("ignores disabled family/default entries, including explicit stale choices", () => {
    const offFamily = family.map((v) => ({ ...v, is_active: false }));
    expect(preferredFamilyVoice(offFamily)).toBeUndefined();
    const offDefaults = defaults.map((v) => ({ ...v, is_active: false }));
    expect(
      resolveNarratorChoice(offFamily, offDefaults, "vi", {
        kind: "family",
        id: "f1",
      }),
    ).toBeNull();
    expect(
      resolveNarratorChoice([], offDefaults, "vi", {
        kind: "default",
        id: "vi1",
      }),
    ).toBeNull();
  });
});
