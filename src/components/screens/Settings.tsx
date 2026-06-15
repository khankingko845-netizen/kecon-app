"use client";

import { useState } from "react";
import {
  ChevronRight, Key, Mic, BookOpen, Globe, Bell,
  Moon, Info, LogOut, Shield, Check, AlertCircle, ExternalLink,
  Download, Trash2,
} from "lucide-react";
import { useSettings, type StoryProvider } from "@/lib/settings-context";
import { useAuth } from "@/lib/auth-context";
import { useData } from "@/lib/data-context";
import { PROVIDER_MODELS } from "@/lib/story-ai";
import { exportUserData, deleteUserData } from "@/lib/db";
import { useI18n, LOCALE_LABELS, type Locale } from "@/lib/i18n";
import type { Screen } from "@/lib/types";

interface SettingsProps {
  onNavigate: (screen: Screen) => void;
}

type SettingsTab = "main" | "api" | "voice" | "story" | "about" | "language";

function SectionHeader({ title }: { title: string }) {
  return (
    <h3 className="text-[11px] font-bold uppercase tracking-widest text-txt-secondary px-5 mt-5 mb-2">
      {title}
    </h3>
  );
}

function SettingsRow({
  icon: Icon,
  label,
  value,
  onClick,
  color,
  badge,
}: {
  icon: typeof Key;
  label: string;
  value?: string;
  onClick?: () => void;
  color?: string;
  badge?: "ok" | "warn";
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-5 py-3.5 bg-white active:bg-gray-50 transition-colors"
    >
      <div
        className="w-8 h-8 rounded-[10px] flex items-center justify-center shrink-0"
        style={{ background: color || "#F3F4F6", color: color ? "#fff" : "#6B7280" }}
      >
        <Icon size={16} />
      </div>
      <span className="flex-1 text-left text-[15px] font-semibold text-txt">
        {label}
      </span>
      {badge === "ok" && (
        <span className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center">
          <Check size={12} className="text-white" />
        </span>
      )}
      {badge === "warn" && (
        <span className="w-5 h-5 rounded-full bg-amber-400 flex items-center justify-center">
          <AlertCircle size={12} className="text-white" />
        </span>
      )}
      {value && (
        <span className="text-[13px] text-txt-secondary font-medium max-w-[120px] truncate">
          {value}
        </span>
      )}
      <ChevronRight size={16} className="text-gray-300 shrink-0" />
    </button>
  );
}

