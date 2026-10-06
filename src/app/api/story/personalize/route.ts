import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { guardUsage } from "@/lib/usage-guard";
import { rejectByoKeyUnlessAllowed } from "@/lib/byo-key";
import { resolveLlmTarget } from "@/lib/llm-config";
import { callLlmJson } from "@/lib/llm";
import { z } from "zod";
import { llmSelectionFields, optionalText, parseJsonBody, requiredText, uuid } from "@/lib/api-validation";

/**
 * Personalize a story for a specific child.
 * POST { storyId, childName, childAge, interests?, petName?, petType? }
 * Creates a new personalized copy of the story.
 */
const PersonalizeBody = z.object({
  ...llmSelectionFields,
  storyId: uuid,
  childName: requiredText(60),
  childAge: z.union([optionalText(20), z.number().int().min(0).max(18).transform(String)]),
  interests: optionalText(300),
  petName: optionalText(60),
  petType: optionalText(60),
});

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsedBody = await parseJsonBody(request, PersonalizeBody);
  if (!parsedBody.ok) return parsedBody.response;
  const byoBlocked = await rejectByoKeyUnlessAllowed(supabase, user.id, parsedBody.data.apiKey);
  if (byoBlocked) return byoBlocked;
  const { storyId, childName, childAge, interests, petName, petType } = parsedBody.data;

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

  const llm = await resolveLlmTarget(parsedBody.data);
  if (!llm.ok) return llm.response;

  const usageBlocked = await guardUsage(supabase, "ai", { byo: llm.byo });
  if (usageBlocked) return usageBlocked;

  // Build personalization context
  const childContext = [
    `Tên bé: ${childName}`,
    childAge ? `Tuổi: ${childAge}` : null,
    interests ? `Sở thích: ${interests}` : null,
    petName && petType ? `Thú cưng: ${petName} (${petType})` : null,
  ].filter(Boolean).join(", ");

  const originalContent = pages
    .map((p) => `[Trang ${p.page_number}]\n${p.content}`)
    .join("\n\n");

  const systemPrompt = `Bạn là chuyên gia cá nhân hóa truyện thiếu nhi. Nhiệm vụ: viết lại truyện để đưa bé vào nhân vật chính, giữ nguyên cốt truyện và bài học.

QUY TẮC:
1. Thay thế nhân vật chính bằng tên bé, giữ nguyên các nhân vật phụ
2. Nếu bé có thú cưng, đưa thú cưng vào truyện như bạn đồng hành
3. Thêm chi tiết liên quan đến sở thích của bé (nếu có) một cách tự nhiên
4. Giữ nguyên số trang, cấu trúc và bài học đạo đức
5. Giữ nguyên voice markup [narrator]...[/narrator] và [character:Tên]...[/character]
6. Điều chỉnh từ vựng phù hợp với độ tuổi
7. Giữ sceneDescription phù hợp với nội dung mới

Trả về JSON: { "title": "...", "pages": [{ "text": "...", "sceneDescription": "..." }] }`;

  const userPrompt = `Thông tin bé: ${childContext}

Truyện gốc: "${story.title}"
${originalContent}

Hãy cá nhân hóa truyện này cho bé ${childName}. Trả về JSON.`;

  try {
    const { data } = await callLlmJson({
      ...llm.target,
      system: systemPrompt,
      prompt: userPrompt,
      temperature: 0.7,
    });
    const parsed = data as { title?: string; pages?: { text: string; sceneDescription?: string }[] };

    // Create personalized copy
    const { data: newStory, error: insertErr } = await supabase
      .from("stories")
      .insert({
        user_id: user.id,
        title: parsed.title || `${story.title} (cho ${childName})`,
        description: story.description,
        category: story.category,
        theme: story.theme,
        target_age_min: story.target_age_min,
        target_age_max: story.target_age_max,
        voice_id: story.voice_id,
        narrator_voice_id: story.narrator_voice_id,
        narrator_voice_name: story.narrator_voice_name,
        locale: story.locale,
        page_count: parsed.pages?.length || story.page_count,
        source: "ai",
        status: "draft",
        tags: [...(story.tags || []), "personalized"],
        moral_lesson: story.moral_lesson,
        metadata: {
          personalized_for: childName,
          original_story_id: storyId,
          child_age: childAge,
          interests,
        },
      })
      .select("id")
      .single();

    if (insertErr) throw new Error(insertErr.message);

    // Insert personalized pages
    const pageRows = (parsed.pages || []).map(
      (p: { text: string; sceneDescription?: string }, i: number) => ({
        story_id: newStory.id,
        page_number: i + 1,
        content: p.text,
        scene_description: p.sceneDescription || pages[i]?.scene_description || "",
      })
    );
    await supabase.from("story_pages").insert(pageRows);

    return Response.json({
      storyId: newStory.id,
      title: parsed.title,
      pageCount: pageRows.length,
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Cá nhân hóa thất bại" },
      { status: 500 }
    );
  }
}
