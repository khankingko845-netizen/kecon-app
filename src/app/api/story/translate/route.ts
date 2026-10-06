import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { guardUsage } from "@/lib/usage-guard";
import { rejectByoKeyUnlessAllowed } from "@/lib/byo-key";
import { resolveLlmTarget } from "@/lib/llm-config";
import { callLlmJson } from "@/lib/llm";
import { z } from "zod";
import { optionalText, parseJsonBody, uuid } from "@/lib/api-validation";

/**
 * Translate a story to another language.
 * POST { storyId, targetLanguage, apiKey? }
 * Creates a new translated copy of the story.
 */
const TranslateBody = z.object({
  storyId: uuid,
  targetLanguage: z.enum(["vi", "en", "ja", "ko", "zh", "fr", "de", "es", "th"]),
  apiKey: optionalText(512),
  bilingual: z.boolean().default(false),
});

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsedBody = await parseJsonBody(request, TranslateBody);
  if (!parsedBody.ok) return parsedBody.response;
  const byoBlocked = await rejectByoKeyUnlessAllowed(supabase, user.id, parsedBody.data.apiKey);
  if (byoBlocked) return byoBlocked;
  const { storyId, targetLanguage, apiKey: userKey, bilingual } = parsedBody.data;

  // Get original story + pages
  const { data: story } = await supabase
    .from("stories")
    .select("*")
    .eq("id", storyId)
    .single();
  if (!story) {
    return Response.json({ error: "Không tìm thấy truyện" }, { status: 404 });
  }

  const { data: pages } = await supabase
    .from("story_pages")
    .select("*")
    .eq("story_id", storyId)
    .order("page_number");
  if (!pages || pages.length === 0) {
    return Response.json({ error: "Truyện không có nội dung" }, { status: 404 });
  }

  // Platform key → admin default provider/model; BYO key → admin default provider with the user's key
  const llm = await resolveLlmTarget({ apiKey: userKey });
  if (!llm.ok) return llm.response;

  const usageBlocked = await guardUsage(supabase, "ai", { byo: llm.byo });
  if (usageBlocked) return usageBlocked;

  const langNames: Record<string, string> = {
    vi: "Tiếng Việt",
    en: "English",
    ja: "日本語",
    ko: "한국어",
    zh: "中文",
    fr: "Français",
    de: "Deutsch",
    es: "Español",
    th: "ภาษาไทย",
  };

  const sourceLang = langNames[story.locale] || story.locale;
  const targetLang = langNames[targetLanguage] || targetLanguage;

  const originalContent = pages
    .map((p) => `[Trang ${p.page_number}]\n${p.content}`)
    .join("\n\n");

  const bilingualInstruction = bilingual
    ? `\nCHẾ ĐỘ SONG NGỮ: Mỗi trang gồm cả 2 ngôn ngữ xen kẽ từng câu.
Ví dụ:
[narrator]Ngày xưa có một chú Sóc.[/narrator]
[narrator]Once upon a time, there was a little Squirrel.[/narrator]`
    : "";

  const systemPrompt = `Bạn là chuyên gia dịch thuật truyện thiếu nhi. Dịch truyện từ ${sourceLang} sang ${targetLang}.

QUY TẮC:
1. Giữ tone nhẹ nhàng, dễ hiểu phù hợp trẻ em
2. Giữ nguyên cấu trúc voice markup [narrator]...[/narrator] và [character:Tên]...[/character]
3. Dịch tên nhân vật cho tự nhiên (hoặc giữ nguyên nếu là tên riêng)
4. Giữ nguyên số trang
5. Dịch cả sceneDescription
6. Giữ emoji và ký hiệu đặc biệt${bilingualInstruction}

Trả về JSON: { "title": "...", "pages": [{ "text": "...", "sceneDescription": "..." }] }`;

  const userPrompt = `Dịch truyện "${story.title}" từ ${sourceLang} sang ${targetLang}${bilingual ? " (chế độ song ngữ)" : ""}:\n\n${originalContent}`;

  try {
    const { data } = await callLlmJson({
      ...llm.target,
      system: systemPrompt,
      prompt: userPrompt,
      temperature: 0.5,
    });
    const parsed = data as { title?: string; pages?: { text: string; sceneDescription?: string }[] };

    // Create translated copy
    const newLocale = bilingual ? `${story.locale}-${targetLanguage}` : targetLanguage;
    const { data: newStory, error: insertErr } = await supabase
      .from("stories")
      .insert({
        user_id: user.id,
        title: parsed.title || `${story.title} (${targetLang})`,
        description: story.description,
        category: story.category,
        theme: story.theme,
        target_age_min: story.target_age_min,
        target_age_max: story.target_age_max,
        voice_id: null, // Voice needs to be re-selected for new language
        locale: newLocale,
        page_count: parsed.pages?.length || story.page_count,
        source: "ai",
        status: "draft",
        tags: [...(story.tags || []), "translated", bilingual ? "bilingual" : targetLanguage],
        moral_lesson: story.moral_lesson,
        metadata: {
          translated_from: storyId,
          source_language: story.locale,
          target_language: targetLanguage,
          bilingual,
        },
      })
      .select("id")
      .single();

    if (insertErr) throw new Error(insertErr.message);

    const pageRows = (parsed.pages || []).map(
      (p: { text: string; sceneDescription?: string }, i: number) => ({
        story_id: newStory.id,
        page_number: i + 1,
        content: p.text,
        scene_description: p.sceneDescription || pages[i]?.scene_description || "",
        // Keep original illustrations
        illustration_url: pages[i]?.illustration_url || null,
      })
    );
    await supabase.from("story_pages").insert(pageRows);

    return Response.json({
      storyId: newStory.id,
      title: parsed.title,
      locale: newLocale,
      pageCount: pageRows.length,
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Dịch truyện thất bại" },
      { status: 500 }
    );
  }
}
