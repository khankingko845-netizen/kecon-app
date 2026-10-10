export const SECRET_LABELS: Record<string, string> = {
  openai_api_key: "OpenAI",
  gemini_api_key: "Gemini",
  anthropic_api_key: "Claude",
  custom_provider_key: "Custom provider",
  dalle_api_key: "DALL·E",
};

/* ──────────────── types ──────────────── */
export interface VoiceOption {
  voice_id: string;
  name: string;
  category: string;
  language: string;
  languages?: string[];
  source?: "own" | "library";
  public_owner_id?: string;
}

export interface DefaultVoiceRow {
  id: string;
  voice_id: string;
  name: string;
  language: string;
  description: string | null;
  preview_url: string | null;
  gender: string | null;
  sort_order: number;
  is_active: boolean;
}

export interface TestResult {
  ok: boolean;
  models?: string[];
  voices?: VoiceOption[];
  error?: string;
}

/* ──────────────── tiny helpers ──────────────── */

export const AI_PROVIDERS = [
  { id: "openai", label: "OpenAI", color: "#10A37F" },
  { id: "gemini", label: "Gemini", color: "#4285F4" },
  { id: "anthropic", label: "Claude", color: "#D97706" },
  { id: "custom", label: "Custom", color: "#6B7280" },
] as const;

export const LANGUAGES = [
  { code: "vi", label: "🇻🇳 Tiếng Việt", filter: "vietnamese" },
  { code: "en", label: "🇺🇸 English", filter: "english" },
  { code: "ja", label: "🇯🇵 日本語", filter: "japanese" },
] as const;
