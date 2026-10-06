"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppProviders from "@/components/AppProviders";
import {
 ArrowLeft,
 BarChart3,
 BookOpen,
 FolderOpen,
 History,
 LayoutDashboard,
 LayoutList,
 Settings,
 ShieldCheck,
 Users,
} from "@/components/ui/icons";
import { ROLE_LABELS, type AdminPermission, type StaffRole } from "@/lib/admin-permissions";
import { ADMIN_SECTIONS, adminPath, canOpenSection, isAdminScreen, sectionsFor, type AdminScreen } from "@/lib/admin-routes";
import type { Screen } from "@/lib/types";

/**
 * Admin v2 · A-01 — the admin console, rendered by `app/admin/[[...section]]`
 * only after the server guard confirmed an admin session. Desktop-first:
 * sidebar on ≥1024 px, a scrollable top nav on tablets/phones. The section
 * screens are the existing ones (restyled later in A-15); each section has its
 * own URL, so reload / deep links / the back button work.
 */
const Fallback = () => <div aria-busy="true" className="min-h-[50vh]" />;
const AdminDashboard = dynamic(() => import("@/components/screens/AdminDashboard"), { loading: Fallback });
const AdminStories = dynamic(() => import("@/components/screens/AdminStories"), { loading: Fallback });
const AdminUsers = dynamic(() => import("@/components/screens/AdminUsers"), { loading: Fallback });
const AdminAnalytics = dynamic(() => import("@/components/screens/AdminAnalytics"), { loading: Fallback });
const AdminCategories = dynamic(() => import("@/components/screens/AdminCategories"), { loading: Fallback });
const AdminTemplates = dynamic(() => import("@/components/screens/AdminTemplates"), { loading: Fallback });
const AdminSettings = dynamic(() => import("@/components/screens/AdminSettings"), { loading: Fallback });
const AdminAudit = dynamic(() => import("@/components/screens/AdminAudit"), { loading: Fallback });
const StoryEditor = dynamic(() => import("@/components/screens/StoryEditor"), { loading: Fallback });
const CreateStory = dynamic(() => import("@/components/screens/CreateStory"), { loading: Fallback });
const UploadStory = dynamic(() => import("@/components/screens/UploadStory"), { loading: Fallback });
const StoryPlayer = dynamic(() => import("@/components/screens/StoryPlayer"), { loading: Fallback });

const SECTION_ICONS: Record<AdminScreen, typeof Users> = {
 admin: LayoutDashboard,
 "admin-stories": LayoutList,
 "admin-users": Users,
 "admin-analytics": BarChart3,
 "admin-categories": FolderOpen,
 "admin-templates": BookOpen,
 "admin-settings": Settings,
 "admin-audit": History,
};

export interface AdminViewerInfo {
 email: string | null;
 role: StaffRole;
 permissions: AdminPermission[];
}

/**
 * A-02: the viewer's permissions (verified on the server for this request) —
 * screens use it to hide actions the DB would refuse anyway (RLS + has_permission).
 */
const NO_PERMISSIONS: readonly AdminPermission[] = [];
const AdminPermissionsContext = createContext<readonly AdminPermission[]>(NO_PERMISSIONS);

interface Overlay {
 screen: Screen;
 data?: Record<string, string>;
}

/** Story tools the admin screens open on top of a section (editor, AI, upload, preview). */
const OVERLAY_SCREENS = new Set<Screen>(["editor", "create", "upload", "player"]);

