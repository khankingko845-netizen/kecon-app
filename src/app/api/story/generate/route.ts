import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateStory } from "@/lib/story-ai";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { provider, model, theme, childName, age, language, extraPrompt } =
    body;

  if (!provider || !model || !theme || !childName || !age) {
    return Response.json(
      { error: "Missing required fields" },
      { status: 400 }
    );
  }

  const apiKeyMap: Record<string, string | undefined> = {
    openai: process.env.OPENAI_API_KEY,
    gemini: process.env.GEMINI_API_KEY,
    anthropic: process.env.ANTHROPIC_API_KEY,
  };

  const apiKey = apiKeyMap[provider];
  if (!apiKey) {
    return Response.json(
      { error: `${provider} API key not configured on server` },
      { status: 500 }
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

    return Response.json(story);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Story generation failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
