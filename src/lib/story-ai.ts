import { z } from "zod";
import { callLlmJson, type FetchLike, type LlmProvider, type LlmResult, type LlmTarget } from "@/lib/llm";
import { getAgeBand } from "@/lib/age-bands";
import {
  cleanCharacterName,
  pagePlan,
  spokenWordCount,
  estimatedMinutes,
  VOICE_TYPES,
  type BriefCharacter,
  type NarrationPace,
  type PagePlan,
  type StoryLength,
  type VoiceType,
} from "@/lib/story-brief";
import { STORY_SFX_IDS, storySfx, type SfxId } from "@/lib/sfx-library";
import { SCENE_IDS, isSceneId, type SceneId } from "@/lib/scene-library";

/** Bumped when the writer contract changes (stored on stories.generator_version). */
export const STORY_GENERATOR_VERSION = 2;

export const STORY_AMBIENTS = ["forest", "night", "waves", "rain", "stream", "wind", "fire", "lullaby"] as const;
export type StoryAmbient = (typeof STORY_AMBIENTS)[number];
export const STORY_MOODS = ["calm", "happy", "curious", "tense", "sad", "sleepy", "triumphant"] as const;
export type StoryMood = (typeof STORY_MOODS)[number];

export interface GeneratedCharacter {
  name: string;
  description: string;
  personality: string;
  emoji?: string;
  role?: "hero" | "friend";
  voiceType?: VoiceType | null;
  /** English visual description reused in every illustration prompt. */
  appearance?: string;
}

export interface GeneratedStory {
  title: string;
  pages: StoryPage[];
  summary: string;
  moral?: string;
  characters?: GeneratedCharacter[];
}

export interface StoryPage {
  text: string;
  sceneDescription: string;
  /** English illustration prompt for this page. */
  illustration?: string;
  /** Bundled scene art id (fallback picture). */
  scene?: SceneId | null;
  ambient?: StoryAmbient | null;
  sfx?: SfxId[];
  mood?: StoryMood | null;
}

/** Shape we require from the model; extra fields are kept (passthrough). */
export const GeneratedStorySchema = z.looseObject({
  title: z.string().min(1),
  summary: z.string().default(""),
  characters: z
    .array(
      z.looseObject({
        name: z.string().min(1),
        description: z.string().default(""),
        personality: z.string().default(""),
        emoji: z.string().optional(),
      })
    )
    .optional(),
  pages: z
    .array(z.looseObject({ text: z.string(), sceneDescription: z.string().default("") }))
    .min(1),
});

export interface StoryParams {
  theme: string;
  childName: string;
  age: string;
  language: string;
  extraPrompt?: string;
  /** v2 brief — all optional so older callers keep working. */
  characters?: BriefCharacter[];
  length?: StoryLength;
  pace?: NarrationPace;
}

const THEME_LABEL: Record<string, string> = {
  cotich: "Cổ tích Việt Nam (làng quê, tre, lúa, trăng rằm, ông bụt, nét văn hoá Việt)",
  phieuluu: "Phiêu lưu mạo hiểm (khám phá, vượt thử thách, đồng đội)",
  ngungon: "Truyện ru ngủ êm dịu (nhịp chậm, khung cảnh yên bình, kết thúc bằng giấc ngủ ngon)",
  dongvat: "Truyện về động vật (đặc điểm thật của con vật, tình bạn muôn loài)",
  hocchoi: "Truyện học mà chơi (lồng ghép một kiến thức đơn giản, tò mò, thực hành)",
  tuviet: "Truyện sáng tạo tự do",
};

const LANGUAGE_LABEL: Record<string, string> = {
  vi: "Tiếng Việt",
  en: "English",
  ja: "日本語 (Japanese)",
};

