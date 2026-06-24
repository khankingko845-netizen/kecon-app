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

interface StoryParams {
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

// Works with OpenAI and any OpenAI-compatible endpoint (OpenRouter, Groq,
// Together, Azure-style gateways, local LM Studio/Ollama, etc.).
async function callOpenAICompatible(
  baseUrl: string,
  apiKey: string,
  model: string,
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  const endpoint = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.8,
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Provider error: ${res.status}`);
  }
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("Provider trả về định dạng không hợp lệ");
  }
  return content;
}

async function callGemini(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ parts: [{ text: userPrompt }] }],
      generationConfig: {
        temperature: 0.8,
        responseMimeType: "application/json",
      },
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      err.error?.message || `Gemini error: ${res.status}`
    );
  }
  const data = await res.json();
  return data.candidates[0].content.parts[0].text;
}

async function callAnthropic(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      err.error?.message || `Anthropic error: ${res.status}`
    );
  }
  const data = await res.json();
  return data.content[0].text;
}

export async function generateStory(
  provider: "openai" | "gemini" | "anthropic" | "custom",
  apiKey: string,
  model: string,
  params: StoryParams,
  baseUrl?: string
): Promise<GeneratedStory> {
  const userPrompt = buildUserPrompt(params);

  let raw: string;
  switch (provider) {
    case "openai":
      raw = await callOpenAICompatible(
        "https://api.openai.com/v1",
        apiKey,
        model,
        SYSTEM_PROMPT,
        userPrompt
      );
      break;
    case "custom":
      if (!baseUrl) throw new Error("Thiếu Base URL cho custom provider");
      raw = await callOpenAICompatible(
        baseUrl,
        apiKey,
        model,
        SYSTEM_PROMPT,
        userPrompt
      );
      break;
    case "gemini":
      raw = await callGemini(apiKey, model, SYSTEM_PROMPT, userPrompt);
      break;
    case "anthropic":
      raw = await callAnthropic(apiKey, model, SYSTEM_PROMPT, userPrompt);
      break;
  }

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Invalid JSON response from AI");

  const parsed = JSON.parse(jsonMatch[0]);
  if (!parsed.title || !Array.isArray(parsed.pages)) {
    throw new Error("Story format invalid");
  }

  return parsed as GeneratedStory;
}

export const PROVIDER_MODELS: Record<string, { label: string; models: { id: string; name: string }[] }> = {
  openai: {
    label: "OpenAI",
    models: [
      { id: "gpt-4o-mini", name: "GPT-4o Mini (nhanh, rẻ)" },
      { id: "gpt-4o", name: "GPT-4o (chất lượng cao)" },
      { id: "gpt-4.1-mini", name: "GPT-4.1 Mini" },
      { id: "gpt-4.1", name: "GPT-4.1" },
    ],
  },
  gemini: {
    label: "Google Gemini",
    models: [
      { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash (nhanh)" },
      { id: "gemini-2.5-flash-preview-05-20", name: "Gemini 2.5 Flash" },
      { id: "gemini-2.5-pro-preview-05-06", name: "Gemini 2.5 Pro" },
    ],
  },
  anthropic: {
    label: "Anthropic Claude",
    models: [
      { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4" },
      { id: "claude-3-5-haiku-20241022", name: "Claude 3.5 Haiku (nhanh)" },
    ],
  },
  custom: {
    label: "Custom",
    models: [],
  },
};
