/**
 * Shared server flow for illustrating one stored story page: builds the
 * prompt from the page + character bible, generates, uploads to the
 * `illustrations` bucket and stores the public URL (never overwriting a
 * picture that appeared meanwhile unless `replace`).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildIllustrationPrompt } from "@/lib/illustration-prompt";
import {
  IllustrationError,
  generateIllustration,
  uploadIllustration,
  type IllustrationTarget,
} from "@/lib/illustration";

export interface StoredPage {
  id: string;
  page_number: number;
  content: string | null;
  scene_description: string | null;
  illustration_prompt?: string | null;
  mood?: string | null;
  illustration_url?: string | null;
}

export interface StoryForIllustration {
  id: string;
  title: string | null;
  user_id: string | null;
  illustration_style?: string | null;
  cover_image_url?: string | null;
}

export async function loadBible(supabase: SupabaseClient, storyId: string) {
  const { data } = await supabase
    .from("story_characters")
    .select("name, description, appearance, role")
    .eq("story_id", storyId)
    .order("sort_order");
  return (data ?? []) as { name: string; description: string | null; appearance: string | null; role: string | null }[];
}

export async function illustrateStoredPage(
  supabase: SupabaseClient,
  target: IllustrationTarget,
  uploaderId: string,
  story: StoryForIllustration,
  page: StoredPage,
  opts: { style?: string | null; bible?: Awaited<ReturnType<typeof loadBible>>; replace?: boolean } = {},
): Promise<{ url: string; stored: boolean }> {
  const bible = opts.bible ?? (await loadBible(supabase, story.id));
  const prompt = buildIllustrationPrompt({
    style: opts.style ?? story.illustration_style,
    title: story.title,
    illustration: page.illustration_prompt,
    sceneDescription: page.scene_description,
    text: page.content,
    mood: page.mood,
    characters: bible,
  });
  const image = await generateIllustration(target, prompt);
  const url = await uploadIllustration(supabase, uploaderId, story.id, page.page_number, image);
  let update = supabase.from("story_pages").update({ illustration_url: url }).eq("id", page.id);
  if (!opts.replace) update = update.is("illustration_url", null);
  const { data: updated, error } = await update.select("id");
  if (error) throw new IllustrationError(`Không lưu được ảnh: ${error.message}`, 500);
  const stored = Boolean(updated && updated.length);
  if (stored && page.page_number === 1 && !story.cover_image_url) {
    await supabase.from("stories").update({ cover_image_url: url }).eq("id", story.id).is("cover_image_url", null);
  }
  return { url, stored };
}
