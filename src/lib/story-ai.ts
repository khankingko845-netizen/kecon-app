import { z } from "zod";
import { callLlmJson, type FetchLike, type LlmProvider, type LlmResult, type LlmTarget } from "@/lib/llm";

export interface GeneratedCharacter {
  name: string;
  description: string;
  personality: string;
  emoji?: string;
}

export interface GeneratedStory {
  title: string;
  pages: StoryPage[];
  summary: string;
  characters?: GeneratedCharacter[];
}

export interface StoryPage {
  text: string;
  sceneDescription: string;
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
}

const SYSTEM_PROMPT = `Bạn là một tác giả truyện thiếu nhi chuyên nghiệp. 
Viết truyện bằng ngôn ngữ phù hợp với độ tuổi của bé, dùng câu đơn giản, từ vựng dễ hiểu.
Truyện phải có bài học đạo đức, nhân vật dễ thương, và kết thúc có hậu.

QUAN TRỌNG — Voice Markup:
- Dùng [narrator]...[/narrator] cho lời kể chuyện
- Dùng [character:Tên Nhân Vật]...[/character] cho lời thoại của nhân vật
- Mỗi nhân vật có giọng riêng, giúp bé phân biệt ai đang nói
- Luôn bao bọc TOÀN BỘ text trong markup tags

Ví dụ:
[narrator]Ngày xưa, trong khu rừng xanh có một chú Sóc nhỏ rất tinh nghịch.[/narrator]
[character:Sóc Nhỏ]Hôm nay mình sẽ đi tìm quả hạch ngon nhất![/character]
[narrator]Sóc Nhỏ gặp bạn Thỏ trên đường đi.[/narrator]
[character:Thỏ Trắng]Chào cậu! Cậu đi đâu sớm thế?[/character]

Trả về JSON hợp lệ theo đúng format yêu cầu, KHÔNG thêm markdown hay text ngoài JSON.`;

function buildUserPrompt(params: StoryParams): string {
  const themeMap: Record<string, string> = {
    cotich: "Cổ tích Việt Nam",
    phieuluu: "Phiêu lưu mạo hiểm",
    ngungon: "Truyện ru ngủ êm dịu",
    dongvat: "Truyện về động vật",
    hocchoi: "Truyện học và chơi giáo dục",
    tuviet: "Truyện sáng tạo tự do",
  };

  const langMap: Record<string, string> = {
    vi: "Tiếng Việt",
    en: "English",
    ja: "日本語 (Japanese)",
  };

  const forChild = params.childName
    ? `cho bé ${params.childName}, ${params.age} tuổi`
    : `cho trẻ ${params.age} tuổi`;
  return `Viết một câu chuyện ${forChild}.
Chủ đề: ${themeMap[params.theme] || params.theme}
Ngôn ngữ: ${langMap[params.language] || params.language}
${params.extraPrompt ? `Yêu cầu thêm: ${params.extraPrompt}` : ""}

Trả về JSON với format sau (8-12 trang):
{
  "title": "Tên truyện",
  "summary": "Tóm tắt ngắn 1-2 câu",
  "characters": [
    { "name": "Sóc Nhỏ", "description": "Chú sóc tinh nghịch", "personality": "vui tươi, năng động", "emoji": "🐿️" }
  ],
  "pages": [
    { "text": "[narrator]Lời kể...[/narrator]\\n[character:Sóc Nhỏ]Lời thoại...[/character]", "sceneDescription": "Mô tả cảnh ngắn gọn cho minh họa" }
  ]
}

Yêu cầu:
- Phải dùng voice markup [narrator]...[/narrator] và [character:Tên]...[/character] cho TOÀN BỘ text
- Liệt kê TẤT CẢ nhân vật trong mảng "characters" (2-4 nhân vật)
- Mỗi nhân vật cần emoji phù hợp
- Lời kể bao bọc trong [narrator], lời thoại trong [character:Tên]`;
}

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

/** Same as generateStory but also returns provider usage (for cost tracking). */
export async function generateStoryWithUsage(
  target: LlmTarget,
  params: StoryParams,
  fetchImpl?: FetchLike
): Promise<{ story: GeneratedStory; result: LlmResult }> {
  const { data, result } = await callLlmJson(
    {
      ...target,
      system: SYSTEM_PROMPT,
      prompt: buildUserPrompt(params),
      temperature: 0.8,
    },
    fetchImpl
  );
  const parsed = GeneratedStorySchema.safeParse(data);
  if (!parsed.success) throw new Error("Story format invalid");
  return { story: parsed.data as GeneratedStory, result };
}

export { PROVIDER_MODELS } from "@/lib/llm";