const SYSTEM_PROMPT = `Bạn là tác giả truyện thiếu nhi kiêm biên kịch sách nói cho trẻ em Việt Nam.
Truyện của bạn được ĐỌC TO cho bé nghe (thường trước giờ ngủ), có giọng người kể, giọng riêng cho từng nhân vật, âm thanh khung cảnh và một bức tranh minh hoạ cho mỗi trang.

Nguyên tắc viết:
1. Cốt truyện trọn vẹn: mở đầu giới thiệu nhân vật và khung cảnh → sự việc khởi đầu → thử thách tăng dần (ít nhất hai lần cố gắng) → cao trào được giải quyết bằng lòng tốt, sự thông minh hoặc tình bạn → kết thúc ấm áp, êm dịu. Bài học nhẹ nhàng, thể hiện qua hành động, không giảng giải dài.
2. Mỗi trang có 2–3 đoạn, mỗi đoạn 2–4 câu. Mọi câu đều kết thúc bằng dấu chấm, chấm hỏi, chấm than hoặc dấu ba chấm. Câu ngắn gọn, tối đa khoảng 25 chữ.
3. Có lời thoại thật trên hầu hết các trang: nhân vật chính và các nhân vật phụ nói chuyện với nhau (ít nhất hai nhân vật biết nói ngoài người kể). Mỗi nhân vật có cách nói riêng.
4. Gợi âm thanh bằng từ tượng thanh tiếng Việt (róc rách, xào xạc, tí tách, lạch cạch, ríu rít…) để bé "nghe thấy" khung cảnh.
5. An toàn cho trẻ: không bạo lực, không chi tiết đáng sợ quá mức, không thương hiệu, không nhân vật có bản quyền.
6. Mỗi trang là một cảnh vẽ được: rõ nơi chốn, thời điểm trong ngày, nhân vật đang làm gì.

Voice markup (bắt buộc):
- Toàn bộ "text" của mỗi trang nằm trong [narrator]...[/narrator] hoặc [character:Tên]...[/character].
- Tên trong [character:Tên] phải TRÙNG KHỚP với "name" trong mảng "characters".
- Mỗi khối markup nằm trên một dòng riêng, ngăn cách bằng \\n.
- Khối [character:...] chỉ chứa đúng lời nhân vật nói. Lời dẫn ("Thỏ reo lên:") nằm trong [narrator].

Ví dụ một trang:
[narrator]Sáng hôm ấy, nắng vàng rải khắp bìa rừng. Gió thổi xào xạc qua những tán lá. Thỏ Bông nhảy tung tăng bên bờ suối.[/narrator]
[character:Thỏ Bông]Ôi, nước suối hát róc rách kìa! Mình đi theo dòng suối nhé?[/character]
[narrator]Bạn Rùa chậm rãi ngẩng đầu lên, mỉm cười hiền hậu.[/narrator]
[character:Bác Rùa]Đi từ từ thôi cháu ơi. Đi chậm mà chắc, sẽ thấy nhiều điều hay lắm.[/character]

Chỉ trả về MỘT JSON object hợp lệ, không markdown, không giải thích thêm.`;

function characterLines(params: StoryParams): string {
  const list = params.characters ?? [];
  if (list.length === 0) return "";
  const lines = list.map((c) => {
    const role = c.role === "hero" ? "nhân vật chính" : "bạn đồng hành";
    const who = c.isChild ? `chính là bé${params.childName ? ` ${params.childName}` : ""}` : c.description;
    return `- "${c.name}" — ${role}${who ? ` — ${who}` : ""}`;
  });
  return `Nhân vật gia đình đã chọn (BẮT BUỘC xuất hiện, giữ ĐÚNG tên và vai, có lời thoại):
${lines.join("\n")}
Có thể thêm 1–2 nhân vật phụ để câu chuyện sinh động; mỗi nhân vật phụ cũng có lời thoại.`;
}

