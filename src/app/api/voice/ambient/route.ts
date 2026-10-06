import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { keyPoolErrorResponse, voiceKeyPool } from "@/lib/key-pool";
import { scrubSecret } from "@/lib/system-secrets";
import { generateAmbientSound, getAmbientCategory, matchAmbientCategory } from "@/lib/ambient-sounds";
import { guardUsage } from "@/lib/usage-guard";
import { rejectByoKeyUnlessAllowed } from "@/lib/byo-key";
import { z } from "zod";
import { optionalText, parseJsonBody } from "@/lib/api-validation";

const AmbientBody = z.object({
  sceneDescription: optionalText(500),
  categoryId: optionalText(60),
  customPrompt: optionalText(450),
  apiKey: optionalText(512),
  // ElevenLabs sound generation supports 0.5–22 s
  duration: z.number().min(0.5).max(22).nullish(),
});

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = await parseJsonBody(request, AmbientBody);
  if (!parsed.ok) return parsed.response;
  const byoBlocked = await rejectByoKeyUnlessAllowed(supabase, user.id, parsed.data.apiKey);
  if (byoBlocked) return byoBlocked;
  const { sceneDescription, categoryId, customPrompt, apiKey: userKey, duration } = parsed.data;

  // A-04b: user BYO key, else the platform pool (many ElevenLabs keys, rotated).
  if (!userKey && !(await voiceKeyPool.configured("elevenlabs"))) {
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

  const usageBlocked = await guardUsage(supabase, "tts", { byo: Boolean(userKey) });
  if (usageBlocked) return usageBlocked;

  try {
    const generate = async (key: string) => (await generateAmbientSound(key, prompt, duration || 10)).arrayBuffer();
    const arrayBuffer = userKey ? await generate(userKey) : await voiceKeyPool.run("elevenlabs", generate);

    return new Response(arrayBuffer, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (err) {
    if (userKey) {
      const message = err instanceof Error ? scrubSecret(err.message, userKey) : "Sound generation failed";
      return Response.json({ error: message }, { status: 500 });
    }
    return keyPoolErrorResponse(err, "Sound generation failed");
  }
}
