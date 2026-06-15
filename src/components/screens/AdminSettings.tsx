"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Save, Loader2, Check, Eye, EyeOff, ExternalLink,
  Mic, Brain, Image, RefreshCw, Plug, AlertCircle, ChevronDown,
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

/* ──────────────── types ──────────────── */
interface VoiceOption {
  voice_id: string;
  name: string;
  category: string;
  language: string;
}
interface TestResult {
  ok: boolean;
  models?: string[];
  voices?: VoiceOption[];
  error?: string;
}

/* ──────────────── tiny helpers ──────────────── */
const SECRET_KEYS = new Set([
  "elevenlabs_api_key", "openai_api_key", "gemini_api_key",
  "anthropic_api_key", "custom_provider_key", "dalle_api_key",
]);

const AI_PROVIDERS = [
  { id: "openai", label: "OpenAI", color: "#10A37F" },
  { id: "gemini", label: "Gemini", color: "#4285F4" },
  { id: "anthropic", label: "Claude", color: "#D97706" },
  { id: "custom", label: "Custom", color: "#6B7280" },
] as const;

function SectionIcon({ icon: Icon, color }: { icon: typeof Mic; color: string }) {
  return (
    <div
      className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
      style={{ background: color, color: "#fff" }}
    >
      <Icon size={14} />
    </div>
  );
}

function SecretInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="flex gap-2">
      <input
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="flex-1 px-3.5 py-3 rounded-xl border border-gray-200 bg-surface text-sm font-mono outline-none focus:border-accent transition-colors"
      />
      <button
        type="button"
        onClick={() => setShow(!show)}
        className="px-3 py-3 rounded-xl border border-gray-200 text-txt-secondary hover:bg-gray-50 transition-colors"
      >
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}

function TestButton({
  loading,
  result,
  onClick,
}: {
  loading: boolean;
  result: TestResult | null;
  onClick: () => void;
}) {
  return (
    <div className="flex items-center gap-2.5 flex-wrap">
      <button
        type="button"
        onClick={onClick}
        disabled={loading}
        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-gray-200 text-[13px] font-bold text-txt-secondary hover:bg-gray-50 active:scale-[0.97] transition-all disabled:opacity-50"
      >
        {loading ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <Plug size={14} />
        )}
        Test Kết Nối
      </button>
      {result && (
        <span
          className={`text-[12px] font-semibold ${
            result.ok ? "text-emerald-600" : "text-red-500"
          }`}
        >
          {result.ok
            ? `✅ Kết nối thành công${
                result.models
                  ? ` · ${result.models.length} models`
                  : result.voices
                  ? ` · ${result.voices.length} voices`
                  : ""
              }`
            : `❌ ${result.error || "Kết nối thất bại"}`}
        </span>
      )}
    </div>
  );
}

function ModelSelect({
  value,
  onChange,
  models,
  placeholder,
  allowFreeText,
}: {
  value: string;
  onChange: (v: string) => void;
  models: string[];
  placeholder: string;
  allowFreeText?: boolean;
}) {
  if (models.length === 0 && allowFreeText) {
    return (
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3.5 py-3 rounded-xl border border-gray-200 bg-surface text-sm font-mono outline-none focus:border-accent transition-colors"
      />
    );
  }
  if (models.length === 0) {
    return (
      <div className="px-3.5 py-3 rounded-xl border border-gray-200 bg-gray-50 text-sm text-txt-secondary">
        Nhấn &quot;Test Kết Nối&quot; để tải danh sách models
      </div>
    );
  }
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3.5 py-3 rounded-xl border border-gray-200 bg-surface text-sm font-semibold outline-none focus:border-accent transition-colors appearance-none pr-10"
      >
        <option value="">— Chọn model —</option>
        {models.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
      <ChevronDown
        size={16}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-txt-secondary pointer-events-none"
      />
    </div>
  );
}