export function buildStoryPrompt(params: StoryParams, plan: PagePlan = pagePlan(params.age, params.length)): string {
  const band = getAgeBand(params.age);
  const pace = params.pace ?? "normal";
  const forChild = params.childName ? `cho bé ${params.childName} (${band.label})` : `cho trẻ ${band.label}`;
  const total = plan.pages * Math.round((plan.words[0] + plan.words[1]) / 2);
  const paceLine =
    pace === "calm"
      ? "chậm rãi, êm như lời ru: câu ngắn, hình ảnh dịu dàng, vài câu lặp lại nhẹ nhàng; các trang cuối chậm dần và yên bình"
      : "tự nhiên, sinh động, có lúc hồi hộp vừa phải rồi nhẹ nhõm";
  const extra = params.extraPrompt?.trim();
  return `Viết một câu chuyện ${forChild}.
Chủ đề: ${THEME_LABEL[params.theme] || params.theme}
Ngôn ngữ của truyện: ${LANGUAGE_LABEL[params.language] || params.language}
Phong cách theo độ tuổi: ${band.tone}
Độ dài: ĐÚNG ${plan.pages} trang. Mỗi trang ${plan.words[0]}–${plan.words[1]} chữ (không tính thẻ markup). Tổng khoảng ${total} chữ, khoảng ${estimatedMinutes(plan, pace)} phút nghe. Không viết trang nào ngắn hơn ${plan.words[0]} chữ.
Nhịp kể: ${paceLine}.
${characterLines(params)}
${extra ? `Yêu cầu thêm của gia đình: ${extra}` : ""}

Trả về JSON đúng cấu trúc sau:
{
  "title": "Tên truyện",
  "summary": "Tóm tắt 1–2 câu",
  "moral": "Bài học ngắn gọn",
  "characters": [
    {
      "name": "Thỏ Bông",
      "role": "hero",
      "description": "Cô thỏ trắng nhỏ tò mò",
      "personality": "vui tươi, hay hỏi",
      "emoji": "🐰",
      "voiceType": "girl",
      "appearance": "small white bunny with long floppy ears, pink nose, wearing a little yellow scarf"
    }
  ],
  "pages": [
    {
      "text": "[narrator]...[/narrator]\\n[character:Thỏ Bông]...[/character]",
      "sceneDescription": "Mô tả cảnh một câu (ngôn ngữ của truyện)",
      "illustration": "English prompt for this page's picture: which characters (by name) are where, doing what, setting, time of day, lighting, framing",
      "scene": "forest",
      "ambient": "forest",
      "sfx": [],
      "mood": "happy"
    }
  ]
}

Quy tắc các trường:
- "characters": liệt kê TẤT CẢ nhân vật có lời thoại (2–5 nhân vật). "role": "hero" cho nhân vật chính (đúng một), còn lại "friend". "voiceType" là một trong: ${VOICE_TYPES.join(", ")}. "appearance" viết bằng tiếng Anh, tối đa 35 từ, mô tả hình dáng cố định (loài, màu sắc, trang phục, đặc điểm) để các tranh vẽ nhất quán.
- "illustration": tiếng Anh, tối đa 60 từ, không yêu cầu chữ trong tranh.
- "scene": khung cảnh gần nhất trong: ${SCENE_IDS.join(", ")}.
- "ambient": âm nền liên tục của khung cảnh: ${STORY_AMBIENTS.join(", ")} hoặc "none" nếu ở nơi yên tĩnh.
- "sfx": 0–2 hiệu ứng ngắn, chỉ khi sự việc thật sự xảy ra trong trang: ${STORY_SFX_IDS.join(", ")}.
- "mood": một trong ${STORY_MOODS.join(", ")}.`;
}

// ── Normalisation ─────────────────────────────────────────────────────────

const MARKUP_RE = /\[(narrator|character:[^\]]+)\][\s\S]*?\[\/(narrator|character)\]/;

function oneLine(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function asEnum<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  return (allowed as readonly string[]).includes(v) ? (v as T) : null;
}

/** Ensure every line is inside a markup block and character names are clean. */
export function normalizePageText(raw: string): string {
  let text = raw.replace(/\r\n?/g, "\n").trim();
  text = text.replace(/\[character:\s*([^\]]+?)\s*\]/g, (_m, name: string) => `[character:${cleanCharacterName(name)}]`);
  if (!MARKUP_RE.test(text)) return text ? `[narrator]${text}[/narrator]` : "";
  // Put each markup block on its own line for readable karaoke and clean TTS segmentation.
  return text.replace(/\[\/(narrator|character)\]\s*(?=\[)/g, "[/$1]\n");
}

