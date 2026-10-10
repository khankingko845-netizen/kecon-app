/**
 * Page illustration prompts — one house art style + a fixed "character bible"
 * (English appearance per character) repeated on every page so the same
 * character looks the same across the book. Pure, unit-tested.
 */
export const ART_STYLES = {
  clay: "soft 3D clay plasticine picture-book style, rounded shapes, matte textures, warm soft lighting, gentle pastel palette",
  watercolor: "gentle watercolor picture-book illustration, soft washes, delicate outlines, warm pastel palette",
  storybook: "classic hand-painted storybook illustration, warm colors, cozy detailed backgrounds",
  cartoon: "cute modern cartoon illustration, clean outlines, bright friendly colors",
} as const;
export type ArtStyle = keyof typeof ART_STYLES;
export const DEFAULT_ART_STYLE: ArtStyle = "clay";
export function isArtStyle(v: unknown): v is ArtStyle {
  return typeof v === "string" && Object.hasOwn(ART_STYLES, v);
}

export interface BibleCharacter {
  name: string;
  appearance?: string | null;
  description?: string | null;
  role?: string | null;
}

export interface IllustrationInput {
  style?: string | null;
  title?: string | null;
  /** English page prompt from the writer (preferred). */
  illustration?: string | null;
  sceneDescription?: string | null;
  text?: string | null;
  mood?: string | null;
  characters?: BibleCharacter[];
}

const clean = (s: string | null | undefined, max: number) =>
  (s ?? "")
    .replace(/\[\/?(narrator|character)(:[^\]]*)?\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

/** Characters that appear on this page (by name in the prompt/scene/text); the hero if none. */
export function charactersOnPage(input: IllustrationInput): BibleCharacter[] {
  const list = (input.characters ?? []).filter((c) => c.name);
  const hay = `${input.illustration ?? ""} ${input.sceneDescription ?? ""} ${input.text ?? ""}`.toLocaleLowerCase("vi");
  const present = list.filter((c) => hay.includes(c.name.toLocaleLowerCase("vi")));
  if (present.length) return present.slice(0, 4);
  const hero = list.find((c) => c.role === "hero") ?? list[0];
  return hero ? [hero] : [];
}

export function buildIllustrationPrompt(input: IllustrationInput): string {
  const style = ART_STYLES[isArtStyle(input.style) ? input.style : DEFAULT_ART_STYLE];
  const scene = clean(input.illustration, 700) || clean(input.sceneDescription, 400) || clean(input.text, 400);
  const cast = charactersOnPage(input)
    .map((c) => `- ${clean(c.name, 40)}: ${clean(c.appearance, 300) || clean(c.description, 200) || "friendly storybook character"}`)
    .join("\n");
  return [
    `Children's picture-book page illustration, ${style}.`,
    "Wide landscape composition (3:2) with clear focal action and some calm empty space; safe, warm and gentle for children aged 3 to 8.",
    input.title ? `Story: "${clean(input.title, 120)}".` : "",
    cast ? `Characters (keep their look exactly consistent on every page):\n${cast}` : "",
    `Scene: ${scene}`,
    input.mood ? `Mood: ${clean(input.mood, 30)}.` : "",
    "No text, no letters, no captions, no watermark, no logos. Nothing scary or violent.",
  ]
    .filter(Boolean)
    .join("\n");
}
