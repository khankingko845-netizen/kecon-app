import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StoryRow } from "@/lib/db";

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: mocks.createClient }));

import { getRecommendations } from "@/lib/recommendations";

function story(p: Partial<StoryRow> & { id: string }): StoryRow {
  return {
    category: "adventure",
    theme: null,
    target_age_min: 3,
    target_age_max: 8,
    play_count: 0,
    is_published: true,
    status: "published",
    ...p,
  } as StoryRow;
}

/** Thenable query builder: every filter returns itself; awaiting resolves to `result(table, select)`. */
function fakeClient(opts: {
  user: { id: string } | null;
  stories: StoryRow[];
  behavior?: Array<{ story_id: string; action_type: string }>;
}) {
  const from = (table: string) => {
    let selected = "";
    const q = {
      select(cols: string) {
        selected = cols;
        return q;
      },
      or: () => q,
      order: () => q,
      limit: () => q,
      eq: () => q,
      in: (_col: string, values: string[]) => {
        if (table === "stories" && selected === "id, category") {
          return Promise.resolve({ data: opts.stories.filter((s) => values.includes(s.id)) });
        }
        return q;
      },
      then(resolve: (v: { data: unknown }) => unknown) {
        if (table === "stories") return Promise.resolve(resolve({ data: opts.stories }));
        if (table === "user_behavior") return Promise.resolve(resolve({ data: opts.behavior ?? [] }));
        return Promise.resolve(resolve({ data: [] }));
      },
    };
    return q;
  };
  return {
    auth: { getUser: async () => ({ data: { user: opts.user } }) },
    from,
  };
}

const catalog = [
  story({ id: "bedtime-1", category: "bedtime", play_count: 1 }),
  story({ id: "adv-popular", category: "adventure", play_count: 50 }),
  story({ id: "animal-1", category: "animal", play_count: 0 }),
  story({ id: "teen-1", category: "educational", target_age_min: 12, target_age_max: 15, play_count: 0 }),
];

beforeEach(() => mocks.createClient.mockReset());

describe("getRecommendations", () => {
  it("buổi tối: truyện ru ngủ được ưu tiên trong 'Dành cho bé'", async () => {
    mocks.createClient.mockReturnValue(fakeClient({ user: null, stories: catalog }));
    const { forYou, bedtime } = await getRecommendations({ hour: 20, childAge: "4-6" });

    expect(forYou[0].story.id).toBe("bedtime-1");
    expect(bedtime.map((s) => s.id)).toEqual(["bedtime-1"]);
  });

  it("ban ngày + không có lịch sử: truyện phổ biến đúng tuổi lên đầu, truyện sai độ tuổi bị loại", async () => {
    mocks.createClient.mockReturnValue(fakeClient({ user: null, stories: catalog }));
    const { forYou } = await getRecommendations({ hour: 10, childAge: "4-6" });

    expect(forYou[0].story.id).toBe("adv-popular");
    expect(forYou[0].reason).toBe("đúng độ tuổi");
    expect(forYou.map((s) => s.story.id)).not.toContain("teen-1");
  });

  it("lịch sử nghe của bé (theo danh mục) được ưu tiên hơn độ phổ biến", async () => {
    mocks.createClient.mockReturnValue(
      fakeClient({
        user: { id: "u1" },
        stories: catalog,
        behavior: [
          { story_id: "animal-1", action_type: "play" },
          { story_id: "animal-1", action_type: "complete" },
        ],
      })
    );
    const { forYou } = await getRecommendations({ hour: 10, childAge: "4-6" });

    expect(forYou[0].story.id).toBe("animal-1");
    expect(forYou[0].reason).toBe("hợp sở thích của bé");
  });

  it("'Thịnh hành' sắp theo lượt nghe; 'Khám phá' không trùng 'Dành cho bé'", async () => {
    const many = Array.from({ length: 10 }, (_, i) => story({ id: `s${i}`, play_count: i }));
    mocks.createClient.mockReturnValue(fakeClient({ user: null, stories: many }));
    const { trending, forYou, discover } = await getRecommendations({ hour: 10, childAge: "4-6" });

    expect(trending.map((s) => s.id)).toEqual(["s9", "s8", "s7", "s6", "s5", "s4"]);
    const forYouIds = new Set(forYou.map((s) => s.story.id));
    expect(discover.length).toBeGreaterThan(0);
    expect(discover.every((s) => !forYouIds.has(s.id))).toBe(true);
  });
});