function AdminContent({ screen }: { screen: AdminScreen }) {
 const router = useRouter();
 const permissions = useContext(AdminPermissionsContext);
 const [overlays, setOverlays] = useState<Overlay[]>([]);
 const canOpen = useCallback((s: Screen) => isAdminScreen(s) && canOpenSection(s, permissions), [permissions]);
 const can = (p: AdminPermission) => permissions.includes(p);

 const navigate = useCallback(
 (next: Screen, data?: Record<string, string>) => {
 if (isAdminScreen(next)) {
 setOverlays([]);
 if (canOpenSection(next, permissions)) router.push(adminPath(next));
 } else if (OVERLAY_SCREENS.has(next)) {
 setOverlays((prev) => [...prev, { screen: next, data }]);
 } else {
 // Kid-only screens stay in the kid app — just close the story tool.
 setOverlays([]);
 }
 },
 [router, permissions]
 );
 const closeOverlay = useCallback(() => setOverlays((prev) => prev.slice(0, -1)), []);
 const toDashboard = useCallback(() => router.push(adminPath("admin")), [router]);

 const top = overlays[overlays.length - 1];
 if (top?.screen === "editor") return <StoryEditor storyId={top.data?.storyId} onBack={closeOverlay} onNavigate={navigate} />;
 if (top?.screen === "create") return <CreateStory onBack={closeOverlay} onNavigate={navigate} />;
 if (top?.screen === "upload") return <UploadStory onBack={closeOverlay} onNavigate={navigate} />;
 if (top?.screen === "player") return <StoryPlayer storyId={top.data?.storyId} onBack={closeOverlay} onNavigate={navigate} />;

 switch (screen) {
 case "admin":
 return <AdminDashboard onNavigate={navigate} canOpen={canOpen} canCreate={can("stories.write")} />;
 case "admin-stories":
 return <AdminStories onBack={toDashboard} onNavigate={navigate} />;
 case "admin-users":
 return <AdminUsers onBack={toDashboard} canManageRoles={can("roles.manage")} />;
 case "admin-analytics":
 return <AdminAnalytics onBack={toDashboard} />;
 case "admin-categories":
 return <AdminCategories onBack={toDashboard} />;
 case "admin-templates":
 return <AdminTemplates onBack={toDashboard} onNavigate={navigate} />;
 case "admin-settings":
 return <AdminSettings onBack={toDashboard} canManageSecrets={can("secrets.manage")} />;
 case "admin-audit":
 return <AdminAudit onBack={toDashboard} />;
 }
}

function AdminShell({ screen, viewer }: { screen: AdminScreen; viewer: AdminViewerInfo }) {
 const current = ADMIN_SECTIONS.find((s) => s.screen === screen) ?? ADMIN_SECTIONS[0];
 const sections = useMemo(() => sectionsFor(viewer.permissions), [viewer.permissions]);
 const backToApp = (
 <Link
 href="/"
 className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl text-[13px] font-semibold text-brand-ink hover:underline"
 >
 <ArrowLeft size={16} /> Về app KểCon
 </Link>
 );

 return (
 <div data-admin-shell className="min-h-screen bg-parent-bg font-parent text-ink lg:flex">
 <aside className="border-b border-gray-100 bg-white lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-64 lg:shrink-0 lg:flex-col lg:border-b-0 lg:border-r">
 <div className="flex items-center gap-2.5 px-5 py-4">
 <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand text-white">
 <ShieldCheck size={18} />
 </span>
 <div className="min-w-0">
 <p className="text-[15px] font-bold leading-tight">KểCon</p>
 <p className="text-[12px] text-ink-2">Quản trị hệ thống</p>
 </div>
 <div className="ml-auto lg:hidden">{backToApp}</div>
 </div>
 <nav aria-label="Quản trị" className="lg:flex-1 lg:overflow-y-auto">
 <ul className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:overflow-visible">
 {sections.map((s) => {
 const Icon = SECTION_ICONS[s.screen];
 const active = s.screen === screen;
 return (
 <li key={s.screen} className="shrink-0">
 <Link
 href={adminPath(s.screen)}
 aria-current={active ? "page" : undefined}
 className={`flex min-h-[44px] items-center gap-2.5 whitespace-nowrap rounded-xl px-3 text-[14px] font-semibold ${
 active ? "bg-brand-soft text-brand-ink" : "text-ink-2 hover:bg-gray-100 hover:text-ink"
 }`}
 >
 <Icon size={18} />
 {s.label}
 </Link>
 </li>
 );
 })}
 </ul>
 </nav>
 <div className="hidden border-t border-gray-100 px-5 py-4 lg:block">
 <p className="truncate text-[13px] font-semibold" title={viewer.email ?? undefined}>
 {viewer.email ?? "Quản trị viên"}
 </p>
 <p className="mb-2 text-[12px] text-ink-2">{ROLE_LABELS[viewer.role]}</p>
 {backToApp}
 </div>
 </aside>
 <main id="main-content" aria-label={current.label} className="min-w-0 flex-1">
 <div className="mx-auto w-full max-w-5xl lg:px-6">
 <AdminContent key={screen} screen={screen} />
 </div>
 </main>
 </div>
 );
}

export default function AdminApp({ screen, viewer }: { screen: AdminScreen; viewer: AdminViewerInfo }) {
 return (
 <AppProviders>
 <AdminPermissionsContext.Provider value={viewer.permissions}>
 <AdminShell screen={screen} viewer={viewer} />
 </AdminPermissionsContext.Provider>
 </AppProviders>
 );
}
