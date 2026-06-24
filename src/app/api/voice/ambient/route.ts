import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveApiKey } from "@/lib/server-settings";
import { generateAmbientSound, getAmbientCategory, matchAmbientCategory } from "@/lib/ambient-sounds";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { sceneDescription, categoryId, customPrompt, apiKey: userKey, duration } = body;

  // Resolve ElevenLabs API key
  const apiKey = await resolveApiKey("elevenlabs", userKey);
  if (!apiKey) {
    return Response.json(
      { error: "Chưa cấu hình ElevenLabs API key" },
      { status: 400 }
    );
  }

  // Determine prompt: custom > category > auto-match from scene
  let prompt: string;
  if (customPrompt) {
    prompt = customPrompt;
  } else if (categoryId) {
    const cat = getAmbientCategory(categoryId);
    if (!cat) return Response.json({ error: "Invalid category" }, { status: 400 });
    prompt = cat.prompt;
  } else if (sceneDescription) {
    const matchedId = matchAmbientCategory(sceneDescription);
    if (!matchedId) {
      // Generate from scene description directly
      prompt = `ambient sound effect for children's story scene: ${sceneDescription}. Gentle, not scary, suitable for kids.`;
    } else {
      const cat = getAmbientCategory(matchedId);
      prompt = cat?.prompt || `ambient sound for: ${sceneDescription}`;
    }
  } else {
    return Response.json({ error: "Missing sceneDescription or categoryId" }, { status: 400 });
  }

  try {
    const audioBlob = await generateAmbientSound(apiKey, prompt, duration || 10);
    const arrayBuffer = await audioBlob.arrayBuffer();

    return new Response(arrayBuffer, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sound generation failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
