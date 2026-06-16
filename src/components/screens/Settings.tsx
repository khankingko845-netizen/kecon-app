"use client";

import { useState } from "react";
import {
  ChevronRight, Key, Mic, BookOpen, Globe, Bell,
  Moon, Info, LogOut, Shield, Check, AlertCircle, ExternalLink, Trophy, BarChart3,
  Download, Trash2, Crown, LayoutDashboard, User,
} from "lucide-react";
import { useSettings, type StoryProvider } from "@/lib/settings-context";
import { useAuth } from "@/lib/auth-context";
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
import type { Screen } from "@/lib/types";

interface SettingsProps {
  onNavigate: (screen: Screen) => void;
}

type SettingsTab = "main" | "api" | "voice" | "story" | "about" | "language";

/* ── Shared sub-components ── */

function SectionHeader({ title }: { title: string }) {
  return (
    <h3 className="text-[11px] font-bold uppercase tracking-widest text-txt-secondary/60 dark:text-white/30 px-1 mt-6 mb-2">
      {title}
    </h3>
  );
}

function SettingsCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-white/[0.04] rounded-2xl border border-gray-100/80 dark:border-white/[0.06] overflow-hidden divide-y divide-gray-50 dark:divide-white/[0.04]">
      {children}
    </div>
  );
}