function guessVoiceType(name: string, description: string): VoiceType | null {
  const t = `${name} ${description}`.toLowerCase();
  if (/\bbà\b|grandma|grandmother/.test(t)) return "grandma";
  if (/\bông\b|grandpa|grandfather|ông bụt/.test(t)) return "grandpa";
  if (/\bcô\b|\bmẹ\b|tiên|công chúa|princess|fairy|queen|nữ hoàng/.test(t)) return /công chúa|princess/.test(t) ? "girl" : "woman";
  if (/\bchú\b|\bbố\b|\bbác\b|king|vua/.test(t)) return "man";
  if (/rồng|dragon|robot|quái|monster|yêu tinh/.test(t)) return "creature";
  if (/\bbé\b|cậu|bạn nhỏ|\bboy\b/.test(t)) return "boy";
  return null;
}

export function namesInMarkup(pages: { text: string }[]): string[] {
  const names = new Set<string>();
  for (const p of pages)
    for (const m of p.text.matchAll(/\[character:([^\]]+)\]/g)) names.add(m[1].trim());
  return [...names];
}

/** Coerce a parsed model reply into a safe GeneratedStory (v2 fields included). */
export function normalizeStory(data: z.output<typeof GeneratedStorySchema>, params: StoryParams): GeneratedStory {
  const pages: StoryPage[] = data.pages
    .map((p) => {
      const raw = p as Record<string, unknown>;
      return {
        text: normalizePageText(String(p.text ?? "")),
        sceneDescription: oneLine(p.sceneDescription, 400),
        illustration: oneLine(raw.illustration ?? raw.illustrationPrompt, 700) || undefined,
        scene: isSceneId(raw.scene) ? raw.scene : null,
        ambient: asEnum(raw.ambient, STORY_AMBIENTS),
        sfx: storySfx(raw.sfx),
        mood: asEnum(raw.mood, STORY_MOODS),
      };
    })
    .filter((p) => p.text)
    .slice(0, 24);

  const brief = params.characters ?? [];
  const byName = new Map<string, GeneratedCharacter>();
  const keyOf = (name: string) => name.toLocaleLowerCase("vi");
  for (const c of data.characters ?? []) {
    const raw = c as Record<string, unknown>;
    const name = cleanCharacterName(c.name);
    if (!name || byName.has(keyOf(name))) continue;
    const description = oneLine(c.description, 200);
    byName.set(keyOf(name), {
      name,
      description,
      personality: oneLine(c.personality, 120),
      emoji: oneLine(c.emoji, 8) || undefined,
      role: raw.role === "hero" ? "hero" : "friend",
      voiceType: asEnum(raw.voiceType, VOICE_TYPES) ?? guessVoiceType(name, description),
      appearance: oneLine(raw.appearance, 300) || undefined,
    });
  }
  // Required brief characters always exist with the family's exact names.
  for (const b of brief) {
    const existing = byName.get(keyOf(b.name));
    if (existing) {
      existing.role = b.role;
      if (!existing.description) existing.description = b.description;
      if (b.voiceType) existing.voiceType = b.voiceType;
      if (b.appearance) existing.appearance = b.appearance;
    } else {
      byName.set(keyOf(b.name), {
        name: b.name,
        description: b.description,
        personality: "",
        role: b.role,
        voiceType: b.voiceType ?? guessVoiceType(b.name, b.description),
        appearance: b.appearance,
      });
    }
  }
  // Speakers used in markup but missing from the cast list.
  for (const name of namesInMarkup(pages)) {
    if (!byName.has(keyOf(name)))
      byName.set(keyOf(name), { name, description: "", personality: "", role: "friend", voiceType: guessVoiceType(name, "") });
  }
  let characters = [...byName.values()];
  const heroName = brief.find((b) => b.role === "hero")?.name;
  const heroIndex = Math.max(
    0,
    characters.findIndex((c) => (heroName ? keyOf(c.name) === keyOf(heroName) : c.role === "hero"))
  );
  characters = characters.map((c, i) => ({ ...c, role: i === heroIndex ? "hero" : "friend" }));
  characters.sort((a, b) => (a.role === "hero" ? -1 : b.role === "hero" ? 1 : 0));

  return {
    title: oneLine(data.title, 120) || "Truyện của bé",
    summary: oneLine(data.summary, 400),
    moral: oneLine((data as Record<string, unknown>).moral, 200) || undefined,
    characters: characters.slice(0, 8),
    pages,
  };
}

