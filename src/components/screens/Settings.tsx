"use client";

import { useState } from "react";
import {
 ChevronRight, Key, Mic, BookOpen, Globe, Bell, Moon, Info, LogOut, Shield, Check, AlertCircle, ExternalLink, Trophy, BarChart3, Download, Trash2, Crown, LayoutDashboard, User, MoonStars, Timer, Mail,
} from "@/components/ui/icons";
import { CARD_SHADOW } from "@/components/ui/kit";
import { useSettings, type StoryProvider } from "@/lib/settings-context";
import { useAuth } from "@/lib/auth-context";
import { useAgeUi } from "@/lib/age-ui-context";
import { useData } from "@/lib/data-context";
import { PROVIDER_MODELS } from "@/lib/story-ai";
import { exportUserData, deleteUserData } from "@/lib/db";
import { useI18n, LOCALE_LABELS, type Locale } from "@/lib/i18n";
import {
 isPushSupported,
 getPermissionState,
 subscribeToPush,
 unsubscribeFromPush,
} from "@/lib/push-notifications";
import { useTheme } from "@/lib/theme-context";
import { SLEEP_TIMER_OPTIONS } from "@/lib/night-mode";
import type { Screen } from "@/lib/types";
import ParentHeader from "@/components/parent/ParentHeader";
import FeedbackSettings from "@/components/parent/FeedbackSettings";

interface SettingsProps {
 onNavigate: (screen: Screen) => void;
}

type SettingsTab = "main" | "api" | "voice" | "story" | "about" | "language";

/* ── Shared sub-components ── */

function SectionHeader({ title }: { title: string }) {
 return (
 <h2 className="font-parent text-[13px] font-semibold text-ink-2 dark:text-white/50 px-1 mt-6 mb-2">
 {title}
 </h2>
 );
}

function SettingsCard({ children }: { children: React.ReactNode }) {
 return (
 <div className={`bg-white dark:bg-white/[0.05] rounded-[20px] overflow-hidden divide-y divide-[#F1EEF8] dark:divide-white/[0.06] ${CARD_SHADOW}`}>
 {children}
 </div>
 );
}

type RowTone = "brand" | "glow" | "success" | "danger";

const ROW_TONE: Record<RowTone, string> = {
 brand: "bg-brand-soft text-brand-ink",
 glow: "bg-glow-soft text-[#9A6A00] dark:text-glow",
 success: "bg-success-soft text-success",
 danger: "bg-[#FDE7DF] text-cta-press dark:bg-cta/20 dark:text-cta-ink",
};

function SettingsRow({
 icon: Icon,
 label,
 value,
 onClick,
 tone = "brand",
 badge,
}: {
 icon: typeof Key;
 label: string;
 value?: string;
 onClick?: () => void;
 tone?: RowTone;
 badge?: "ok" | "warn";
}) {
 return (
 <button
 onClick={onClick}
 className="w-full min-h-[60px] flex items-center gap-3.5 px-4 py-3 active:bg-brand-soft/50 dark:active:bg-white/[0.03] transition-colors"
 >
 <span className={`w-10 h-10 rounded-[14px] flex items-center justify-center shrink-0 ${ROW_TONE[tone]}`}>
 <Icon size={20} weight="duotone" />
 </span>
 <span className={`flex-1 text-left font-parent text-[15px] font-semibold ${tone === "danger" ? "text-cta-press dark:text-cta-ink" : "text-ink dark:text-white/90"}`}>
 {label}
 </span>
 {badge === "ok" && (
 <span className="w-[22px] h-[22px] rounded-full bg-success flex items-center justify-center">
 <Check size={12} className="text-white" strokeWidth={3} />
 </span>
 )}
 {badge === "warn" && (
 <span className="w-[22px] h-[22px] rounded-full bg-amber-400 flex items-center justify-center">
 <AlertCircle size={12} className="text-white" strokeWidth={3} />
 </span>
 )}
 {value && (
 <span className="font-parent text-[13px] text-ink-2 dark:text-white/45 font-medium max-w-[150px] truncate">
 {value}
 </span>
 )}
 <ChevronRight size={16} className="text-[#C9C3DD] dark:text-white/20 shrink-0" />
 </button>
 );
}


