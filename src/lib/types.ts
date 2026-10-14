export type Screen =
  | "onboarding"
  | "login"
  | "signup"
  | "home"
  | "recording"
  | "create"
  | "player"
  | "lullaby"
  | "adventure"
  | "legacy"
  | "library"
  | "profiles"
  | "settings"
  | "editor"
  | "upload"
  | "admin"
  | "admin-stories"
  | "admin-users"
  | "admin-analytics"
  | "admin-settings"
  | "admin-categories"
  | "admin-templates"
  | "admin-missions"
  | "admin-audit"
  | "favorites"
  | "subscription"
  | "parental-controls"
  | "parent-analytics"
  | "parent-week"
  | "downloads"
  | "notifications"
  | "profile-edit"
  | "collections"
  | "scan-book"
  | "draw-story"
  | "vocab-quiz"
  | "sky";

export type TabId = "home" | "library" | "create" | "voice" | "settings";

export interface VoiceProfile {
  id: string;
  name: string;
  role: string;
  gradient: string;
  storyCount: number;
  quality: number;
  date: string;
  gender: "male" | "female";
}

export interface Story {
  id: string;
  title: string;
  duration: string;
  voiceId: string;
  voiceName: string;
  category: string;
  gradient: string;
  icon: string;
}

export interface StoryTheme {
  id: string;
  name: string;
  icon: string;
}

export interface SoundOption {
  id: string;
  name: string;
  icon: string;
}