export interface StoryAssessment {
  ok: boolean;
  totalWords: number;
  averageWords: number;
  reasons: string[];
  /** Page indexes below the minimum words per page (fixed by the expansion pass). */
  shortPages: number[];
  /** Problems a full rewrite must fix (missing pages, cast or dialogue) — not just length. */
  structural: boolean;
}

/** Is the draft long, cast-complete and voiced enough to ship? */
export function assessStory(story: GeneratedStory, plan: PagePlan, brief: BriefCharacter[] = []): StoryAssessment {
  const counts = story.pages.map((p) => spokenWordCount(p.text));
  const totalWords = counts.reduce((a, b) => a + b, 0);
  const averageWords = counts.length ? Math.round(totalWords / counts.length) : 0;
  const reasons: string[] = [];
  if (story.pages.length < plan.pages - 1)
    reasons.push(`chỉ có ${story.pages.length} trang, cần đúng ${plan.pages} trang`);
  if (totalWords < plan.pages * plan.words[0] * 0.6)
    reasons.push(`quá ngắn (khoảng ${averageWords} chữ mỗi trang), mỗi trang cần ${plan.words[0]}–${plan.words[1]} chữ`);
  const allText = story.pages.map((p) => p.text).join("\n").toLocaleLowerCase("vi");
  const missing = brief.filter((b) => !allText.includes(b.name.toLocaleLowerCase("vi")));
  if (missing.length) reasons.push(`thiếu nhân vật ${missing.map((m) => `"${m.name}"`).join(", ")}`);
  const dialoguePages = story.pages.filter((p) => /\[character:/.test(p.text)).length;
  if (dialoguePages < Math.ceil(story.pages.length / 2))
    reasons.push("quá ít lời thoại của nhân vật, cần lời thoại trên hầu hết các trang");
  const shortPages = counts.flatMap((n, i) => (n < plan.words[0] ? [i] : []));
  const structural = story.pages.length < plan.pages - 1 || missing.length > 0 || dialoguePages < Math.ceil(story.pages.length / 2);
  return { ok: reasons.length === 0 && shortPages.length <= Math.floor(story.pages.length / 4), totalWords, averageWords, reasons, shortPages, structural };
}

// ── Generation ────────────────────────────────────────────────────────────

export async function generateStory(
  provider: LlmProvider,
  apiKey: string,
  model: string,
  params: StoryParams,
  baseUrl?: string,
  fetchImpl?: FetchLike
): Promise<GeneratedStory> {
  const { story } = await generateStoryWithUsage({ provider, apiKey, model, baseUrl }, params, fetchImpl);
  return story;
}

export interface GenerateOptions {
  /** Re-ask once when the draft is too short / misses the cast (route only). */
  qualityRetry?: boolean;
  /** Total wall-clock budget; the quality retry only runs if time remains. */
  budgetMs?: number;
  now?: () => number;
}

/** Long JSON replies: Anthropic needs an explicit output budget; others use model defaults. */
function outputTokens(provider: LlmProvider, plan: PagePlan): number | undefined {
  if (provider !== "anthropic") return undefined;
  return Math.min(16_000, 2_000 + plan.pages * plan.words[1] * 6);
}

async function draft(target: LlmTarget, params: StoryParams, plan: PagePlan, timeoutMs: number, fetchImpl?: FetchLike, feedback?: string) {
  const prompt = buildStoryPrompt(params, plan) +
    (feedback ? `\n\nBản nháp trước CHƯA ĐẠT: ${feedback}. Hãy viết lại toàn bộ câu chuyện, đủ số trang và đủ độ dài mỗi trang.` : "");
  const { data, result } = await callLlmJson(
    {
      ...target,
      system: SYSTEM_PROMPT,
      prompt,
      temperature: 0.8,
      maxTokens: outputTokens(target.provider, plan),
      timeoutMs,
    },
    fetchImpl
  );
  const parsed = GeneratedStorySchema.safeParse(data);
  if (!parsed.success) throw new Error("Story format invalid");
  return { story: normalizeStory(parsed.data, params), result };
}

// ── Expansion pass: fixes drafts whose pages are too short ───────────────

const EXPAND_CHUNK = 3;
const ExpandSchema = z.object({
  pages: z.array(z.object({ page: z.coerce.number().int(), text: z.string() })).max(EXPAND_CHUNK + 2),
});

/** Vietnamese editing brief: rewrite only `indexes` (0-based) to the target length, same events. */
export function buildExpandPrompt(story: GeneratedStory, params: StoryParams, plan: PagePlan, indexes: number[]): string {
  const band = getAgeBand(params.age);
  const cast = story.characters?.length
    ? story.characters.map((c) => `- ${c.name}${c.description ? `: ${c.description}` : ""}`).join("\n")
    : "- (người kể và các nhân vật trong truyện)";
  const pages = story.pages.map((p, i) => `Trang ${i + 1}:\n${p.text}`).join("\n\n");
  const list = indexes.map((i) => i + 1).join(", ");
  const [min, max] = plan.words;
  return `Bạn đang biên tập truyện thiếu nhi "${story.title}" (${band.label}) để đọc to cho bé nghe.
Nhân vật:
${cast}

Toàn bộ truyện hiện tại (để giữ mạch truyện):
${pages}

Nhiệm vụ: các trang ${list} đang QUÁ NGẮN. Viết lại CHỈ các trang ${list}, mỗi trang dài ${min}–${max} chữ (hãy nhắm khoảng ${max} chữ, đếm cả lời thoại).
Cách viết dài mà vẫn hay:
- Giữ nguyên sự việc và thứ tự của từng trang; không kể trước sự việc của trang sau, không kết thúc truyện sớm.
- Thêm miêu tả bằng các giác quan (âm thanh, màu sắc, mùi hương, cảm giác), cảm xúc và suy nghĩ của nhân vật.
- Thêm 2–3 câu thoại ngắn giữa các nhân vật; có thể dùng từ tượng thanh (rì rào, lách tách, róc rách…).
- Câu ngắn, rõ, dễ đọc to; mỗi câu kết thúc bằng dấu câu. Giữ đúng ngôn ngữ đang dùng trong truyện.
Định dạng: lời dẫn trong [narrator]...[/narrator], lời thoại trong [character:Tên nhân vật]...[/character], mỗi khối trên một dòng.
Chỉ trả về JSON: {"pages":[{"page": <số trang>, "text": "<nội dung trang đã viết lại>"}]}`;
}

/** Rewrites short pages in parallel chunks; keeps the original page when a chunk fails or is not longer. */
export async function expandShortPages(
  target: LlmTarget,
  story: GeneratedStory,
  params: StoryParams,
  plan: PagePlan,
  indexes: number[],
  timeoutMs: number,
  fetchImpl?: FetchLike
): Promise<{ story: GeneratedStory; expanded: number }> {
  const chunks: number[][] = [];
  for (let i = 0; i < indexes.length; i += EXPAND_CHUNK) chunks.push(indexes.slice(i, i + EXPAND_CHUNK));
  const pages = story.pages.map((p) => ({ ...p }));
  let expanded = 0;
  const results = await Promise.allSettled(
    chunks.map((chunk) =>
      callLlmJson(
        {
          ...target,
          system: SYSTEM_PROMPT,
          prompt: buildExpandPrompt(story, params, plan, chunk),
          temperature: 0.7,
          maxTokens: target.provider === "anthropic" ? Math.min(8_000, 600 + chunk.length * plan.words[1] * 6) : undefined,
          timeoutMs,
        },
        fetchImpl
      ).then(({ data }) => ({ chunk, data }))
    )
  );
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    const parsed = ExpandSchema.safeParse(r.value.data);
    if (!parsed.success) continue;
    for (const item of parsed.data.pages) {
      const index = item.page - 1;
      if (!r.value.chunk.includes(index)) continue;
      const text = normalizePageText(item.text);
      const before = spokenWordCount(pages[index].text);
      const after = spokenWordCount(text);
      // Accept only a real expansion that is not runaway long.
      if (after > before * 1.2 && after <= plan.words[1] * 2) {
        pages[index] = { ...pages[index], text };
        expanded++;
      }
    }
  }
  return { story: { ...story, pages }, expanded };
}

