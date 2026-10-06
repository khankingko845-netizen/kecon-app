"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import { useAuth } from "@/lib/auth-context";
import { readPersistedSettings, serializeSettings, SETTINGS_STORAGE_KEY } from "@/lib/settings-storage";

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
  defaultStoryModel: string;
  hasCustomUrl: boolean;
  elevenLabsModel: string;
}

const defaultSettings: AppSettings = {
  elevenLabsApiKey: "",
  elevenLabsModelId: "",
  storyProvider: "openai",
  storyApiKey: "",
  storyModel: "",
  storyBaseUrl: "",
  language: "vi",
  autoPlay: true,
  sleepTimerDefault: 15,
  childName: "",
  childAge: "4-6",
};

const defaultSystemStatus: SystemStatus = {
  hasElevenLabs: false,
  hasStoryProvider: false,
  defaultStoryProvider: "",
  defaultStoryModel: "",
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
  const { isAdmin } = useAuth();
  const [storedSettings, setSettings] = useState<AppSettings>(() => {
    if (typeof window === "undefined") return defaultSettings;
    const { settings: loaded, hadSecrets } = readPersistedSettings(
      localStorage.getItem(SETTINGS_STORAGE_KEY),
      defaultSettings
    );
    // Older versions persisted API keys — rewrite storage without them.
    if (hadSecrets) localStorage.setItem(SETTINGS_STORAGE_KEY, serializeSettings(loaded));
    return loaded;
  });

  // BYO keys are admin-only (server enforces it too); others always use the platform key.
  const settings: AppSettings = isAdmin
    ? storedSettings
    : { ...storedSettings, elevenLabsApiKey: "", storyApiKey: "" };

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
        // API keys stay in memory only — never persisted to the device.
        localStorage.setItem(SETTINGS_STORAGE_KEY, serializeSettings(next));
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
