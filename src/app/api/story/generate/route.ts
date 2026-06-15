import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateStory } from "@/lib/story-ai";
import { resolveApiKey, resolveCustomBaseUrl, getSystemSetting } from "@/lib/server-settings";

const CATEGORY_MAP: Record<string, string> = {
  cotich: "fairy_tale",
  phieuluu: "adventure",
  ngungon: "bedtime",
  dongvat: "animal",
  hocchoi: "educational",
  tuviet: "custom",
};

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const {
    provider,
    model,
    theme,
    childName,
    age,
    language,
    extraPrompt,
    voiceId,
    narratorVoiceId,
    narratorVoiceName,
    apiKey: userKey,
    baseUrl: userBaseUrl,
    persist = true,
  } = body;

  // Resolve model: user BYO → admin DB → provider default
  const resolvedModel = model || await getSystemSetting("default_ai_model") || "gpt-4o-mini";

  if (!provider || !resolvedModel || !theme || !age) {
    return Response.json({ error: "Missing required fields" }, { status: 400 });
  }

  // Resolve API key: user BYO → admin DB → env variable
  const apiKey = await resolveApiKey(provider, userKey);
  if (!apiKey) {
    return Response.json(
      { error: `Chưa cấu hình API key cho ${provider}. Admin cần thêm key trong Cài Đặt Hệ Thống.` },
      { status: 400 }
    );
  }

  // Resolve base URL for custom provider
  const baseUrl = provider === "custom"
    ? await resolveCustomBaseUrl(userBaseUrl)
    : undefined;

  if (provider === "custom" && !baseUrl) {
    return Response.json(
      { error: "Custom provider cần Base URL (OpenAI-compatible)" },
      { status: 400 }
    );
  }

  try {
    const story = await generateStory(
      provider,
      apiKey,
      resolvedModel,
      {
        theme,
        childName: childName || "",
        age,
        language: language || "vi",
        extraPrompt,
      },
      baseUrl
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
        metadata: { theme, provider, model },
      });
    }

    return Response.json({ ...story, storyId });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Story generation failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