// ── Sound fallback: a page that clearly describes a sound gets the matching effect ──

const SFX_HINTS: [SfxId, RegExp][] = [
  ["door-knock", /gõ cửa|cốc cốc|cộc cộc|knock/i],
  ["door-open", /mở cửa|cửa (bật|mở) ra|door open/i],
  ["creak", /kẽo kẹt|cót két|creak/i],
  ["bell", /tiếng chuông|chuông (reo|kêu|ngân)|leng keng|bell/i],
  ["coins", /đồng xu|tiền vàng|kho báu|coins?\b|treasure/i],
  ["magic-sparkle", /phép thuật|phép màu|đũa thần|lấp lánh|biến (thành|hóa|hoá)|magic|sparkl/i],
  ["water-drop", /giọt nước|tí tách|nhỏ giọt|róc rách|drip/i],
  ["footsteps", /bước chân|rón rén|lộp cộp|thình thịch|footsteps|tiptoe/i],
  ["happy-jingle", /hoan hô|reo hò|ăn mừng|vỗ tay|hooray|celebrat/i],
];

export function inferSfx(text: string): SfxId[] {
  const plain = text.replace(/\[\/?(narrator|character)(:[^\]]*)?\]/g, " ");
  const hit = SFX_HINTS.find(([, re]) => re.test(plain));
  return hit ? [hit[0]] : [];
}

