import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateStory } from "@/lib/story-ai";

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
    apiKey: userKey,
    persist = true,
  } = body;

  if (!provider || !model || !theme || !childName || !age) {
    return Response.json({ error: "Missing required fields" }, { status: 400 });
  }

  // BYO-key: prefer the user's own key (their account), fall back to server env.
  const envKeyMap: Record<string, string | undefined> = {
    openai: process.env.OPENAI_API_KEY,
    gemini: process.env.GEMINI_API_KEY,
    anthropic: process.env.ANTHROPIC_API_KEY,
  };
  const apiKey = userKey || envKeyMap[provider];
  if (!apiKey) {
    return Response.json(
      { error: `Chưa cấu hình API key cho ${provider}` },
      { status: 400 }
    );
  }

  try {
    const story = await generateStory(provider, apiKey, model, {
      theme,
      childName,
      age,
      language: language || "vi",
      extraPrompt,
    });

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
