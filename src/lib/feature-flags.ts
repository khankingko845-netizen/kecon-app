import type { Screen } from "@/lib/types";
/** M0 T06: boolean kill switches only; percentages/household targeting remain A-11/T08. */
export const FEATURES = [
  {
    key: "gamification",
    label: "Thử thách & huy hiệu",
    description: "Gamification ngoài vòng lõi v1",
    enabled: false,
  },
  {
    key: "story_drawing",
    label: "Truyện từ hình vẽ",
    description: "Gửi hình vẽ cho AI tạo truyện",
    enabled: false,
  },
  {
    key: "book_scan",
    label: "Chụp/scan sách",
    description: "Nhận dạng trang sách qua AI",
    enabled: false,
  },
  {
    key: "expert_review",
    label: "Đánh giá chuyên gia AI",
    description: "Nhận xét truyện qua LLM",
    enabled: false,
  },
  {
    key: "branching_stories",
    label: "Truyện rẽ nhánh",
    description: "Phiêu lưu và lựa chọn nhánh",
    enabled: false,
  },
  {
    key: "vocabulary_quiz",
    label: "Từ vựng & câu đố",
    description: "Quiz và trích từ vựng qua AI",
    enabled: false,
  },
  {
    key: "multilingual",
    label: "Ngôn ngữ ngoài tiếng Việt",
    description: "Tạo/dịch/đọc truyện không phải tiếng Việt",
    enabled: false,
  },
  {
    key: "advanced_authoring",
    label: "Upload & biên tập nâng cao",
    description:
      "Chỉ nhân sự có stories.write và phiên quản trị hợp lệ; bật không cấp quyền cho gia đình",
    enabled: true,
  },
  {
    key: "ai_illustrations",
    label: "Minh hoạ AI",
    description: "Tạo ảnh từng trang; không xoá ảnh cũ",
    enabled: false,
  },
  { key: "ai_ambience", label: "Sinh âm nền AI", description: "Chỉ sinh file mới; âm nền có giấy phép vẫn phát bình thường", enabled: false },
  {
    key: "child_push",
    label: "Thông báo đẩy",
    description: "Push ngoài phạm vi v1; không ảnh hưởng thông báo trong app",
    enabled: false,
  },
] as const;
export type FeatureKey = (typeof FEATURES)[number]["key"];
export type FeatureFlags = Record<FeatureKey, boolean>;
export const FEATURE_KEYS = FEATURES.map((f) => f.key);
export const DEFAULT_FEATURE_FLAGS = Object.fromEntries(
  FEATURES.map((f) => [f.key, f.enabled]),
) as FeatureFlags;
export const CLOSED_FEATURE_FLAGS = Object.fromEntries(
  FEATURES.map((f) => [f.key, false]),
) as FeatureFlags;
export const SCREEN_FEATURE: Partial<Record<Screen, FeatureKey>> = {
  achievements: "gamification",
  "daily-challenges": "gamification",
  "draw-story": "story_drawing",
  "scan-book": "book_scan",
  adventure: "branching_stories",
  "vocab-quiz": "vocabulary_quiz",
  upload: "advanced_authoring",
  editor: "advanced_authoring",
};
export const API_FEATURE: Record<string, FeatureKey> = {
  "voice.ambient": "ai_ambience",
  "story.from-drawing": "story_drawing",
  "story.scan": "book_scan",
  "story.expert-review": "expert_review",
  "story.vocabulary": "vocabulary_quiz",
  "story.translate": "multilingual",
  "story.illustrate": "ai_illustrations",
  "story.illustrate-batch": "ai_illustrations",
};
export function isFeatureKey(v: unknown): v is FeatureKey {
  return (
    typeof v === "string" && (FEATURE_KEYS as readonly string[]).includes(v)
  );
}
/** Only explicitly true values from the allowlisted RPC enable a feature. Missing/malformed = off. */
export function parseFeatureFlags(v: unknown): FeatureFlags {
  const x = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  return Object.fromEntries(
    FEATURE_KEYS.map((k) => [k, x[k] === true]),
  ) as FeatureFlags;
}
export function canOpenFeatureScreen(
  screen: Screen,
  flags: FeatureFlags,
  canAuthor: boolean,
) {
  const key = SCREEN_FEATURE[screen];
  return !key || (flags[key] && (key !== "advanced_authoring" || canAuthor));
}
