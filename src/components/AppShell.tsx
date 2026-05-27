"use client";

import { useState, useCallback } from "react";
import type { Screen, TabId } from "@/lib/types";
import { SettingsProvider } from "@/lib/settings-context";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import TabBar from "@/components/ui/TabBar";
import Onboarding from "@/components/screens/Onboarding";
import Login from "@/components/screens/Login";
import Signup from "@/components/screens/Signup";
import Home from "@/components/screens/Home";
import VoiceRecording from "@/components/screens/VoiceRecording";
import CreateStory from "@/components/screens/CreateStory";
import StoryPlayer from "@/components/screens/StoryPlayer";
import Lullaby from "@/components/screens/Lullaby";
import Adventure from "@/components/screens/Adventure";
import VoiceLegacy from "@/components/screens/VoiceLegacy";
import Library from "@/components/screens/Library";
import VoiceProfiles from "@/components/screens/VoiceProfiles";
import Settings from "@/components/screens/Settings";

interface ScreenState {
  screen: Screen;
  data?: Record<string, string>;
}

const tabScreenMap: Record<TabId, Screen> = {
  home: "home",
  library: "library",
  create: "create",
  voice: "profiles",
  settings: "settings",
};

const screenTabMap: Partial<Record<Screen, TabId>> = {
  home: "home",
  library: "library",
  create: "create",
  profiles: "voice",
  settings: "settings",
};

function AppContent() {
  const { user, loading } = useAuth();
  const [history, setHistory] = useState<ScreenState[]>([
    { screen: "onboarding" },
  ]);
  const current = history[history.length - 1];
  const activeTab: TabId = screenTabMap[current.screen] || "home";

  const navigate = useCallback(
    (screen: Screen, data?: Record<string, string>) => {
      setHistory((prev) => [...prev, { screen, data }]);
    },
    []
  );

  const goBack = useCallback(() => {
    setHistory((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
  }, []);

  const handleTabChange = useCallback((tab: TabId) => {
    const screen = tabScreenMap[tab];
    setHistory([{ screen }]);
  }, []);

  const handleOnboardingDone = useCallback(() => {
    if (user) {
      setHistory([{ screen: "home" }]);
    } else {
      setHistory([{ screen: "login" }]);
    }
  }, [user]);

  const showTabBar =
    current.screen !== "onboarding" &&
    current.screen !== "login" &&
    current.screen !== "signup" &&
    current.screen !== "player" &&
    current.screen !== "lullaby" &&
    current.screen !== "recording" &&
    current.screen !== "adventure" &&
    current.screen !== "legacy";

  if (loading) {
    return (
      <div className="relative max-w-[430px] mx-auto min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#FF6B3D] to-[#FF3D77] flex items-center justify-center mx-auto mb-3 animate-pulse">
            <span className="text-white text-xl font-bold">K</span>
          </div>
          <p className="text-sm text-gray-400 font-medium">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative max-w-[430px] mx-auto min-h-screen bg-white shadow-2xl shadow-black/10">
      <div className="screen-enter" key={current.screen}>
        {current.screen === "onboarding" && (
          <Onboarding onGetStarted={handleOnboardingDone} />
        )}
        {current.screen === "login" && <Login onNavigate={navigate} />}
        {current.screen === "signup" && <Signup onNavigate={navigate} />}
        {current.screen === "home" && <Home onNavigate={navigate} />}
        {current.screen === "recording" && (
          <VoiceRecording onBack={goBack} onNavigate={navigate} />
        )}
        {current.screen === "create" && (
          <CreateStory onBack={goBack} onNavigate={navigate} />
        )}
        {current.screen === "player" && (
          <StoryPlayer
            storyId={current.data?.storyId}
            onBack={goBack}
            onNavigate={navigate}
          />
        )}
        {current.screen === "lullaby" && <Lullaby onBack={goBack} />}
        {current.screen === "adventure" && <Adventure onBack={goBack} />}
        {current.screen === "legacy" && <VoiceLegacy onBack={goBack} />}
        {current.screen === "library" && <Library onNavigate={navigate} />}
        {current.screen === "profiles" && (
          <VoiceProfiles onNavigate={navigate} />
        )}
        {current.screen === "settings" && (
          <Settings onNavigate={navigate} />
        )}
      </div>

      {showTabBar && (
        <TabBar active={activeTab} onTabChange={handleTabChange} />
      )}
    </div>
  );
}

export default function AppShell() {
  return (
    <AuthProvider>
      <SettingsProvider>
        <AppContent />
      </SettingsProvider>
    </AuthProvider>
  );
}
