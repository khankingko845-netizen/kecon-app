import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveApiKey, resolveCustomBaseUrl, getSystemSetting } from "@/lib/server-settings";

/**
 * Personalize a story for a specific child.
 * POST { storyId, childName, childAge, interests?, petName?, petType? }
 * Creates a new personalized copy of the story.
 */
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
    storyId,
    childName,
    childAge,
    interests,
    petName,
    petType,
    provider: userProvider,
    model: userModel,
    apiKey: userKey,
    baseUrl: userBaseUrl,
  } = body;

  if (!storyId || !childName) {
    return Response.json({ error: "Cần storyId và tên bé" }, { status: 400 });
  }

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

  // Resolve AI provider
  const provider = userProvider || await getSystemSetting("default_story_provider") || "openai";
  const model = userModel || await getSystemSetting("default_ai_model") || "gpt-4o-mini";
  const apiKey = await resolveApiKey(provider, userKey);
  if (!apiKey) {
    return Response.json(
      { error: `Chưa cấu hình API key cho ${provider}` },
      { status: 400 }
    );
  }

  const baseUrl = provider === "custom"
    ? await resolveCustomBaseUrl(userBaseUrl)
    : provider === "openai"
    ? "https://api.openai.com/v1"
    : null;

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
    let raw: string;

    if (provider === "gemini") {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: [{ parts: [{ text: userPrompt }] }],
          generationConfig: { temperature: 0.7, responseMimeType: "application/json" },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "Gemini error");
      raw = data.candidates[0].content.parts[0].text;
    } else if (provider === "anthropic") {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "Content-Type": "application/json",
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: 4096,
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "Anthropic error");
      raw = data.content[0].text;
    } else {
      const endpoint = baseUrl
        ? `${baseUrl.replace(/\/+$/, "")}/chat/completions`
        : "https://api.openai.com/v1/chat/completions";
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
          temperature: 0.7,
          response_format: { type: "json_object" },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "AI error");
      raw = data.choices[0].message.content;
    }

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Invalid JSON");
    const parsed = JSON.parse(jsonMatch[0]);

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
