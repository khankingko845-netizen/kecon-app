"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

export type Locale = "vi" | "en" | "ja";

// Translation keys — add new keys here as features grow.
export interface Translations {
  // General
  loading: string;
  save: string;
  cancel: string;
  delete: string;
  back: string;
  confirm: string;
  search: string;
  // Auth
  login: string;
  signup: string;
  logout: string;
  email: string;
  password: string;
  // Nav
  home: string;
  library: string;
  create: string;
  voice: string;
  settings: string;
  // Home
  welcomeBack: string;
  recentStories: string;
  quickActions: string;
  createStory: string;
  recordVoice: string;
  myLibrary: string;
  admin: string;
  // Library
  libraryTitle: string;
  allFilter: string;
  fairyTale: string;
  adventure: string;
  bedtime: string;
  animal: string;
  educational: string;
  custom: string;
  emptyLibrary: string;
  noMatchingStories: string;
  createFirstStory: string;
  pages: string;
  // Player
  nowPlaying: string;
  voiceBy: string;
  lullaby: string;
  branching: string;
  favorite: string;
  soundMixer: string;
  aiAutoAmbient: string;
  visualEffects: string;
  aiAutoEffect: string;
  off: string;
  // Rating
  rateThisStory: string;
  writeReview: string;
  reviews: string;
  noReviews: string;
  submitReview: string;
  reviewPlaceholder: string;
  ratings: string;
  // Share
  shareStory: string;
  copyLink: string;
  linkCopied: string;
  shareVia: string;
  sharedStory: string;
  // Favorites
  favorites: string;
  noFavorites: string;
  addedToFavorites: string;
  removedFromFavorites: string;
  // Streaks
  readingStreak: string;
  currentStreak: string;
  longestStreak: string;
  totalStoriesRead: string;
  totalListenMinutes: string;
  days: string;
  // Settings
  settingsTitle: string;
  language: string;
  languageDesc: string;
  elevenLabsKey: string;
  aiProvider: string;
  // Editor
  storyEditor: string;
  addPage: string;
  publishStory: string;
  unpublish: string;
  draft: string;
  published: string;
  illustrateAI: string;
  regenerateIllustration: string;
  batchGenerateVoice: string;
  batchGenerateDesc: string;
  generating: string;
  // Create
  createStoryTitle: string;
  theme: string;
  childName: string;
  childAge: string;
  generateStory: string;
}

const vi: Translations = {
  loading: "Đang tải...",
  save: "Lưu",
  cancel: "Hủy",
  delete: "Xóa",
  back: "Quay lại",
  confirm: "Xác nhận",
  search: "Tìm kiếm",
  login: "Đăng nhập",
  signup: "Đăng ký",
  logout: "Đăng xuất",
  email: "Email",
  password: "Mật khẩu",
  home: "Trang chủ",
  library: "Thư viện",
  create: "Tạo mới",
  voice: "Giọng nói",
  settings: "Cài đặt",
  welcomeBack: "Xin chào",
  recentStories: "Truyện gần đây",
  quickActions: "Thao tác nhanh",
  createStory: "Tạo Truyện",
  recordVoice: "Ghi Âm",
  myLibrary: "Thư Viện",
  admin: "Quản trị",
  libraryTitle: "Thư Viện",
  allFilter: "Tất Cả",
  fairyTale: "Cổ Tích",
  adventure: "Phiêu Lưu",
  bedtime: "Ru Ngủ",
  animal: "Động Vật",
  educational: "Học Chơi",
  custom: "Tùy Chỉnh",
  emptyLibrary: "Thư viện trống",
  noMatchingStories: "Không có truyện phù hợp",
  createFirstStory: "Tạo truyện AI đầu tiên cho gia đình bạn",
  pages: "trang",
  nowPlaying: "Đang phát",
  voiceBy: "Giọng đọc",
  lullaby: "Ru Ngủ",
  branching: "Rẽ Nhánh",
  favorite: "Yêu Thích",
  soundMixer: "Trộn Âm Thanh",
  aiAutoAmbient: "AI tự chọn âm nền theo cảnh",
  visualEffects: "Hiệu Ứng Hình Ảnh",
  aiAutoEffect: "AI tự chọn",
  off: "Tắt",
  rateThisStory: "Đánh giá truyện này",
  writeReview: "Viết nhận xét",
  reviews: "Nhận xét",
  noReviews: "Chưa có nhận xét nào",
  submitReview: "Gửi nhận xét",
  reviewPlaceholder: "Chia sẻ cảm nhận của bạn về truyện này...",
  ratings: "đánh giá",
  shareStory: "Chia sẻ truyện",
  copyLink: "Sao chép link",
  linkCopied: "Đã sao chép!",
  shareVia: "Chia sẻ qua",
  sharedStory: "Truyện được chia sẻ",
  favorites: "Yêu Thích",
  noFavorites: "Chưa có truyện yêu thích",
  addedToFavorites: "Đã thêm vào yêu thích",
  removedFromFavorites: "Đã bỏ yêu thích",
  readingStreak: "Chuỗi đọc",
  currentStreak: "Chuỗi hiện tại",
  longestStreak: "Kỷ lục",
  totalStoriesRead: "Truyện đã đọc",
  totalListenMinutes: "Phút đã nghe",
  days: "ngày",
  settingsTitle: "Cài Đặt",
  language: "Ngôn ngữ",
  languageDesc: "Chọn ngôn ngữ hiển thị",
  elevenLabsKey: "ElevenLabs API Key",
  aiProvider: "AI Provider",
  storyEditor: "Soạn Truyện",
  addPage: "Thêm trang",
  publishStory: "Xuất bản",
  unpublish: "Gỡ xuất bản",
  draft: "Bản nháp",
  published: "Đã xuất bản",
  illustrateAI: "Minh hoạ AI",
  regenerateIllustration: "Tạo lại minh hoạ",
  batchGenerateVoice: "Tạo giọng đọc toàn bộ",
  batchGenerateDesc: "Tự động tạo TTS cho tất cả trang chưa có audio",
  generating: "Đang tạo...",
  createStoryTitle: "Tạo Truyện AI",
  theme: "Chủ đề",
  childName: "Tên bé",
  childAge: "Tuổi bé",
  generateStory: "Tạo truyện",
};