/* ── Sub-panels ── */

function ApiKeysPanel() {
 const { settings, updateSettings } = useSettings();
 const [showElevenKey, setShowElevenKey] = useState(false);
 const [showStoryKey, setShowStoryKey] = useState(false);

 const providerInfo = PROVIDER_MODELS[settings.storyProvider];

 return (
 <div className="px-5 pb-10 space-y-5">
 <p className="mt-4 rounded-2xl bg-amber-50 dark:bg-amber-500/10 px-4 py-3 text-[12px] text-amber-800 dark:text-amber-300">
 Chỉ dành cho admin thử nhà cung cấp. Key chỉ được giữ trong bộ nhớ của tab này — không lưu trên thiết bị và sẽ mất khi tải lại trang. Key dùng cho mọi người hãy cấu hình trong Cài Đặt Hệ Thống.
 </p>
 <SectionHeader title="ElevenLabs — giọng nói AI" />
 <SettingsCard>
 <div className="px-4 py-4 space-y-3">
 <div>
 <label className="text-[12px] font-bold text-txt-secondary dark:text-white/40 mb-1.5 block">
 API Key
 </label>
 <div className="flex gap-2">
 <input
 type={showElevenKey ? "text" : "password"}
 value={settings.elevenLabsApiKey}
 onChange={(e) =>
 updateSettings({ elevenLabsApiKey: e.target.value })
 }
 placeholder="sk_..."
 className="flex-1 px-3.5 py-3 rounded-xl border border-gray-200 dark:border-white/10 bg-surface dark:bg-white/[0.04] text-sm font-mono text-txt dark:text-white/80 outline-none focus:border-accent transition-colors"
 />
 <button
 onClick={() => setShowElevenKey(!showElevenKey)}
 className="px-3 py-3 rounded-xl border border-gray-200 dark:border-white/10 text-xs font-bold text-txt-secondary dark:text-white/40"
 >
 {showElevenKey ? "Ẩn" : "Hiện"}
 </button>
 </div>
 </div>

 <div>
 <label className="text-[12px] font-bold text-txt-secondary dark:text-white/40 mb-1.5 block">
 Model
 </label>
 <select
 value={settings.elevenLabsModelId}
 onChange={(e) =>
 updateSettings({ elevenLabsModelId: e.target.value })
 }
 className="w-full px-3.5 py-3 rounded-xl border border-gray-200 dark:border-white/10 bg-surface dark:bg-white/[0.04] text-sm font-semibold text-txt dark:text-white/80 outline-none"
 >
 <option value="eleven_multilingual_v2">Multilingual v2 (tốt nhất)</option>
 <option value="eleven_turbo_v2_5">Turbo v2.5 (nhanh)</option>
 <option value="eleven_flash_v2_5">Flash v2.5 (rẻ nhất)</option>
 </select>
 </div>

 <a
 href="https://elevenlabs.io/app/settings/api-keys"
 target="_blank"
 rel="noopener noreferrer"
 className="inline-flex items-center gap-1.5 text-accent text-[13px] font-semibold"
 >
 Lấy API Key <ExternalLink size={13} />
 </a>
 </div>
 </SettingsCard>

 <SectionHeader title="AI tạo cốt truyện" />
 <SettingsCard>
 <div className="px-4 py-4 space-y-3">
 <div>
 <label className="text-[12px] font-bold text-txt-secondary dark:text-white/40 mb-1.5 block">
 Provider
 </label>
 <div className="flex gap-1.5 flex-wrap">
 {Object.entries(PROVIDER_MODELS).map(([key, val]) => (
 <button
 key={key}
 onClick={() => {
 updateSettings({
 storyProvider: key as StoryProvider,
 storyModel: val.models[0]?.id ?? settings.storyModel,
 });
 }}
 className={`flex-1 min-w-[72px] py-2.5 rounded-xl text-[13px] font-bold transition-all ${
 settings.storyProvider === key
 ? "bg-accent text-white shadow-sm shadow-accent/20"
 : "bg-gray-100 dark:bg-white/[0.06] text-txt-secondary dark:text-white/40"
 }`}
 >
 {val.label}
 </button>
 ))}
 </div>
 </div>

 {settings.storyProvider === "custom" && (
 <div>
 <label className="text-[12px] font-bold text-txt-secondary dark:text-white/40 mb-1.5 block">
 Base URL (OpenAI-compatible)
 </label>
 <input
 type="text"
 value={settings.storyBaseUrl}
 onChange={(e) =>
 updateSettings({ storyBaseUrl: e.target.value })
 }
 placeholder="https://openrouter.ai/api/v1"
 className="w-full px-3.5 py-3 rounded-xl border border-gray-200 dark:border-white/10 bg-surface dark:bg-white/[0.04] text-sm font-mono text-txt dark:text-white/80 outline-none focus:border-accent transition-colors"
 />
 <p className="text-[11px] text-txt-secondary dark:text-white/30 mt-1.5">
 Endpoint phải hỗ trợ <code>/chat/completions</code> kiểu OpenAI
 (OpenRouter, Groq, Together, LM Studio, Ollama…). Không thêm
 <code> /chat/completions</code> vào cuối.
 </p>
 </div>
 )}

 <div>
 <label className="text-[12px] font-bold text-txt-secondary dark:text-white/40 mb-1.5 block">
 API Key — {providerInfo.label}
 </label>
 <div className="flex gap-2">
 <input
 type={showStoryKey ? "text" : "password"}
 value={settings.storyApiKey}
 onChange={(e) =>
 updateSettings({ storyApiKey: e.target.value })
 }
 placeholder={
 settings.storyProvider === "openai"
 ? "sk-..."
 : settings.storyProvider === "gemini"
 ? "AIza..."
 : settings.storyProvider === "anthropic"
 ? "sk-ant-..."
 : "API key của provider"
 }
 className="flex-1 px-3.5 py-3 rounded-xl border border-gray-200 dark:border-white/10 bg-surface dark:bg-white/[0.04] text-sm font-mono text-txt dark:text-white/80 outline-none focus:border-accent transition-colors"
 />
 <button
 onClick={() => setShowStoryKey(!showStoryKey)}
 className="px-3 py-3 rounded-xl border border-gray-200 dark:border-white/10 text-xs font-bold text-txt-secondary dark:text-white/40"
 >
 {showStoryKey ? "Ẩn" : "Hiện"}
 </button>
 </div>
 </div>

 <div>
 <label className="text-[12px] font-bold text-txt-secondary dark:text-white/40 mb-1.5 block">
 Model
 </label>
 {settings.storyProvider === "custom" ? (
 <input
 type="text"
 value={settings.storyModel}
 onChange={(e) => updateSettings({ storyModel: e.target.value })}
 placeholder="ví dụ: openai/gpt-4o-mini, llama-3.1-70b…"
 className="w-full px-3.5 py-3 rounded-xl border border-gray-200 dark:border-white/10 bg-surface dark:bg-white/[0.04] text-sm font-mono text-txt dark:text-white/80 outline-none focus:border-accent transition-colors"
 />
 ) : (
 <select
 value={settings.storyModel}
 onChange={(e) => updateSettings({ storyModel: e.target.value })}
 className="w-full px-3.5 py-3 rounded-xl border border-gray-200 dark:border-white/10 bg-surface dark:bg-white/[0.04] text-sm font-semibold text-txt dark:text-white/80 outline-none"
 >
 {providerInfo.models.map((m) => (
 <option key={m.id} value={m.id}>
 {m.name}
 </option>
 ))}
 </select>
 )}
 </div>

 <div className="flex gap-2">
 {settings.storyProvider === "openai" && (
 <a
 href="https://platform.openai.com/api-keys"
 target="_blank"
 rel="noopener noreferrer"
 className="inline-flex items-center gap-1.5 text-accent text-[13px] font-semibold"
 >
 Lấy OpenAI Key <ExternalLink size={13} />
 </a>
 )}
 {settings.storyProvider === "gemini" && (
 <a
 href="https://aistudio.google.com/apikey"
 target="_blank"
 rel="noopener noreferrer"
 className="inline-flex items-center gap-1.5 text-accent text-[13px] font-semibold"
 >
 Lấy Gemini Key <ExternalLink size={13} />
 </a>
 )}
 {settings.storyProvider === "anthropic" && (
 <a
 href="https://console.anthropic.com/settings/keys"
 target="_blank"
 rel="noopener noreferrer"
 className="inline-flex items-center gap-1.5 text-accent text-[13px] font-semibold"
 >
 Lấy Claude Key <ExternalLink size={13} />
 </a>
 )}
 </div>
 </div>
 </SettingsCard>
 </div>
 );
}

