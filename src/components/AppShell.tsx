"use client";
import { useFeatureFlags } from "@/lib/feature-flags-context";

import { useState, useCallback, useEffect } from "react";
import dynamic from "next/dynamic";
import type { Screen, TabId } from "@/lib/types";
import { useAuth } from "@/lib/auth-context";
import TabBar from "@/components/ui/TabBar";
import { KidLoading } from "@/components/ui/states";
import Onboarding from "@/components/screens/Onboarding";
import Login from "@/components/screens/Login";
import Signup from "@/components/screens/Signup";
import Home from "@/components/screens/Home";
import ComplianceLayer from "@/components/ComplianceLayer";
import MiniPlayer from "@/components/ui/MiniPlayer";
import { useAudioPlayer } from "@/lib/audio-player-context";
import ParentGate from "@/components/parent/ParentGate";
import ScreenTimeLock from "@/components/parent/ScreenTimeLock";
import { isParentArea } from "@/lib/parent-gate";
import { useParentUnlock } from "@/lib/use-parent-unlock";
import { useScreenTime } from "@/lib/use-screen-time";
import AppProviders from "@/components/AppProviders";
import { adminPath, isAdminScreen } from "@/lib/admin-routes";

/**
 * UI-12 (hiệu năng): only the entry screens (onboarding, login, signup, home)
 * ship in the first bundle; every other screen is its own chunk, fetched on
 * first visit and prefetched while the browser is idle (see `prefetchScreens`).
 * This keeps the first load small enough for LCP < 2.5 s on 4G.
 */
const ScreenFallback = () => <div aria-busy="true" className="min-h-screen" />;
const VoiceRecording = dynamic(() => import("@/components/screens/VoiceRecording"), { loading: ScreenFallback });
const CreateStory = dynamic(() => import("@/components/screens/CreateStory"), { loading: ScreenFallback });
const StoryPlayer = dynamic(() => import("@/components/screens/StoryPlayer"), { loading: ScreenFallback });
const Lullaby = dynamic(() => import("@/components/screens/Lullaby"), { loading: ScreenFallback });
const Adventure = dynamic(() => import("@/components/screens/Adventure"), { loading: ScreenFallback });
const VoiceLegacy = dynamic(() => import("@/components/screens/VoiceLegacy"), { loading: ScreenFallback });
const Library = dynamic(() => import("@/components/screens/Library"), { loading: ScreenFallback });
const VoiceProfiles = dynamic(() => import("@/components/screens/VoiceProfiles"), { loading: ScreenFallback });
const Settings = dynamic(() => import("@/components/screens/Settings"), { loading: ScreenFallback });
const StoryEditor = dynamic(() => import("@/components/screens/StoryEditor"), { loading: ScreenFallback });
const UploadStory = dynamic(() => import("@/components/screens/UploadStory"), { loading: ScreenFallback });
const Favorites = dynamic(() => import("@/components/screens/Favorites"), { loading: ScreenFallback });
const Subscription = dynamic(() => import("@/components/screens/Subscription"), { loading: ScreenFallback });
const Achievements = dynamic(() => import("@/components/screens/Achievements"), { loading: ScreenFallback });
const ParentalControls = dynamic(() => import("@/components/screens/ParentalControls"), { loading: ScreenFallback });
const ParentAnalytics = dynamic(() => import("@/components/screens/ParentAnalytics"), { loading: ScreenFallback });
const Downloads = dynamic(() => import("@/components/screens/Downloads"), { loading: ScreenFallback });
const Notifications = dynamic(() => import("@/components/screens/Notifications"), { loading: ScreenFallback });
const ProfileEdit = dynamic(() => import("@/components/screens/ProfileEdit"), { loading: ScreenFallback });
const DailyChallenges = dynamic(() => import("@/components/screens/DailyChallenges"), { loading: ScreenFallback });
const Collections = dynamic(() => import("@/components/screens/Collections"), { loading: ScreenFallback });
const ScanBook = dynamic(() => import("@/components/screens/ScanBook"), { loading: ScreenFallback });
const DrawStory = dynamic(() => import("@/components/screens/DrawStory"), { loading: ScreenFallback });
const VocabQuiz = dynamic(() => import("@/components/screens/VocabQuiz"), { loading: ScreenFallback });

/** Kid tabs + the player first — warms the chunk cache while the browser is idle. */
function prefetchScreens() {
 const loaders = [
 () => import("@/components/screens/Library"),
 () => import("@/components/screens/CreateStory"),
 () => import("@/components/screens/StoryPlayer"),
 () => import("@/components/screens/VoiceProfiles"),
 () => import("@/components/screens/Settings"),
 () => import("@/components/screens/Lullaby"),
 ];
 for (const load of loaders) void load().catch(() => {});
}

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

