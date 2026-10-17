import { withAiContext } from "@/lib/ai-metering";
import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { guardUsage } from "@/lib/usage-guard";
import { rejectByoKeyUnlessAllowed } from "@/lib/byo-key";
import { z } from "zod";
import { optionalText, parseJsonBody, requiredText } from "@/lib/api-validation";
import { IllustrationError, generateIllustration, resolveIllustrationTarget, uploadIllustration } from "@/lib/illustration";
import { buildIllustrationPrompt } from "@/lib/illustration-prompt";

const IllustrateBody = z.object({
  prompt: requiredText(1000),
  apiKey: optionalText(512),
  // Accepted for older clients; pictures are always 3:2 landscape now.
  size: z.enum(["1024x1024", "1792x1024", "1024x1792", "1536x1024", "1024x1536"]).nullish(),
  style: optionalText(20),
});

export const maxDuration = 180;

// Free-form illustration (Story Editor). Uses GPT Image / Gemini image and
// uploads the result, so the returned URL does not expire.
export async function POST(request: NextRequest) {
  return withAiContext("story.illustrate", async (request) => {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const parsed = await parseJsonBody(request, IllustrateBody);
    if (!parsed.ok) return parsed.response;
    const byoBlocked = await rejectByoKeyUnlessAllowed(supabase, user.id, parsed.data.apiKey);
    if (byoBlocked) return byoBlocked;
    const { prompt, apiKey: userKey, style } = parsed.data;

    const target = await resolveIllustrationTarget(userKey);
    if (!target) {
      return Response.json(
        { error: "Chưa cấu hình dịch vụ vẽ tranh (OpenAI hoặc Gemini). Admin cần thêm key trong Cài Đặt Hệ Thống." },
        { status: 400 },
      );
    }

    const usageBlocked = await guardUsage(supabase, "illustration", { byo: Boolean(userKey) });
    if (usageBlocked) return usageBlocked;

    try {
      const image = await generateIllustration(target, buildIllustrationPrompt({ style, illustration: prompt }));
      const url = await uploadIllustration(supabase, user.id, "editor", Date.now() % 100000, image);
      return Response.json({ url });
    } catch (err) {
      const status = err instanceof IllustrationError ? err.status : 500;
      return Response.json({ error: err instanceof Error ? err.message : "Tạo minh hoạ thất bại" }, { status });
    }
  })(request);
}
