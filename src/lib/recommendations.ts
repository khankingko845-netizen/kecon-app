"use client";

import { createClient } from "@/lib/supabase/client";
import type { StoryRow } from "@/lib/db";

export interface RecommendationContext {
  childAge?: string; // e.g. "4-6"
  hour?: number; // 0-23, defaults to now
}

export interface ScoredStory {
  story: StoryRow;
  score: number;
  reason: string;
}

export interface RecommendationGroups {
  forYou: ScoredStory[];
  trending: StoryRow[];
  bedtime: StoryRow[];
  discover: StoryRow[];
}

function parseAgeRange(age?: string): [number, number] {
  if (!age) return [0, 99];
  const nums = age.match(/\d+/g)?.map(Number) ?? [];
  if (nums.length >= 2) return [nums[0], nums[1]];
  if (nums.length === 1) return [nums[0], nums[0] + 2];
  return [0, 99];
}

// Context-aware recommendation engine. Uses the user's own behavior history
// (which categories they play most), time of day, the child's age, and global
// popularity to rank published stories. Lightweight and deterministic — no
// external embedding service required.
export async function getRecommendations(
  ctx: RecommendationContext = {}
): Promise<RecommendationGroups> {
  const supabase = createClient();
  const hour = ctx.hour ?? new Date().getHours();
  const [ageMin, ageMax] = parseAgeRange(ctx.childAge);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Published stories visible to everyone (+ the user's own).
  const { data: stories } = await supabase
    .from("stories")
    .select("*")
    .or("is_published.eq.true,status.eq.published")
    .order("play_count", { ascending: false })
    .limit(60);

  const all = (stories ?? []) as StoryRow[];

  // Behavior: count plays per category for this user.
  const categoryAffinity = new Map<string, number>();
  if (user) {
    const { data: behavior } = await supabase
      .from("user_behavior")
      .select("story_id, action_type")
      .eq("user_id", user.id)
      .in("action_type", ["play", "like", "complete"])
      .limit(200);

    const playedIds = (behavior ?? [])
      .map((b) => b.story_id)
      .filter(Boolean) as string[];
    if (playedIds.length) {
      const { data: playedStories } = await supabase
        .from("stories")
        .select("id, category")
        .in("id", playedIds);
      (playedStories ?? []).forEach((s) => {
        categoryAffinity.set(
          s.category,
          (categoryAffinity.get(s.category) ?? 0) + 1
        );
      });
    }
  }

  const isEvening = hour >= 19 || hour <= 5;

  const forYou: ScoredStory[] = all
    .map((story) => {
      let score = 0;
      const reasons: string[] = [];

      const affinity = categoryAffinity.get(story.category) ?? 0;
      if (affinity > 0) {
        score += affinity * 3;
        reasons.push("hợp sở thích của bé");
      }

      // Age match.
      if (story.target_age_max >= ageMin && story.target_age_min <= ageMax) {
        score += 2;
        reasons.push("đúng độ tuổi");
      }

      // Time of day.
      if (isEvening && (story.category === "bedtime" || story.theme === "ngungon")) {
        score += 3;
        reasons.push("truyện ru ngủ buổi tối");
      }

      // Popularity nudge.
      score += Math.min(story.play_count, 10) * 0.2;
      if (story.play_count > 5) reasons.push("đang được yêu thích");

      return {
        story,
        score,
        reason: reasons[0] ?? "gợi ý cho gia đình bạn",
      };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

  const trending = [...all]
    .sort((a, b) => b.play_count - a.play_count)
    .slice(0, 6);

  const bedtime = all
    .filter((s) => s.category === "bedtime" || s.theme === "ngungon")
    .slice(0, 6);

  const recommendedIds = new Set(forYou.map((s) => s.story.id));
  const discover = all
    .filter((s) => !recommendedIds.has(s.id))
    .sort(() => Math.random() - 0.5)
    .slice(0, 6);

  return { forYou, trending, bedtime, discover };
}