function AppContent({ signedOut, initialScreen }: { signedOut: boolean; initialScreen?: Screen }) {
 const features = useFeatureFlags();
 const { user, loading } = useAuth();
 const [history, setHistoryState] = useState<ScreenState[]>([
 { screen: initialScreen ?? "onboarding" },
 ]);
 // UI-12: the first screen (server-rendered onboarding / first screen after the
 // splash) appears without the slide-in — an opacity-0 start would only delay
 // the first contentful paint. Every later screen change animates.
 const [animateScreens, setAnimateScreens] = useState(false);
 const setHistory = useCallback((next: ScreenState[] | ((prev: ScreenState[]) => ScreenState[])) => {
 setAnimateScreens(true);
 setHistoryState(next);
 }, []);
 const rawCurrent = history[history.length - 1];
 const onAuthScreen =
 rawCurrent.screen === "onboarding" ||
 rawCurrent.screen === "login" ||
 rawCurrent.screen === "signup";
 // Authenticated users should never see auth screens (e.g. on reload).
 const current: ScreenState =
 !loading && user && onAuthScreen ? { screen: "home" } : rawCurrent;
 // T19 / UI-10: parent area (tab "Bố mẹ" + everything under it) opens only
 // through the parent gate; kid screens lock on daily limit / bedtime.
 const inParentArea = isParentArea(current.screen);
 const activeTab: TabId = screenTabMap[current.screen] || (inParentArea ? "settings" : "home");
 const { unlocked: parentUnlocked, unlock: unlockParent, lock: lockParent } = useParentUnlock(inParentArea);
 const gateActive = !loading && !!user && inParentArea && !parentUnlocked;
 const screenTime = useScreenTime({ userId: user?.id, paused: inParentArea });
 const kidLocked = !loading && !!user && !inParentArea && screenTime.verdict.blocked;
 const lockReason = screenTime.verdict.blocked ? screenTime.verdict.reason : "limit";
 const { pause, isPlaying } = useAudioPlayer();
 useEffect(() => {
 if (kidLocked && isPlaying) pause();
 }, [kidLocked, isPlaying, pause]);

 // UI-12: once signed in, warm the chunks of the kid tabs in the background
 // (after first paint, when the browser is idle) so tab switches stay instant.
 const signedInId = !loading ? user?.id : undefined;
 useEffect(() => {
 if (!signedInId) return;
 let idle: number | undefined;
 const timer = window.setTimeout(() => {
 if ("requestIdleCallback" in window) idle = window.requestIdleCallback(prefetchScreens, { timeout: 5000 });
 else prefetchScreens();
 }, 2500);
 return () => {
 window.clearTimeout(timer);
 if (idle !== undefined) window.cancelIdleCallback(idle);
 };
 }, [signedInId]);

 const navigate = useCallback(
 (screen: Screen, data?: Record<string, string>) => {
 // A-01: the admin console is its own route (`/admin`, guarded on the
 // server) — it never renders inside the kid app.
 if (isAdminScreen(screen)) {
 window.location.assign(adminPath(screen));
 return;
 }
 if (!features.canOpen(screen)) return;
 setHistory((prev) => [...prev, { screen, data }]);
 },
 [setHistory, features.canOpen]
 );

 const goBack = useCallback(() => {
 setHistory((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
 }, [setHistory]);

 const handleTabChange = useCallback((tab: TabId) => {
 const screen = tabScreenMap[tab];
 // Leaving the parent area through a kid tab closes the gate again.
 if (!isParentArea(screen)) lockParent();
 setHistory([{ screen }]);
 }, [lockParent, setHistory]);

 const leaveGate = useCallback(() => {
 lockParent();
 setHistory([{ screen: "home" }]);
 }, [lockParent, setHistory]);

 const afterPinReset = useCallback(() => {
 unlockParent();
 setHistory([{ screen: "settings" }, { screen: "parental-controls" }]);
 }, [unlockParent, setHistory]);

 const handleGetStarted = useCallback(() => {
 setHistory([{ screen: user ? "home" : "signup" }]);
 }, [user, setHistory]);

 const handleGoToLogin = useCallback(() => {
 setHistory([{ screen: user ? "home" : "login" }]);
 }, [user, setHistory]);

 const showTabBar =
 current.screen !== "onboarding" &&
 current.screen !== "login" &&
 current.screen !== "signup" &&
 current.screen !== "player" &&
 current.screen !== "lullaby" &&
 current.screen !== "recording" &&
 current.screen !== "create" &&
 current.screen !== "adventure" &&
 current.screen !== "editor" &&
 current.screen !== "upload" &&
 current.screen !== "legacy" &&
 current.screen !== "draw-story" &&
 current.screen !== "vocab-quiz";

 // Visitors (no auth cookie, see app/page.tsx) see onboarding while auth
 // resolves; families get the splash so onboarding never flashes for them.
 if (loading && !signedOut) {
 return (
 <main className="relative w-full max-w-[430px] mx-auto min-h-screen bg-cream">
 <KidLoading fullScreen title="Đóm đang thức dậy…" />
 </main>
 );
 }

 return (
 <div className="relative w-full max-w-[430px] mx-auto min-h-screen bg-cream shadow-2xl shadow-black/10">
 <main id="main-content" className={animateScreens ? "screen-enter" : undefined} key={gateActive ? "parent-gate" : kidLocked ? "screen-time-lock" : current.screen}>
 {gateActive ? (
 <ParentGate onUnlock={unlockParent} onCancel={leaveGate} onPinReset={afterPinReset} />
 ) : kidLocked ? (
 <ScreenTimeLock reason={lockReason} onGrant={screenTime.grant} />
 ) : !features.canOpen(current.screen) ? (
 <div role="status" className="p-6"><h1 className="text-xl font-bold">Tính năng đang tắt</h1><button className="admin-button mt-4" onClick={leaveGate}>Về Trang chủ</button></div>
 ) : (
 <>
 {current.screen === "onboarding" && (
 <Onboarding
 onGetStarted={handleGetStarted}
 onLogin={handleGoToLogin}
 />
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
 {current.screen === "adventure" && (
 <Adventure
 storyId={current.data?.storyId}
 onBack={goBack}
 onNavigate={navigate}
 />
 )}
 {current.screen === "legacy" && <VoiceLegacy onBack={goBack} />}
 {current.screen === "library" && <Library onNavigate={navigate} initialCategory={current.data?.category} />}
 {current.screen === "profiles" && (
 <VoiceProfiles onNavigate={navigate} />
 )}
 {current.screen === "settings" && (
 <Settings onNavigate={navigate} />
 )}
 {current.screen === "editor" && (
 <StoryEditor
 storyId={current.data?.storyId}
 onBack={goBack}
 onNavigate={navigate}
 />
 )}
 {current.screen === "upload" && (
 <UploadStory onBack={goBack} onNavigate={navigate} />
 )}
 {current.screen === "favorites" && (
 <Favorites onBack={goBack} onNavigate={navigate} />
 )}
 {current.screen === "subscription" && (
 <Subscription onNavigate={navigate} />
 )}
 {current.screen === "achievements" && (
 <Achievements onBack={goBack} onNavigate={navigate} />
 )}
 {current.screen === "parental-controls" && (
 <ParentalControls onBack={goBack} onNavigate={navigate} />
 )}
 {current.screen === "parent-analytics" && (
 <ParentAnalytics onBack={goBack} onNavigate={navigate} />
 )}
 {current.screen === "downloads" && (
 <Downloads onBack={goBack} onNavigate={navigate} />
 )}
 {current.screen === "notifications" && (
 <Notifications onBack={goBack} onNavigate={navigate} />
 )}
 {current.screen === "profile-edit" && (
 <ProfileEdit onBack={goBack} onNavigate={navigate} />
 )}
 {current.screen === "daily-challenges" && (
 <DailyChallenges onBack={goBack} onNavigate={navigate} />
 )}
 {current.screen === "collections" && (
 <Collections onBack={goBack} onNavigate={navigate} />
 )}
 {current.screen === "scan-book" && (
 <ScanBook onBack={goBack} onNavigate={navigate} />
 )}
 {current.screen === "draw-story" && (
 <DrawStory onBack={goBack} onNavigate={navigate} />
 )}
 {current.screen === "vocab-quiz" && (
 <VocabQuiz
 storyId={current.data?.storyId}
 storyTitle={current.data?.storyTitle}
 onBack={goBack}
 onNavigate={navigate}
 />
 )}
 </>
 )}
 </main>

 {showTabBar && !kidLocked && (
 <TabBar active={activeTab} onTabChange={handleTabChange} />
 )}
 {user && <ComplianceLayer />}
 {!kidLocked && <MiniPlayer />}
 </div>
 );
}

export default function AppShell({ signedOut = false, initialScreen }: { signedOut?: boolean; initialScreen?: Screen }) {
 return (
 <AppProviders>
 <AppContent signedOut={signedOut} initialScreen={initialScreen} />
 </AppProviders>
 );
}
