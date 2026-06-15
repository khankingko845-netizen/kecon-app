"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Save, Loader2, Check, Eye, EyeOff, ExternalLink,
  Key, Mic, Brain, Image, RefreshCw,
} from "lucide-react";
import TopBar from "@/components/ui/TopBar";
import {
  getAppSettings,
  updateAppSettings,
  type AppSettingRow,
} from "@/lib/db";

interface AdminSettingsProps {
  onBack: () => void;
}

interface SettingFieldConfig {
  key: string;
  label: string;
  placeholder: string;
  helpUrl?: string;
  helpLabel?: string;
  type?: "text" | "select";
  options?: { value: string; label: string }[];
}

const VOICE_FIELDS: SettingFieldConfig[] = [
  {
    key: "elevenlabs_api_key",
    label: "ElevenLabs API Key",
    placeholder: "sk_...",
    helpUrl: "https://elevenlabs.io/app/settings/api-keys",
    helpLabel: "Lấy API Key",
  },
  {
    key: "elevenlabs_model_id",
    label: "ElevenLabs Model",
    placeholder: "eleven_multilingual_v2",
    type: "select",
    options: [
      { value: "eleven_multilingual_v2", label: "Multilingual v2 (tốt nhất)" },
      { value: "eleven_turbo_v2_5", label: "Turbo v2.5 (nhanh)" },
      { value: "eleven_flash_v2_5", label: "Flash v2.5 (rẻ nhất)" },
    ],
  },
];

const AI_FIELDS: SettingFieldConfig[] = [
  {
    key: "default_ai_provider",
    label: "Default AI Provider",
    placeholder: "openai",
    type: "select",
    options: [
      { value: "openai", label: "OpenAI" },
      { value: "gemini", label: "Google Gemini" },
      { value: "anthropic", label: "Anthropic Claude" },
      { value: "custom", label: "Custom (OpenAI-compatible)" },
    ],
  },
  {
    key: "default_ai_model",
    label: "Default AI Model",
    placeholder: "gpt-4o-mini",
  },
  {
    key: "openai_api_key",
    label: "OpenAI API Key",
    placeholder: "sk-...",
    helpUrl: "https://platform.openai.com/api-keys",
    helpLabel: "Lấy OpenAI Key",
  },
  {
    key: "gemini_api_key",
    label: "Google Gemini API Key",
    placeholder: "AIza...",
    helpUrl: "https://aistudio.google.com/apikey",
    helpLabel: "Lấy Gemini Key",
  },
  {
    key: "anthropic_api_key",
    label: "Anthropic Claude API Key",
    placeholder: "sk-ant-...",
    helpUrl: "https://console.anthropic.com/settings/keys",
    helpLabel: "Lấy Claude Key",
  },
  {
    key: "custom_provider_url",
    label: "Custom Provider URL",
    placeholder: "https://openrouter.ai/api/v1",
  },
  {
    key: "custom_provider_key",
    label: "Custom Provider Key",
    placeholder: "API key của provider",
  },
];

const IMAGE_FIELDS: SettingFieldConfig[] = [
  {
    key: "dalle_api_key",
    label: "DALL·E / OpenAI Image API Key",
    placeholder: "sk-...",
    helpUrl: "https://platform.openai.com/api-keys",
    helpLabel: "Lấy OpenAI Key",
  },
];

const SECRET_KEYS = new Set([
  "elevenlabs_api_key",
  "openai_api_key",
  "gemini_api_key",
  "anthropic_api_key",
  "custom_provider_key",
  "dalle_api_key",
]);