function LanguagePanel({ onBack }: { onBack: () => void }) {
 const { locale, setLocale } = useI18n();

 const languages: { id: Locale; flag: string }[] = [
 { id: "vi", flag: "🇻🇳" },
 { id: "en", flag: "🇺🇸" },
 { id: "ja", flag: "🇯🇵" },
 ];

 return (
 <div className="min-h-screen bg-parent-bg font-parent pb-24">
 <ParentHeader title="Ngôn ngữ" onBack={onBack} />
 <div className="px-5">
 <SettingsCard>
 {languages.map((lang) => (
 <button
 key={lang.id}
 onClick={() => setLocale(lang.id)}
 className="w-full flex items-center gap-3 px-4 py-4 active:bg-gray-50/50 dark:active:bg-white/[0.03] transition-colors"
 >
 <span className="text-2xl">{lang.flag}</span>
 <span className="flex-1 text-left text-[15px] font-semibold text-txt dark:text-white/90">
 {LOCALE_LABELS[lang.id]}
 </span>
 {locale === lang.id && (
 <span className="w-6 h-6 rounded-full bg-accent flex items-center justify-center shadow-sm shadow-accent/20">
 <Check size={14} className="text-white" strokeWidth={3} />
 </span>
 )}
 </button>
 ))}
 </SettingsCard>
 </div>
 <p className="px-5 mt-4 text-[12px] text-txt-secondary dark:text-white/30">
 Ngôn ngữ giao diện sẽ thay đổi ngay lập tức. Nội dung truyện giữ nguyên ngôn ngữ gốc.
 </p>
 </div>
 );
}

