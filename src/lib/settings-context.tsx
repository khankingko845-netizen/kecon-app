"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

export interface AppSettings {
  elevenLabsApiKey: string;
  elevenLabsModelId: string;
  storyProvider: "openai" | "gemini" | "anthropic";
  storyApiKey: string;
  storyModel: string;
  language: string;
  autoPlay: boolean;
  sleepTimerDefault: number;
  childName: string;
  childAge: string;
}

const defaultSettings: AppSettings = {
  elevenLabsApiKey: "",
  elevenLabsModelId: "eleven_multilingual_v2",
  storyProvider: "openai",
  storyApiKey: "",
  storyModel: "gpt-4o-mini",
  language: "vi",
  autoPlay: true,
  sleepTimerDefault: 15,
  childName: "Minh",
  childAge: "4-6",
};

interface SettingsContextValue {
  settings: AppSettings;
  updateSettings: (partial: Partial<AppSettings>) => void;
  isConfigured: boolean;
}

const SettingsContext = createContext<SettingsContextValue>({
  settings: defaultSettings,
  updateSettings: () => {},
  isConfigured: false,
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

  const updateSettings = useCallback((partial: Partial<AppSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...partial };
      if (typeof window !== "undefined") {
        localStorage.setItem("kecon-settings", JSON.stringify(next));
      }
      return next;
    });
  }, []);

  const isConfigured = Boolean(settings.elevenLabsApiKey && settings.storyApiKey);

  return (
    <SettingsContext.Provider value={{ settings, updateSettings, isConfigured }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  return useContext(SettingsContext);
}