function ApiKeysPanel() {
  const { settings, updateSettings } = useSettings();
  const [showElevenKey, setShowElevenKey] = useState(false);
  const [showStoryKey, setShowStoryKey] = useState(false);

  const providerInfo = PROVIDER_MODELS[settings.storyProvider];

  return (
    <div className="pb-10">
      <SectionHeader title="ELEVENLABS — GIỌNG NÓI AI" />
      <div className="bg-white px-5 py-4 space-y-3">
        <div>
          <label className="text-[12px] font-bold text-txt-secondary mb-1.5 block">
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
              className="flex-1 px-3.5 py-3 rounded-xl border border-gray-200 bg-surface text-sm font-mono outline-none focus:border-accent transition-colors"
            />
            <button
              onClick={() => setShowElevenKey(!showElevenKey)}
              className="px-3 py-3 rounded-xl border border-gray-200 text-xs font-bold text-txt-secondary"
            >
              {showElevenKey ? "Ẩn" : "Hiện"}
            </button>
          </div>
        </div>

        <div>
          <label className="text-[12px] font-bold text-txt-secondary mb-1.5 block">
            Model
          </label>
          <select
            value={settings.elevenLabsModelId}
            onChange={(e) =>
              updateSettings({ elevenLabsModelId: e.target.value })
            }
            className="w-full px-3.5 py-3 rounded-xl border border-gray-200 bg-surface text-sm font-semibold outline-none"
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

      <SectionHeader title="AI TẠO CỐT TRUYỆN" />
      <div className="bg-white px-5 py-4 space-y-3">
        <div>
          <label className="text-[12px] font-bold text-txt-secondary mb-1.5 block">
            Provider
          </label>
          <div className="flex gap-1.5 flex-wrap">
            {Object.entries(PROVIDER_MODELS).map(([key, val]) => (
              <button
                key={key}
                onClick={() => {
                  updateSettings({
                    storyProvider: key as StoryProvider,
                    // Keep model for custom (free text); reset for known providers.
                    storyModel: val.models[0]?.id ?? settings.storyModel,
                  });
                }}
                className={`flex-1 min-w-[72px] py-2.5 rounded-xl text-[13px] font-bold transition-all ${
                  settings.storyProvider === key
                    ? "bg-accent text-white"
                    : "bg-surface text-txt-secondary"
                }`}
              >
                {val.label}
              </button>
            ))}
          </div>
        </div>

        {settings.storyProvider === "custom" && (
          <div>
            <label className="text-[12px] font-bold text-txt-secondary mb-1.5 block">
              Base URL (OpenAI-compatible)
            </label>
            <input
              type="text"
              value={settings.storyBaseUrl}
              onChange={(e) =>
                updateSettings({ storyBaseUrl: e.target.value })
              }
              placeholder="https://openrouter.ai/api/v1"
              className="w-full px-3.5 py-3 rounded-xl border border-gray-200 bg-surface text-sm font-mono outline-none focus:border-accent transition-colors"
            />
            <p className="text-[11px] text-txt-secondary mt-1.5">
              Endpoint phải hỗ trợ <code>/chat/completions</code> kiểu OpenAI
              (OpenRouter, Groq, Together, LM Studio, Ollama…). Không thêm
              <code> /chat/completions</code> vào cuối.
            </p>
          </div>
        )}

        <div>
          <label className="text-[12px] font-bold text-txt-secondary mb-1.5 block">
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
              className="flex-1 px-3.5 py-3 rounded-xl border border-gray-200 bg-surface text-sm font-mono outline-none focus:border-accent transition-colors"
            />
            <button
              onClick={() => setShowStoryKey(!showStoryKey)}
              className="px-3 py-3 rounded-xl border border-gray-200 text-xs font-bold text-txt-secondary"
            >
              {showStoryKey ? "Ẩn" : "Hiện"}
            </button>
          </div>
        </div>

        <div>
          <label className="text-[12px] font-bold text-txt-secondary mb-1.5 block">
            Model
          </label>
          {settings.storyProvider === "custom" ? (
            <input
              type="text"
              value={settings.storyModel}
              onChange={(e) => updateSettings({ storyModel: e.target.value })}
              placeholder="ví dụ: openai/gpt-4o-mini, llama-3.1-70b…"
              className="w-full px-3.5 py-3 rounded-xl border border-gray-200 bg-surface text-sm font-mono outline-none focus:border-accent transition-colors"
            />
          ) : (
            <select
              value={settings.storyModel}
              onChange={(e) => updateSettings({ storyModel: e.target.value })}
              className="w-full px-3.5 py-3 rounded-xl border border-gray-200 bg-surface text-sm font-semibold outline-none"
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
    <div className="min-h-screen bg-surface pb-24">
      <div className="px-5 pt-14 pb-3 flex items-center gap-3">
        <button onClick={onBack} className="text-accent text-sm font-semibold">
          ‹ Quay lại
        </button>
        <h2 className="text-[22px] font-black tracking-tight flex-1">
          Ngôn Ngữ
        </h2>
      </div>
      <div className="bg-white divide-y divide-gray-100">
        {languages.map((lang) => (
          <button
            key={lang.id}
            onClick={() => setLocale(lang.id)}
            className="w-full flex items-center gap-3 px-5 py-4 active:bg-gray-50 transition-colors"
          >
            <span className="text-2xl">{lang.flag}</span>
            <span className="flex-1 text-left text-[15px] font-semibold text-txt">
              {LOCALE_LABELS[lang.id]}
            </span>
            {locale === lang.id && (
              <span className="w-6 h-6 rounded-full bg-accent flex items-center justify-center">
                <Check size={14} className="text-white" />
              </span>
            )}
          </button>
        ))}
      </div>
      <p className="px-5 mt-4 text-[12px] text-txt-secondary">
        Ngôn ngữ giao diện sẽ thay đổi ngay lập tức. Nội dung truyện giữ nguyên ngôn ngữ gốc.
      </p>
    </div>
  );
}

export default function Settings({ onNavigate }: SettingsProps) {
  const { settings, isConfigured } = useSettings();
  const { user, signOut } = useAuth();
  const { refreshAll } = useData();
  const { locale } = useI18n();
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
      <div className="min-h-screen bg-surface pb-24">
        <div className="px-5 pt-14 pb-3 flex items-center gap-3">
          <button
            onClick={() => setTab("main")}
            className="text-accent text-sm font-semibold"
          >
            ‹ Quay lại
          </button>
          <h2 className="text-[22px] font-black tracking-tight flex-1">
            API Keys
          </h2>
        </div>
        <ApiKeysPanel />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface pb-24">
      <div className="px-5 pt-14 pb-2">
        <h2 className="text-[28px] font-black tracking-tight mb-0.5">
          Cài Đặt
        </h2>
        <p className="text-[13px] text-txt-secondary font-medium">
          Quản lý ứng dụng & API
        </p>
      </div>

      {/* Status Banner */}
      {!isConfigured && (
        <div className="mx-5 mt-3 p-3.5 rounded-2xl bg-amber-50 border border-amber-200 flex items-start gap-2.5">
          <AlertCircle size={18} className="text-amber-500 mt-0.5 shrink-0" />
          <div>
            <p className="text-[13px] font-bold text-amber-800">
              Chưa cấu hình API
            </p>
            <p className="text-[12px] text-amber-700 mt-0.5">
              Thêm API keys để sử dụng tạo truyện AI và giọng nói.
            </p>
          </div>
        </div>
      )}

      <SectionHeader title="TÍCH HỢP AI" />
      <div className="bg-white divide-y divide-gray-100">
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
          value={settings.elevenLabsApiKey ? "Đã kết nối" : "Chưa cấu hình"}
          color="#7B61FF"
          onClick={() => setTab("api")}
          badge={settings.elevenLabsApiKey ? "ok" : "warn"}
        />
        <SettingsRow
          icon={BookOpen}
          label="AI Cốt Truyện"
          value={PROVIDER_MODELS[settings.storyProvider]?.label}
          color="#00D68F"
          onClick={() => setTab("api")}
          badge={settings.storyApiKey ? "ok" : "warn"}
        />
      </div>

      <SectionHeader title="ỨNG DỤNG" />
      <div className="bg-white divide-y divide-gray-100">
        <SettingsRow
          icon={Globe}
          label="Ngôn Ngữ"
          value={LOCALE_LABELS[locale]}
          onClick={() => setTab("language")}
        />
        <SettingsRow
          icon={Moon}
          label="Hẹn Giờ Ru Ngủ"
          value={`${settings.sleepTimerDefault} phút`}
          onClick={() => {}}
        />
        <SettingsRow
          icon={Bell}
          label="Thông Báo"
          value="Bật"
          onClick={() => {}}
        />
      </div>

      <SectionHeader title="QUYỀN RIÊNG TƯ & DỮ LIỆU" />
      <div className="bg-white divide-y divide-gray-100">
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
      </div>

      <SectionHeader title="KHÁC" />
      <div className="bg-white divide-y divide-gray-100">
        <SettingsRow icon={Shield} label="Bảo Mật & Quyền Riêng Tư" onClick={() => {}} />
        <SettingsRow icon={Info} label="Về KểCon" value="v1.0.0" onClick={() => {}} />
        {user && (
          <SettingsRow icon={LogOut} label="Đăng Xuất" color="#EF4444" onClick={handleSignOut} />
        )}
      </div>
    </div>
  );
}