function SettingField({
  config,
  value,
  onChange,
}: {
  config: SettingFieldConfig;
  value: string;
  onChange: (val: string) => void;
}) {
  const [showSecret, setShowSecret] = useState(false);
  const isSecret = SECRET_KEYS.has(config.key);

  if (config.type === "select" && config.options) {
    return (
      <div>
        <label className="text-[12px] font-bold text-txt-secondary mb-1.5 block">
          {config.label}
        </label>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-3.5 py-3 rounded-xl border border-gray-200 bg-surface text-sm font-semibold outline-none focus:border-accent transition-colors"
        >
          {config.options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <div>
      <label className="text-[12px] font-bold text-txt-secondary mb-1.5 block">
        {config.label}
      </label>
      <div className="flex gap-2">
        <input
          type={isSecret && !showSecret ? "password" : "text"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={config.placeholder}
          className="flex-1 px-3.5 py-3 rounded-xl border border-gray-200 bg-surface text-sm font-mono outline-none focus:border-accent transition-colors"
        />
        {isSecret && (
          <button
            onClick={() => setShowSecret(!showSecret)}
            className="px-3 py-3 rounded-xl border border-gray-200 text-txt-secondary hover:bg-gray-50 transition-colors"
          >
            {showSecret ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        )}
      </div>
      {config.helpUrl && (
        <a
          href={config.helpUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-accent text-[12px] font-semibold mt-1.5"
        >
          {config.helpLabel} <ExternalLink size={12} />
        </a>
      )}
    </div>
  );
}

export default function AdminSettings({ onBack }: AdminSettingsProps) {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [original, setOriginal] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await getAppSettings();
      const map: Record<string, string> = {};
      rows.forEach((r: AppSettingRow) => {
        map[r.key] = r.value;
      });
      setSettings(map);
      setOriginal(map);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể tải cài đặt");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleChange = (key: string, value: string) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const hasChanges = Object.keys(settings).some(
    (k) => settings[k] !== (original[k] ?? "")
  );

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      // Only save changed values
      const changed: Record<string, string> = {};
      for (const [k, v] of Object.entries(settings)) {
        if (v !== (original[k] ?? "")) {
          changed[k] = v;
        }
      }
      if (Object.keys(changed).length > 0) {
        await updateAppSettings(changed);
      }
      setOriginal({ ...settings });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lưu thất bại");
    } finally {
      setSaving(false);
    }
  };

  function SectionHeader({
    icon: Icon,
    title,
    color,
  }: {
    icon: typeof Key;
    title: string;
    color: string;
  }) {
    return (
      <div className="flex items-center gap-2.5 px-5 mt-6 mb-2">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center"
          style={{ background: color, color: "#fff" }}
        >
          <Icon size={14} />
        </div>
        <h3 className="text-[13px] font-bold uppercase tracking-widest text-txt-secondary">
          {title}
        </h3>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface pb-24">
      <TopBar title="Cài Đặt Hệ Thống" onBack={onBack} />

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="animate-spin text-accent" size={32} />
        </div>
      ) : (
        <>
          {/* Info banner */}
          <div className="mx-5 mt-4 p-3.5 rounded-2xl bg-blue-50 border border-blue-200">
            <p className="text-[13px] text-blue-800 font-medium leading-relaxed">
              <strong>API Keys hệ thống</strong> — Cấu hình tại đây sẽ áp dụng cho{" "}
              <em>tất cả người dùng</em>. Người dùng có thể ghi đè bằng key riêng trong
              Settings cá nhân.
            </p>
          </div>

          {/* Voice Section */}
          <SectionHeader icon={Mic} title="Giọng Nói (ElevenLabs)" color="#7B61FF" />
          <div className="bg-white mx-0 px-5 py-4 space-y-3">
            {VOICE_FIELDS.map((f) => (
              <SettingField
                key={f.key}
                config={f}
                value={settings[f.key] ?? ""}
                onChange={(v) => handleChange(f.key, v)}
              />
            ))}
          </div>

          {/* AI Section */}
          <SectionHeader icon={Brain} title="AI Tạo Truyện" color="#00D68F" />
          <div className="bg-white mx-0 px-5 py-4 space-y-3">
            {AI_FIELDS.map((f) => (
              <SettingField
                key={f.key}
                config={f}
                value={settings[f.key] ?? ""}
                onChange={(v) => handleChange(f.key, v)}
              />
            ))}
          </div>

          {/* Image Section */}
          <SectionHeader icon={Image} title="Minh Họa AI" color="#FF6B3D" />
          <div className="bg-white mx-0 px-5 py-4 space-y-3">
            {IMAGE_FIELDS.map((f) => (
              <SettingField
                key={f.key}
                config={f}
                value={settings[f.key] ?? ""}
                onChange={(v) => handleChange(f.key, v)}
              />
            ))}
          </div>

          {/* Error */}
          {error && (
            <div className="mx-5 mt-4 p-3 rounded-xl bg-red-50 border border-red-200">
              <p className="text-[13px] text-red-700 font-medium">{error}</p>
            </div>
          )}

          {/* Save Button */}
          <div className="px-5 mt-6">
            <button
              onClick={handleSave}
              disabled={saving || !hasChanges}
              className="w-full py-[16px] rounded-[14px] bg-gradient-to-r from-accent-2 to-accent text-white font-bold text-[15px] flex items-center justify-center gap-2 shadow-lg shadow-accent-2/30 disabled:opacity-50 active:scale-[0.98] transition-transform"
            >
              {saving ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  Đang lưu...
                </>
              ) : saved ? (
                <>
                  <Check size={18} />
                  Đã lưu thành công!
                </>
              ) : (
                <>
                  <Save size={18} />
                  Lưu Cài Đặt
                </>
              )}
            </button>
          </div>

          {/* Reload hint */}
          <div className="px-5 mt-3 flex items-center gap-2 text-[12px] text-txt-secondary">
            <RefreshCw size={12} />
            <span>Thay đổi có hiệu lực ngay, không cần khởi động lại.</span>
          </div>
        </>
      )}
    </div>
  );
}
