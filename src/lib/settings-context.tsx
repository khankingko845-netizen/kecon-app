"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";

export type StoryProvider = "openai" | "gemini" | "anthropic" | "custom";

export interface AppSettings {
  elevenLabsApiKey: string;
  elevenLabsModelId: string;
  storyProvider: StoryProvider;
  storyApiKey: string;
  storyModel: string;
  // Base URL for an OpenAI-compatible custom provider (only used when
  // storyProvider === "custom"), e.g. https://openrouter.ai/api/v1
  storyBaseUrl: string;
  language: string;
  autoPlay: boolean;
  sleepTimerDefault: number;
  childName: string;
  childAge: string;
}

/** What the admin has configured server-side (no secrets exposed). */
export interface SystemStatus {
  hasElevenLabs: boolean;
  hasStoryProvider: boolean;
  defaultStoryProvider: string;
  hasCustomUrl: boolean;
  elevenLabsModel: string;
}

const defaultSettings: AppSettings = {
  elevenLabsApiKey: "",
  elevenLabsModelId: "",
  storyProvider: "openai",
  storyApiKey: "",
  storyModel: "gpt-4o-mini",
  storyBaseUrl: "",
  language: "vi",
  autoPlay: true,
  sleepTimerDefault: 15,
  childName: "Minh",
  childAge: "4-6",
};

const defaultSystemStatus: SystemStatus = {
  hasElevenLabs: false,
  hasStoryProvider: false,
  defaultStoryProvider: "",
  hasCustomUrl: false,
  elevenLabsModel: "",
};

interface SettingsContextValue {
  settings: AppSettings;
  updateSettings: (partial: Partial<AppSettings>) => void;
  isConfigured: boolean;
  /** Admin has configured system-wide keys (users don't need BYO keys) */
  systemStatus: SystemStatus;
  /** True if ElevenLabs is available (user BYO key OR admin system key) */
  hasElevenLabs: boolean;
  /** True if a story AI provider is available (user BYO key OR admin system key) */
  hasStoryProvider: boolean;
}

const SettingsContext = createContext<SettingsContextValue>({
  settings: defaultSettings,
  updateSettings: () => {},
  isConfigured: false,
  systemStatus: defaultSystemStatus,
  hasElevenLabs: false,
  hasStoryProvider: false,
});

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("kecon-settings");
      if (saved) {
        try {
          return { ...defaultSettings, ...JSON.parse(saved) };
        } catch {
          return defaultSettings;
        }
      }
    }
    return defaultSettings;
  });

  const [systemStatus, setSystemStatus] = useState<SystemStatus>(defaultSystemStatus);

  // Fetch system status on mount (what admin has configured)
  useEffect(() => {
    fetch("/api/system/status")
      .then((r) => r.json())
      .then((data: SystemStatus) => setSystemStatus(data))
      .catch(() => {});
  }, []);

  const updateSettings = useCallback((partial: Partial<AppSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...partial };
      if (typeof window !== "undefined") {
        localStorage.setItem("kecon-settings", JSON.stringify(next));
      }
      return next;
    });
  }, []);

  // User has ElevenLabs if they have a BYO key OR admin configured one
  const hasElevenLabs = Boolean(settings.elevenLabsApiKey || systemStatus.hasElevenLabs);

  // User has story provider if they have BYO key OR admin configured one
  const userStoryConfigured = Boolean(
    settings.storyApiKey &&
      (settings.storyProvider !== "custom" || settings.storyBaseUrl)
  );
  const hasStoryProvider = userStoryConfigured || systemStatus.hasStoryProvider;

  const isConfigured = hasElevenLabs && hasStoryProvider;

  return (
    <SettingsContext.Provider
      value={{
        settings,
        updateSettings,
        isConfigured,
        systemStatus,
        hasElevenLabs,
        hasStoryProvider,
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  return useContext(SettingsContext);
}