function SettingsRow({
  icon: Icon,
  label,
  value,
  onClick,
  color,
  badge,
  isFirst,
  isLast,
}: {
  icon: typeof Key;
  label: string;
  value?: string;
  onClick?: () => void;
  color?: string;
  badge?: "ok" | "warn";
  isFirst?: boolean;
  isLast?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3.5 px-4 py-3.5 active:bg-gray-50/50 dark:active:bg-white/[0.03] transition-colors"
    >
      <div
        className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 shadow-sm"
        style={{
          background: color
            ? `linear-gradient(135deg, ${color}, ${color}dd)`
            : undefined,
        }}
      >
        <Icon size={17} className={color ? "text-white" : "text-txt-secondary dark:text-white/50"} />
      </div>
      <span className="flex-1 text-left text-[15px] font-semibold text-txt dark:text-white/90">
        {label}
      </span>
      {badge === "ok" && (
        <span className="w-[22px] h-[22px] rounded-full bg-emerald-500/90 flex items-center justify-center shadow-sm shadow-emerald-500/20">
          <Check size={12} className="text-white" strokeWidth={3} />
        </span>
      )}
      {badge === "warn" && (
        <span className="w-[22px] h-[22px] rounded-full bg-amber-400 flex items-center justify-center shadow-sm shadow-amber-400/20">
          <AlertCircle size={12} className="text-white" strokeWidth={3} />
        </span>
      )}
      {value && (
        <span className="text-[13px] text-txt-secondary/70 dark:text-white/35 font-medium max-w-[130px] truncate">
          {value}
        </span>
      )}
      <ChevronRight size={15} className="text-gray-300 dark:text-white/15 shrink-0" />
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
      <SectionHeader title="ELEVENLABS — GIỌNG NÓI AI" />
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

      <SectionHeader title="AI TẠO CỐT TRUYỆN" />
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
    <div className="min-h-screen bg-surface dark:bg-[#0A0A0F] pb-24">
      <div className="px-5 pt-14 pb-3 flex items-center gap-3">
        <button onClick={onBack} className="text-accent text-sm font-semibold">
          ‹ Quay lại
        </button>
        <h2 className="text-[22px] font-black tracking-tight flex-1 dark:text-white">
          Ngôn Ngữ
        </h2>
      </div>
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
  const { settings, isConfigured, hasElevenLabs, hasStoryProvider, systemStatus } = useSettings();
  const { user, signOut, isAdmin } = useAuth();
  const { refreshAll } = useData();
  const { locale } = useI18n();
  const { mode: themeMode, isDark, setMode: setThemeMode } = useTheme();
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

  if (tab === "api") {
    return (
      <div className="min-h-screen bg-surface dark:bg-[#0A0A0F] pb-24">
        <div className="px-5 pt-14 pb-3 flex items-center gap-3">
          <button
            onClick={() => setTab("main")}
            className="text-accent text-sm font-semibold"
          >
            ‹ Quay lại
          </button>
          <h2 className="text-[22px] font-black tracking-tight flex-1 dark:text-white">
            API Keys
          </h2>
        </div>
        <ApiKeysPanel />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface dark:bg-[#0A0A0F] pb-24">
      {/* Header */}
      <div className="px-5 pt-14 pb-1">
        <h2 className="text-[28px] font-black tracking-tight mb-0.5 dark:text-white">
          Cài Đặt
        </h2>
        <p className="text-[13px] text-txt-secondary dark:text-white/35 font-medium">
          Quản lý ứng dụng & API
        </p>
      </div>

      <div className="px-5">
        {/* Status Banner */}
        {!isConfigured && (
          <div className="mt-4 p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 flex items-start gap-2.5">
            <AlertCircle size={18} className="text-amber-500 mt-0.5 shrink-0" />
            <div>
              <p className="text-[13px] font-bold text-amber-800 dark:text-amber-300">
                {systemStatus.hasElevenLabs || systemStatus.hasStoryProvider
                  ? "Hệ thống đã sẵn sàng"
                  : "Chưa cấu hình API"}
              </p>
              <p className="text-[12px] text-amber-700 dark:text-amber-400/70 mt-0.5">
                {systemStatus.hasElevenLabs && systemStatus.hasStoryProvider
                  ? "Admin đã cấu hình API. Bạn có thể sử dụng ngay!"
                  : "Thêm API keys hoặc liên hệ admin để cấu hình."}
              </p>
            </div>
          </div>
        )}

        {/* AI Integration */}
        <SectionHeader title="TÍCH HỢP AI" />
        <SettingsCard>
          <SettingsRow
            icon={Key}
            label="API Keys"
            color="#FF6B3D"
            onClick={() => setTab("api")}
            badge={isConfigured ? "ok" : "warn"}
          />
          <SettingsRow
            icon={Mic}
            label="ElevenLabs Voice"
            value={hasElevenLabs ? "Đã kết nối" : "Chưa cấu hình"}
            color="#7B61FF"
            onClick={() => setTab("api")}
            badge={hasElevenLabs ? "ok" : "warn"}
          />
          <SettingsRow
            icon={BookOpen}
            label="AI Cốt Truyện"
            value={PROVIDER_MODELS[settings.storyProvider]?.label}
            color="#00D68F"
            onClick={() => setTab("api")}
            badge={hasStoryProvider ? "ok" : "warn"}
          />
        </SettingsCard>

        {/* App Settings */}
        <SectionHeader title="ỨNG DỤNG" />
        <SettingsCard>
          <SettingsRow
            icon={Globe}
            label="Ngôn Ngữ"
            value={LOCALE_LABELS[locale]}
            color="#3B82F6"
            onClick={() => setTab("language")}
          />
          <SettingsRow
            icon={Moon}
            label="Chế Độ Tối"
            value={themeMode === "system" ? "Hệ thống" : isDark ? "Bật" : "Tắt"}
            color="#6366F1"
            onClick={() => setThemeMode(themeMode === "light" ? "dark" : themeMode === "dark" ? "system" : "light")}
          />
          <SettingsRow
            icon={Bell}
            label="Thông Báo"
            value={
              !isPushSupported()
                ? "Không hỗ trợ"
                : getPermissionState() === "granted"
                  ? "Đã bật"
                  : "Tắt"
            }
            color="#F59E0B"
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
            label="Gói Cước"
            value="Xem chi tiết"
            color="#F59E0B"
            onClick={() => onNavigate("subscription")}
          />
        </SettingsCard>

        {/* Family */}
        <SectionHeader title="GIA ĐÌNH" />
        <SettingsCard>
          <SettingsRow icon={Trophy} label="Thành Tích & Huy Hiệu" color="#F59E0B" onClick={() => onNavigate("achievements")} />
          <SettingsRow icon={Shield} label="Kiểm Soát Phụ Huynh" color="#8B5CF6" onClick={() => onNavigate("parental-controls")} />
          <SettingsRow icon={User} label="Hồ Sơ Gia Đình" color="#6366F1" onClick={() => onNavigate("profile-edit")} />
          <SettingsRow icon={BarChart3} label="Thống Kê Bé" color="#10B981" onClick={() => onNavigate("parent-analytics")} />
        </SettingsCard>

        {/* Privacy & Data */}
        <SectionHeader title="QUYỀN RIÊNG TƯ & DỮ LIỆU" />
        <SettingsCard>
          <SettingsRow
            icon={Download}
            label="Xuất Dữ Liệu (GDPR)"
            value={busy === "export" ? "Đang xuất..." : "JSON"}
            color="#0EA5E9"
            onClick={handleExport}
          />
          <SettingsRow
            icon={Trash2}
            label="Xoá Toàn Bộ Dữ Liệu"
            value={busy === "delete" ? "Đang xoá..." : undefined}
            color="#EF4444"
            onClick={handleDelete}
          />
        </SettingsCard>

        {/* Admin */}
        {isAdmin && (
          <>
            <SectionHeader title="QUẢN TRỊ" />
            <SettingsCard>
              <SettingsRow
                icon={LayoutDashboard}
                label="Admin Dashboard"
                color="#7C3AED"
                onClick={() => onNavigate("admin")}
              />
            </SettingsCard>
          </>
        )}

        {/* Other */}
        <SectionHeader title="KHÁC" />
        <SettingsCard>
          <SettingsRow icon={Shield} label="Bảo Mật & Quyền Riêng Tư" color="#64748B" onClick={() => {}} />
          <SettingsRow icon={Info} label="Về KểCon" value="v1.0.0" color="#94A3B8" onClick={() => {}} />
          {user && (
            <SettingsRow icon={LogOut} label="Đăng Xuất" color="#EF4444" onClick={handleSignOut} />
          )}
        </SettingsCard>

        {/* Bottom Spacer */}
        <div className="h-6" />
      </div>
    </div>
  );
}
