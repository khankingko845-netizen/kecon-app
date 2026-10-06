import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateStory } from "@/lib/story-ai";
import { guardUsage } from "@/lib/usage-guard";
import { resolveLlmTarget } from "@/lib/llm-config";
import { z } from "zod";
import { languageCode, llmSelectionFields, optionalText, parseJsonBody, requiredText } from "@/lib/api-validation";

const CATEGORY_MAP: Record<string, string> = {
  cotich: "fairy_tale",
  phieuluu: "adventure",
  ngungon: "bedtime",
  dongvat: "animal",
  hocchoi: "educational",
  tuviet: "custom",
};

const GenerateBody = z.object({
  ...llmSelectionFields,
  theme: requiredText(40),
  age: z.union([requiredText(20), z.number().int().min(0).max(18).transform(String)]),
  childName: optionalText(60),
  language: languageCode,
  extraPrompt: optionalText(1000),
  voiceId: optionalText(120),
  narratorVoiceId: optionalText(120),
  narratorVoiceName: optionalText(120),
  persist: z.boolean().default(true),
});

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = await parseJsonBody(request, GenerateBody);
  if (!parsed.ok) return parsed.response;
  const {
    theme,
    childName,
    age,
    language,
    extraPrompt,
    voiceId,
    narratorVoiceId,
    narratorVoiceName,
    persist,
  } = parsed.data;

  // Provider/model/key/base URL: BYO → client choice; platform key → admin defaults
  const llm = await resolveLlmTarget(parsed.data);
  if (!llm.ok) return llm.response;
  const { target } = llm;

  const usageBlocked = await guardUsage(supabase, "story", { byo: llm.byo });
  if (usageBlocked) return usageBlocked;

  try {
    const story = await generateStory(
      target.provider,
      target.apiKey,
      target.model,
      {
        theme,
        childName: childName || "",
        age,
        language: language || "vi",
        extraPrompt,
      },
      target.baseUrl
    );

    let storyId: string | null = null;

    if (persist) {
      const ageNums = String(age).match(/\d+/g)?.map(Number) ?? [0, 12];
      const { data: storyRow, error: storyErr } = await supabase
        .from("stories")
        .insert({
          user_id: user.id,
          title: story.title,
          description: story.summary,
          category: CATEGORY_MAP[theme] || "custom",
          theme,
          target_age_min: ageNums[0] ?? 0,
          target_age_max: ageNums[1] ?? ageNums[0] ?? 12,
          voice_id: voiceId || null,
          narrator_voice_id: narratorVoiceId || null,
          narrator_voice_name: narratorVoiceName || null,
          locale: language || "vi",
          page_count: story.pages.length,
          source: "ai",
          status: "draft",
        })
        .select("id")
        .single();

      if (storyErr) throw new Error(storyErr.message);
      storyId = storyRow.id;

      const pageRows = story.pages.map((p, i) => ({
        story_id: storyId,
        page_number: i + 1,
        content: p.text,
        scene_description: p.sceneDescription,
      }));
      const { error: pagesErr } = await supabase
        .from("story_pages")
        .insert(pageRows);
      if (pagesErr) throw new Error(pagesErr.message);

      // Auto-create characters from AI response
      if (story.characters && Array.isArray(story.characters) && story.characters.length > 0) {
        const CHARACTER_COLORS = ["#EF4444", "#F59E0B", "#10B981", "#3B82F6", "#8B5CF6", "#EC4899"];
        const charRows = story.characters.map((c: { name: string; description?: string; emoji?: string }, i: number) => ({
          story_id: storyId,
          name: c.name,
          description: c.description || null,
          emoji: c.emoji || null,
          color: CHARACTER_COLORS[i % CHARACTER_COLORS.length],
          sort_order: i,
        }));
        await supabase.from("story_characters").insert(charRows);
      }

      await supabase.from("user_behavior").insert({
        user_id: user.id,
        action_type: "create",
        story_id: storyId,
        metadata: { theme, provider: target.provider, model: target.model },
      });
    }

    return Response.json({ ...story, storyId });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Story generation failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