/* ── Main Settings Screen ── */

export default function Settings({ onNavigate }: SettingsProps) {
 const { settings, updateSettings, isConfigured, hasElevenLabs, hasStoryProvider, systemStatus } = useSettings();
 const { user, signOut, isAdmin, isStaff } = useAuth();
 const ageUi = useAgeUi();
 const { refreshAll } = useData();
 const { locale } = useI18n();
 const { mode: themeMode, isDark, setMode: setThemeMode, nightPref, setNightPref } = useTheme();
 const [tab, setTab] = useState<SettingsTab>("main");
 const [busy, setBusy] = useState<string | null>(null);

 async function handleSignOut() {
 await signOut();
 onNavigate("login" as Screen);
 }

 async function handleExport() {
 setBusy("export");
 try {
 const data = await exportUserData();
 const blob = new Blob([JSON.stringify(data, null, 2)], {
 type: "application/json",
 });
 const url = URL.createObjectURL(blob);
 const a = document.createElement("a");
 a.href = url;
 a.download = `kecon-data-${Date.now()}.json`;
 a.click();
 URL.revokeObjectURL(url);
 } catch {
 /* ignore */
 } finally {
 setBusy(null);
 }
 }

 async function handleDelete() {
 if (
 !window.confirm(
 "Xoá toàn bộ truyện, giọng nói và dữ liệu của bạn? Hành động này không thể hoàn tác."
 )
 )
 return;
 setBusy("delete");
 try {
 await deleteUserData();
 await refreshAll();
 } catch {
 /* ignore */
 } finally {
 setBusy(null);
 }
 }

 if (tab === "language") {
 return <LanguagePanel onBack={() => setTab("main")} />;
 }

 if (tab === "api" && isAdmin) {
 return (
 <div className="min-h-screen bg-parent-bg font-parent pb-24">
 <ParentHeader title="API Keys" onBack={() => setTab("main")} />
 <ApiKeysPanel />
 </div>
 );
 }

 return (
 <div className="min-h-screen bg-parent-bg font-parent pb-28">
 <ParentHeader title="Bố mẹ" subtitle="Cài đặt, giờ ngủ và an toàn của bé" />

 <div className="px-5">
 {/* Status Banner */}
 {!isConfigured && (
 <div className="mt-4 p-3.5 rounded-[20px] bg-glow-soft flex items-start gap-2.5">
 <AlertCircle size={18} className="text-[#9A6A00] dark:text-glow mt-0.5 shrink-0" />
 <div>
 <p className="text-[13px] font-bold text-[#7A4A00] dark:text-glow">
 {systemStatus.hasElevenLabs || systemStatus.hasStoryProvider
 ? "Hệ thống đã sẵn sàng"
 : "Chưa cấu hình API"}
 </p>
 <p className="text-[12px] text-[#7A4A00] dark:text-glow/70 mt-0.5">
 {systemStatus.hasElevenLabs && systemStatus.hasStoryProvider
 ? "Admin đã cấu hình API. Bạn có thể sử dụng ngay!"
 : "Vui lòng liên hệ admin để cấu hình hệ thống."}
 </p>
 </div>
 </div>
 )}

 {/* AI Integration — BYO keys are admin-only (T05) */}
 {isAdmin && (
 <>
 <SectionHeader title="Tích hợp AI" />
 <SettingsCard>
 <SettingsRow
 icon={Key}
 label="API Keys"
 
 onClick={() => setTab("api")}
 badge={isConfigured ? "ok" : "warn"}
 />
 <SettingsRow
 icon={Mic}
 label="ElevenLabs Voice"
 value={hasElevenLabs ? "Đã kết nối" : "Chưa cấu hình"}
 
 onClick={() => setTab("api")}
 badge={hasElevenLabs ? "ok" : "warn"}
 />
 <SettingsRow
 icon={BookOpen}
 label="AI cốt truyện"
 value={PROVIDER_MODELS[settings.storyProvider]?.label}
 
 onClick={() => setTab("api")}
 badge={hasStoryProvider ? "ok" : "warn"}
 />
 </SettingsCard>
 </>
 )}

 {/* App Settings */}
 <SectionHeader title="Ứng dụng" />
 <SettingsCard>
 <SettingsRow
 icon={Globe}
 label="Ngôn ngữ"
 value={LOCALE_LABELS[locale]}
 
 onClick={() => setTab("language")}
 />
 <SettingsRow
 icon={Moon}
 label="Giao diện tối"
 value={themeMode === "system" ? "Hệ thống" : isDark ? "Bật" : "Tắt"}
 
 onClick={() => setThemeMode(themeMode === "light" ? "dark" : themeMode === "dark" ? "system" : "light")}
 />
 <SettingsRow
 icon={MoonStars}
 label="Chế độ ngủ"
 value={nightPref === "auto" ? "Tự động 19:30–6:00" : nightPref === "on" ? "Luôn bật" : "Tắt"}
 
 onClick={() => setNightPref(nightPref === "auto" ? "on" : nightPref === "on" ? "off" : "auto")}
 />
 <SettingsRow
 icon={Timer}
 label="Hẹn giờ ngủ"
 value={`${settings.sleepTimerDefault || 15} phút`}
 tone="glow"
 onClick={() => {
 const opts = SLEEP_TIMER_OPTIONS as readonly number[];
 const i = opts.indexOf(settings.sleepTimerDefault);
 updateSettings({ sleepTimerDefault: opts[(i + 1) % opts.length] });
 }}
 />
 <SettingsRow
 icon={Bell}
 label="Nhắc giờ đọc truyện"
 value={
 !isPushSupported()
 ? "Không hỗ trợ"
 : getPermissionState() === "granted"
 ? "Đã bật"
 : "Tắt"
 }
 tone="glow"
 onClick={async () => {
 if (!isPushSupported()) return;
 if (getPermissionState() === "granted") {
 await unsubscribeFromPush();
 } else {
 await subscribeToPush();
 }
 }}
 />
 <SettingsRow
 icon={Crown}
 label="Gói cước"
 value="Xem chi tiết"
 tone="glow"
 onClick={() => onNavigate("subscription")}
 />
 </SettingsCard>

 {/* UI-11: sound, haptics, Đóm's voice */}
 <SectionHeader title="Âm thanh & rung" />
 <FeedbackSettings nightPref={nightPref} />

 {/* Family */}
 <SectionHeader title="Gia đình & bé" />
 <SettingsCard>
 <SettingsRow icon={Mail} label="Thông báo" onClick={() => onNavigate("notifications")} />
 <SettingsRow icon={Trophy} label="Thành tích & huy hiệu" tone="glow" onClick={() => onNavigate("achievements")} />
 <SettingsRow icon={Shield} label="Kiểm soát phụ huynh" tone="success" onClick={() => onNavigate("parental-controls")} />
 <SettingsRow icon={User} label="Hồ sơ gia đình" value={`${ageUi.short} · ${ageUi.label}`} onClick={() => onNavigate("profile-edit")} />
 <SettingsRow icon={BarChart3} label="Thống kê của bé" onClick={() => onNavigate("parent-analytics")} />
 </SettingsCard>

 {/* Privacy & Data */}
 <SectionHeader title="Quyền riêng tư & dữ liệu" />
 <SettingsCard>
 <SettingsRow
 icon={Download}
 label="Xuất dữ liệu (GDPR)"
 value={busy === "export" ? "Đang xuất..." : "JSON"}
 
 onClick={handleExport}
 />
 <SettingsRow
 icon={Trash2}
 label="Xoá toàn bộ dữ liệu"
 value={busy === "delete" ? "Đang xoá..." : undefined}
 tone="danger"
 onClick={handleDelete}
 />
 </SettingsCard>

 {/* Admin — A-02: every staff role (the console shows only what the role allows) */}
 {isStaff && (
 <>
 <SectionHeader title="Quản trị" />
 <SettingsCard>
 <SettingsRow
 icon={LayoutDashboard}
 label="Trang quản trị"
 onClick={() => onNavigate("admin")}
 />
 </SettingsCard>
 </>
 )}

 {/* Other */}
 <SectionHeader title="Khác" />
 <SettingsCard>
 <SettingsRow icon={Shield} label="Bảo mật & quyền riêng tư" onClick={() => {}} />
 <SettingsRow icon={Info} label="Về KểCon" value="v1.0.0" onClick={() => {}} />
 {user && (
 <SettingsRow icon={LogOut} label="Đăng xuất" tone="danger" onClick={handleSignOut} />
 )}
 </SettingsCard>

 {/* Bottom Spacer */}
 <div className="h-6" />
 </div>
 </div>
 );
}