/** Fill missing page sound effects from the page text (writer choices always win). */
export function withInferredSfx(story: GeneratedStory): GeneratedStory {
  return { ...story, pages: story.pages.map((p) => (p.sfx?.length ? p : { ...p, sfx: inferSfx(p.text) })) };
}

/** Same as generateStory but also returns provider usage (for cost tracking). */
export async function generateStoryWithUsage(
  target: LlmTarget,
  params: StoryParams,
  fetchImpl?: FetchLike,
  options: GenerateOptions = {}
): Promise<{ story: GeneratedStory; result: LlmResult; assessment: StoryAssessment; attempts: number }> {
  const now = options.now ?? Date.now;
  const started = now();
  const budget = options.budgetMs ?? 240_000;
  const remaining = () => budget - (now() - started);
  const plan = pagePlan(params.age, params.length);
  const brief = params.characters ?? [];
  let best = await draft(target, params, plan, Math.min(180_000, budget), fetchImpl);
  let assessment = assessStory(best.story, plan, brief);
  let attempts = 1;
  const firstCallMs = now() - started;
  // 1) Missing pages / cast / dialogue → one full rewrite, if a second call fits the budget.
  if (options.qualityRetry && assessment.structural && firstCallMs * 1.25 < remaining()) {
    attempts++;
    try {
      const second = await draft(target, params, plan, Math.max(30_000, remaining() - 5_000), fetchImpl, assessment.reasons.join("; "));
      const secondAssessment = assessStory(second.story, plan, brief);
      if (secondAssessment.ok || (!secondAssessment.structural && assessment.structural) || secondAssessment.totalWords > assessment.totalWords) {
        best = second;
        assessment = secondAssessment;
      }
    } catch {
      /* keep the first draft */
    }
  }
  // 2) Pages still too short → expand only those pages (parallel, much faster than a rewrite).
  //    Small models undershoot word targets, so allow a second round for pages still short.
  for (let round = 0; round < 2 && options.qualityRetry && assessment.shortPages.length && remaining() > 25_000; round++) {
    attempts++;
    try {
      const { story, expanded } = await expandShortPages(target, best.story, params, plan, assessment.shortPages, Math.min(90_000, remaining() - 5_000), fetchImpl);
      best = { ...best, story };
      assessment = assessStory(story, plan, brief);
      if (!expanded) break;
    } catch {
      break;
    }
  }
  return { story: withInferredSfx(best.story), result: best.result, assessment, attempts };
}

export { PROVIDER_MODELS } from "@/lib/llm";