const en: Translations = {
  loading: "Loading...",
  save: "Save",
  cancel: "Cancel",
  delete: "Delete",
  back: "Back",
  confirm: "Confirm",
  search: "Search",
  login: "Log in",
  signup: "Sign up",
  logout: "Log out",
  email: "Email",
  password: "Password",
  home: "Home",
  library: "Library",
  create: "Create",
  voice: "Voice",
  settings: "Settings",
  welcomeBack: "Welcome back",
  recentStories: "Recent stories",
  quickActions: "Quick actions",
  createStory: "Create Story",
  recordVoice: "Record",
  myLibrary: "Library",
  admin: "Admin",
  libraryTitle: "Library",
  allFilter: "All",
  fairyTale: "Fairy Tale",
  adventure: "Adventure",
  bedtime: "Bedtime",
  animal: "Animals",
  educational: "Educational",
  custom: "Custom",
  emptyLibrary: "Library is empty",
  noMatchingStories: "No matching stories",
  createFirstStory: "Create your family's first AI story",
  pages: "pages",
  nowPlaying: "Now playing",
  voiceBy: "Voice by",
  lullaby: "Lullaby",
  branching: "Branch",
  favorite: "Favorite",
  soundMixer: "Sound Mixer",
  aiAutoAmbient: "AI auto-match ambient to scene",
  visualEffects: "Visual Effects",
  aiAutoEffect: "AI auto",
  off: "Off",
  rateThisStory: "Rate this story",
  writeReview: "Write a review",
  reviews: "Reviews",
  noReviews: "No reviews yet",
  submitReview: "Submit review",
  reviewPlaceholder: "Share your thoughts about this story...",
  ratings: "ratings",
  shareStory: "Share story",
  copyLink: "Copy link",
  linkCopied: "Copied!",
  shareVia: "Share via",
  sharedStory: "Shared story",
  favorites: "Favorites",
  noFavorites: "No favorite stories yet",
  addedToFavorites: "Added to favorites",
  removedFromFavorites: "Removed from favorites",
  readingStreak: "Reading streak",
  currentStreak: "Current streak",
  longestStreak: "Best streak",
  totalStoriesRead: "Stories read",
  totalListenMinutes: "Minutes listened",
  days: "days",
  settingsTitle: "Settings",
  language: "Language",
  languageDesc: "Choose display language",
  elevenLabsKey: "ElevenLabs API Key",
  aiProvider: "AI Provider",
  storyEditor: "Story Editor",
  addPage: "Add page",
  publishStory: "Publish",
  unpublish: "Unpublish",
  draft: "Draft",
  published: "Published",
  illustrateAI: "AI Illustrate",
  regenerateIllustration: "Regenerate illustration",
  batchGenerateVoice: "Generate all voice",
  batchGenerateDesc: "Auto-generate TTS for all pages without audio",
  generating: "Generating...",
  createStoryTitle: "Create AI Story",
  theme: "Theme",
  childName: "Child's name",
  childAge: "Child's age",
  generateStory: "Generate story",
};