function VoiceSelect({
  value,
  onChange,
  voices,
  filterLanguage,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  voices: VoiceOption[];
  filterLanguage?: string;
  label: string;
}) {
  const filtered = filterLanguage
    ? voices.filter(
        (v) =>
          v.language.toLowerCase().includes(filterLanguage.toLowerCase()) ||
          !filterLanguage
      )
    : voices;

  return (
    <div>
      <label className="text-[12px] font-bold text-txt-secondary mb-1.5 block">
        {label}
      </label>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-3.5 py-3 rounded-xl border border-gray-200 bg-surface text-sm font-semibold outline-none focus:border-accent transition-colors appearance-none pr-10"
        >
          <option value="">— Không đặt (dùng voice người dùng) —</option>
          {filtered.length > 0 && (
            <optgroup label={`Phù hợp ${filterLanguage || "tất cả"}`}>
              {filtered.map((v) => (
                <option key={v.voice_id} value={v.voice_id}>
                  {v.name} ({v.category}){v.language ? ` · ${v.language}` : ""}
                </option>
              ))}
            </optgroup>
          )}
          {filterLanguage && voices.length > filtered.length && (
            <optgroup label="Tất cả voices">
              {voices
                .filter(
                  (v) =>
                    !v.language
                      .toLowerCase()
                      .includes(filterLanguage.toLowerCase())
                )
                .map((v) => (
                  <option key={v.voice_id} value={v.voice_id}>
                    {v.name} ({v.category}){v.language ? ` · ${v.language}` : ""}
                  </option>
                ))}
            </optgroup>
          )}
        </select>
        <ChevronDown
          size={16}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-txt-secondary pointer-events-none"
        />
      </div>
    </div>
  );
}