const ja: Translations = {
  loading: "読み込み中...",
  save: "保存",
  cancel: "キャンセル",
  delete: "削除",
  back: "戻る",
  confirm: "確認",
  search: "検索",
  login: "ログイン",
  signup: "新規登録",
  logout: "ログアウト",
  email: "メール",
  password: "パスワード",
  home: "ホーム",
  library: "ライブラリ",
  create: "作成",
  voice: "声",
  settings: "設定",
  welcomeBack: "おかえりなさい",
  recentStories: "最近のお話",
  quickActions: "クイック操作",
  createStory: "お話を作る",
  recordVoice: "録音",
  myLibrary: "ライブラリ",
  admin: "管理",
  libraryTitle: "ライブラリ",
  allFilter: "すべて",
  fairyTale: "おとぎ話",
  adventure: "冒険",
  bedtime: "おやすみ",
  animal: "動物",
  educational: "学び",
  custom: "カスタム",
  emptyLibrary: "ライブラリは空です",
  noMatchingStories: "お話が見つかりません",
  createFirstStory: "家族初のAIお話を作りましょう",
  pages: "ページ",
  nowPlaying: "再生中",
  voiceBy: "読み手",
  lullaby: "子守唄",
  branching: "分岐",
  favorite: "お気に入り",
  soundMixer: "サウンドミキサー",
  aiAutoAmbient: "AIが自動で環境音を選択",
  visualEffects: "視覚エフェクト",
  aiAutoEffect: "AI自動",
  off: "オフ",
  rateThisStory: "このお話を評価",
  writeReview: "レビューを書く",
  reviews: "レビュー",
  noReviews: "まだレビューはありません",
  submitReview: "レビューを送信",
  reviewPlaceholder: "このお話の感想を共有してください...",
  ratings: "件の評価",
  shareStory: "お話をシェア",
  copyLink: "リンクをコピー",
  linkCopied: "コピーしました！",
  shareVia: "シェア",
  sharedStory: "シェアされたお話",
  favorites: "お気に入り",
  noFavorites: "お気に入りのお話はまだありません",
  addedToFavorites: "お気に入りに追加しました",
  removedFromFavorites: "お気に入りから削除しました",
  readingStreak: "読書ストリーク",
  currentStreak: "現在のストリーク",
  longestStreak: "最長記録",
  totalStoriesRead: "読んだお話",
  totalListenMinutes: "聴いた時間（分）",
  days: "日",
  settingsTitle: "設定",
  language: "言語",
  languageDesc: "表示言語を選択",
  elevenLabsKey: "ElevenLabs APIキー",
  aiProvider: "AIプロバイダー",
  storyEditor: "お話エディタ",
  addPage: "ページを追加",
  publishStory: "公開",
  unpublish: "非公開にする",
  draft: "下書き",
  published: "公開済み",
  illustrateAI: "AIイラスト",
  regenerateIllustration: "イラストを再生成",
  batchGenerateVoice: "全ページの音声を生成",
  batchGenerateDesc: "音声がないページのTTSを自動生成",
  generating: "生成中...",
  createStoryTitle: "AIお話を作成",
  theme: "テーマ",
  childName: "お子さまの名前",
  childAge: "お子さまの年齢",
  generateStory: "お話を生成",
};

const translations: Record<Locale, Translations> = { vi, en, ja };

export const LOCALE_LABELS: Record<Locale, string> = {
  vi: "Tiếng Việt",
  en: "English",
  ja: "日本語",
};

interface I18nContextValue {
  locale: Locale;
  t: Translations;
  setLocale: (locale: Locale) => void;
}

const I18nContext = createContext<I18nContextValue>({
  locale: "vi",
  t: vi,
  setLocale: () => {},
});

export function useI18n() {
  return useContext(I18nContext);
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("kecon-locale") as Locale | null;
      if (saved && translations[saved]) return saved;
    }
    return "vi";
  });

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale);
    if (typeof window !== "undefined") {
      localStorage.setItem("kecon-locale", newLocale);
    }
  }, []);

  return (
    <I18nContext.Provider value={{ locale, t: translations[locale], setLocale }}>
      {children}
    </I18nContext.Provider>
  );
}