/* ──────────────── main component ──────────────── */
export default function AdminSettings({ onBack }: AdminSettingsProps) {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [original, setOriginal] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Test results & fetched data
  const [elevenTest, setElevenTest] = useState<TestResult | null>(null);
  const [elevenTesting, setElevenTesting] = useState(false);
  const [voices, setVoices] = useState<VoiceOption[]>([]);

  const [aiTest, setAiTest] = useState<TestResult | null>(null);
  const [aiTesting, setAiTesting] = useState(false);
  const [aiModels, setAiModels] = useState<string[]>([]);

  const [dalleTest, setDalleTest] = useState<TestResult | null>(null);
  const [dalleTesting, setDalleTesting] = useState(false);

  const selectedProvider = settings["default_ai_provider"] || "openai";

  // ── load settings ──
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

  // ── test provider ──
  async function testProvider(
    provider: string,
    apiKey: string,
    baseUrl?: string
  ): Promise<TestResult> {
    const res = await fetch("/api/admin/test-provider", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, apiKey, baseUrl }),
    });
    return res.json();
  }

  async function handleTestElevenLabs() {
    const key = settings["elevenlabs_api_key"];
    if (!key) {
      setElevenTest({ ok: false, error: "Nhập API key trước" });
      return;
    }
    setElevenTesting(true);
    setElevenTest(null);
    try {
      const result = await testProvider("elevenlabs", key);
      setElevenTest(result);
      if (result.ok && result.voices) {
        setVoices(result.voices);
      }
    } catch {
      setElevenTest({ ok: false, error: "Lỗi kết nối" });
    } finally {
      setElevenTesting(false);
    }
  }

  async function handleTestAI() {
    const providerKeyMap: Record<string, string> = {
      openai: "openai_api_key",
      gemini: "gemini_api_key",
      anthropic: "anthropic_api_key",
      custom: "custom_provider_key",
    };
    const key = settings[providerKeyMap[selectedProvider] || ""];
    if (!key) {
      setAiTest({ ok: false, error: "Nhập API key trước" });
      return;
    }
    setAiTesting(true);
    setAiTest(null);
    try {
      const result = await testProvider(
        selectedProvider,
        key,
        selectedProvider === "custom" ? settings["custom_provider_url"] : undefined
      );
      setAiTest(result);
      if (result.ok && result.models) {
        setAiModels(result.models);
      }
    } catch {
      setAiTest({ ok: false, error: "Lỗi kết nối" });
    } finally {
      setAiTesting(false);
    }
  }

  async function handleTestDalle() {
    const key = settings["dalle_api_key"];
    if (!key) {
      setDalleTest({ ok: false, error: "Nhập API key trước" });
      return;
    }
    setDalleTesting(true);
    setDalleTest(null);
    try {
      const result = await testProvider("dalle", key);
      setDalleTest(result);
    } catch {
      setDalleTest({ ok: false, error: "Lỗi kết nối" });
    } finally {
      setDalleTesting(false);
    }
  }

  // ── save ──
  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
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

  // ── helper: get AI key field for selected provider ──
  function aiKeyField() {
    const map: Record<string, { key: string; placeholder: string; helpUrl?: string; helpLabel?: string }> = {
      openai: {
        key: "openai_api_key",
        placeholder: "sk-...",
        helpUrl: "https://platform.openai.com/api-keys",
        helpLabel: "Lấy OpenAI Key",
      },
      gemini: {
        key: "gemini_api_key",
        placeholder: "AIza...",
        helpUrl: "https://aistudio.google.com/apikey",
        helpLabel: "Lấy Gemini Key",
      },
      anthropic: {
        key: "anthropic_api_key",
        placeholder: "sk-ant-...",
        helpUrl: "https://console.anthropic.com/settings/keys",
        helpLabel: "Lấy Claude Key",
      },
      custom: { key: "custom_provider_key", placeholder: "API key" },
    };
    return map[selectedProvider] || map.openai;
  }

  // ── render ──
  if (loading) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <Loader2 className="animate-spin text-accent" size={32} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface pb-32">
      <TopBar title="Cài Đặt Hệ Thống" onBack={onBack} />

      {/* Info banner */}
      <div className="mx-5 mt-4 p-3.5 rounded-2xl bg-blue-50 border border-blue-200">
        <p className="text-[13px] text-blue-800 font-medium leading-relaxed">
          <strong>API Keys hệ thống</strong> — cấu hình tại đây áp dụng cho{" "}
          <em>tất cả người dùng</em>. Người dùng có thể ghi đè bằng key riêng.
        </p>
      </div>

      {/* ═══════════ ELEVENLABS ═══════════ */}
      <div className="flex items-center gap-2.5 px-5 mt-6 mb-2">
        <SectionIcon icon={Mic} color="#7B61FF" />
        <h3 className="text-[13px] font-bold uppercase tracking-widest text-txt-secondary">
          Giọng Nói (ElevenLabs)
        </h3>
      </div>
      <div className="bg-white px-5 py-4 space-y-4">
        {/* API Key */}
        <div>
          <label className="text-[12px] font-bold text-txt-secondary mb-1.5 block">
            API Key
          </label>
          <SecretInput
            value={settings["elevenlabs_api_key"] ?? ""}
            onChange={(v) => handleChange("elevenlabs_api_key", v)}
            placeholder="sk_..."
          />
          <a
            href="https://elevenlabs.io/app/settings/api-keys"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-accent text-[12px] font-semibold mt-1.5"
          >
            Lấy API Key <ExternalLink size={12} />
          </a>
        </div>

        {/* Test */}
        <TestButton
          loading={elevenTesting}
          result={elevenTest}
          onClick={handleTestElevenLabs}
        />

        {/* Model */}
        <div>
          <label className="text-[12px] font-bold text-txt-secondary mb-1.5 block">
            Model TTS
          </label>
          <div className="relative">
            <select
              value={settings["elevenlabs_model_id"] ?? "eleven_multilingual_v2"}
              onChange={(e) => handleChange("elevenlabs_model_id", e.target.value)}
              className="w-full px-3.5 py-3 rounded-xl border border-gray-200 bg-surface text-sm font-semibold outline-none focus:border-accent transition-colors appearance-none pr-10"
            >
              <option value="eleven_multilingual_v2">
                Multilingual v2 (tốt nhất cho tiếng Việt)
              </option>
              <option value="eleven_turbo_v2_5">Turbo v2.5 (nhanh)</option>
              <option value="eleven_flash_v2_5">Flash v2.5 (rẻ nhất)</option>
            </select>
            <ChevronDown
              size={16}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-txt-secondary pointer-events-none"
            />
          </div>
        </div>

        {/* Default Voice per language */}
        {voices.length > 0 ? (
          <div className="space-y-3 pt-1">
            <p className="text-[12px] font-bold text-txt-secondary uppercase tracking-widest">
              Giọng mặc định theo ngôn ngữ
            </p>
            <VoiceSelect
              label="🇻🇳 Tiếng Việt"
              value={settings["elevenlabs_default_voice_vi"] ?? ""}
              onChange={(v) => handleChange("elevenlabs_default_voice_vi", v)}
              voices={voices}
              filterLanguage="vietnamese"
            />
            <VoiceSelect
              label="🇺🇸 English"
              value={settings["elevenlabs_default_voice_en"] ?? ""}
              onChange={(v) => handleChange("elevenlabs_default_voice_en", v)}
              voices={voices}
              filterLanguage="english"
            />
            <VoiceSelect
              label="🇯🇵 日本語"
              value={settings["elevenlabs_default_voice_ja"] ?? ""}
              onChange={(v) => handleChange("elevenlabs_default_voice_ja", v)}
              voices={voices}
              filterLanguage="japanese"
            />
          </div>
        ) : (
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-gray-50 border border-gray-200">
            <AlertCircle size={14} className="text-gray-400" />
            <span className="text-[12px] text-txt-secondary">
              Nhấn &quot;Test Kết Nối&quot; để tải danh sách voices và chọn giọng mặc định
            </span>
          </div>
        )}
      </div>

      {/* ═══════════ AI STORY PROVIDER ═══════════ */}
      <div className="flex items-center gap-2.5 px-5 mt-6 mb-2">
        <SectionIcon icon={Brain} color="#00D68F" />
        <h3 className="text-[13px] font-bold uppercase tracking-widest text-txt-secondary">
          AI Tạo Truyện
        </h3>
      </div>
      <div className="bg-white px-5 py-4 space-y-4">
        {/* Provider selector */}
        <div>
          <label className="text-[12px] font-bold text-txt-secondary mb-1.5 block">
            Provider Mặc Định
          </label>
          <div className="grid grid-cols-4 gap-1.5">
            {AI_PROVIDERS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  handleChange("default_ai_provider", p.id);
                  // Reset test results when switching provider
                  setAiTest(null);
                  setAiModels([]);
                }}
                className={`py-2.5 rounded-xl text-[12px] font-bold border-[1.5px] transition-all ${
                  selectedProvider === p.id
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-gray-200 bg-surface text-txt-secondary"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Custom URL (only for custom provider) */}
        {selectedProvider === "custom" && (
          <div>
            <label className="text-[12px] font-bold text-txt-secondary mb-1.5 block">
              Base URL (OpenAI-compatible)
            </label>
            <input
              type="text"
              value={settings["custom_provider_url"] ?? ""}
              onChange={(e) => handleChange("custom_provider_url", e.target.value)}
              placeholder="https://openrouter.ai/api/v1"
              className="w-full px-3.5 py-3 rounded-xl border border-gray-200 bg-surface text-sm font-mono outline-none focus:border-accent transition-colors"
            />
            <p className="text-[11px] text-txt-secondary mt-1">
              Hỗ trợ OpenRouter, Groq, Together, LM Studio, Ollama…
            </p>
          </div>
        )}

        {/* API Key for selected provider */}
        <div>
          <label className="text-[12px] font-bold text-txt-secondary mb-1.5 block">
            API Key — {AI_PROVIDERS.find((p) => p.id === selectedProvider)?.label}
          </label>
          <SecretInput
            value={settings[aiKeyField().key] ?? ""}
            onChange={(v) => handleChange(aiKeyField().key, v)}
            placeholder={aiKeyField().placeholder}
          />
          {aiKeyField().helpUrl && (
            <a
              href={aiKeyField().helpUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-accent text-[12px] font-semibold mt-1.5"
            >
              {aiKeyField().helpLabel} <ExternalLink size={12} />
            </a>
          )}
        </div>

        {/* Test */}
        <TestButton
          loading={aiTesting}
          result={aiTest}
          onClick={handleTestAI}
        />

        {/* Model selector (auto-fetched or free text) */}
        <div>
          <label className="text-[12px] font-bold text-txt-secondary mb-1.5 block">
            Model Mặc Định
          </label>
          <ModelSelect
            value={settings["default_ai_model"] ?? ""}
            onChange={(v) => handleChange("default_ai_model", v)}
            models={aiModels}
            placeholder="vd: gpt-4o-mini"
            allowFreeText={selectedProvider === "custom" || aiModels.length === 0}
          />
          {aiModels.length === 0 && (
            <p className="text-[11px] text-txt-secondary mt-1">
              Nhấn &quot;Test Kết Nối&quot; để tải danh sách models từ provider
            </p>
          )}
        </div>
      </div>

      {/* ═══════════ IMAGE / DALLE ═══════════ */}
      <div className="flex items-center gap-2.5 px-5 mt-6 mb-2">
        <SectionIcon icon={Image} color="#FF6B3D" />
        <h3 className="text-[13px] font-bold uppercase tracking-widest text-txt-secondary">
          Minh Họa AI (DALL·E)
        </h3>
      </div>
      <div className="bg-white px-5 py-4 space-y-4">
        <div>
          <label className="text-[12px] font-bold text-txt-secondary mb-1.5 block">
            OpenAI API Key (DALL·E)
          </label>
          <SecretInput
            value={settings["dalle_api_key"] ?? ""}
            onChange={(v) => handleChange("dalle_api_key", v)}
            placeholder="sk-..."
          />
          <p className="text-[11px] text-txt-secondary mt-1">
            Dùng chung key OpenAI. Nếu để trống sẽ fallback sang OpenAI Key ở mục AI.
          </p>
        </div>
        <TestButton
          loading={dalleTesting}
          result={dalleTest}
          onClick={handleTestDalle}
        />
      </div>

      {/* ═══════════ ERROR ═══════════ */}
      {error && (
        <div className="mx-5 mt-4 p-3 rounded-xl bg-red-50 border border-red-200">
          <p className="text-[13px] text-red-700 font-medium">{error}</p>
        </div>
      )}

      {/* ═══════════ SAVE ═══════════ */}
      <div className="px-5 mt-6">
        <button
          type="button"
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

      <div className="px-5 mt-3 flex items-center gap-2 text-[12px] text-txt-secondary">
        <RefreshCw size={12} />
        <span>Thay đổi có hiệu lực ngay, không cần khởi động lại.</span>
      </div>
    </div>
  );
}
