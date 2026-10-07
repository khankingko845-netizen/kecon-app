"use client";
import { useState, useEffect, useCallback } from "react";
import {
  getAppSettings,
  listProviderKeys,
  listSystemSecrets,
  setSystemSecret,
  updateAppSettings,
  type AppSettingRow,
} from "@/lib/db";
import {
  isSecretSettingKey,
  type SystemSecretStatus,
} from "@/lib/system-secrets";
import type { ProviderKeyRow } from "@/lib/provider-keys";
import { useAdminConfirm } from "@/components/admin/AdminConfirm";
import { confirmedAdminAction } from "@/lib/admin-confirmed-actions";
import {
  SECRET_LABELS,
  type VoiceOption,
  type DefaultVoiceRow,
  type TestResult,
} from "./types";
export function useAdminSettings(canManageSecrets: boolean) {
  const confirm = useAdminConfirm();
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [original, setOriginal] = useState<Record<string, string>>({});
  // A-04: API keys — status only (never the value) + keys newly typed in this session.
  const [secrets, setSecrets] = useState<Record<string, SystemSecretStatus>>(
    {},
  );
  // A-04b: voice key pools (ElevenLabs + Fish Audio) — statuses only.
  const [providerKeys, setProviderKeys] = useState<ProviderKeyRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [clearingKey, setClearingKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Test results & fetched data
  const [elevenTest, setElevenTest] = useState<TestResult | null>(null);
  const [elevenTesting, setElevenTesting] = useState(false);
  const [voices, setVoices] = useState<VoiceOption[]>([]);

  // Default voices from DB
  const [defaultVoices, setDefaultVoices] = useState<DefaultVoiceRow[]>([]);

  const [aiTest, setAiTest] = useState<TestResult | null>(null);
  const [aiTesting, setAiTesting] = useState(false);
  const [aiModels, setAiModels] = useState<string[]>([]);

  const [dalleTest, setDalleTest] = useState<TestResult | null>(null);
  const [dalleTesting, setDalleTesting] = useState(false);

  const selectedProvider = settings["default_ai_provider"] || "openai";

  // ── load settings + default voices ──
  const loadSecrets = useCallback(async () => {
    const [list, pool] = await Promise.all([
      listSystemSecrets(),
      listProviderKeys(),
    ]);
    setSecrets(Object.fromEntries(list.map((s) => [s.key, s])));
    setProviderKeys(pool);
  }, []);

  const loadProviderKeys = useCallback(async () => {
    try {
      setProviderKeys(await listProviderKeys());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không tải được kho key");
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rows, dvRes] = await Promise.all([
        getAppSettings(),
        fetch("/api/voice/defaults?includeInactive=true").then(async (r) => {
          const body = await r.json();
          if (!r.ok)
            throw new Error(body.error || "Không tải được danh sách giọng");
          return body;
        }),
        canManageSecrets ? loadSecrets() : Promise.resolve(),
      ]);
      const map: Record<string, string> = {};
      rows.forEach((r: AppSettingRow) => {
        // A-04: key rows hold no value any more — their status comes from list_system_secrets().
        if (!isSecretSettingKey(r.key)) map[r.key] = r.value;
      });
      setSettings(map);
      setOriginal(map);
      if (dvRes.voices) {
        setDefaultVoices(dvRes.voices);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể tải cài đặt");
    } finally {
      setLoading(false);
    }
  }, [canManageSecrets, loadSecrets]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleToggleDefaultVoice(id: string, active: boolean) {
    const res = await fetch("/api/voice/defaults", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, is_active: active }),
    });
    const data = await res.json();
    if (!res.ok || !data.voice)
      throw new Error(data.error || "Chưa đổi được trạng thái giọng.");
    setDefaultVoices((prev) => prev.map((v) => (v.id === id ? data.voice : v)));
  }
  async function handleReorderDefaultVoices(language: string, ids: string[]) {
    const response = await fetch("/api/voice/defaults", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language, ids }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Chưa sắp xếp được.");
    setDefaultVoices((prev) =>
      prev.map((v) =>
        ids.includes(v.id) ? { ...v, sort_order: ids.indexOf(v.id) } : v,
      ),
    );
  }
  const handleChange = (key: string, value: string) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const handleDraft = (key: string, value: string) => {
    setDrafts((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const pendingSecrets = canManageSecrets
    ? Object.entries(drafts).filter(([, v]) => v.trim() !== "")
    : [];

  const hasChanges =
    pendingSecrets.length > 0 ||
    Object.keys(settings).some((k) => settings[k] !== (original[k] ?? ""));

  /** Key to send to "Test Kết Nối": the newly typed one, `undefined` = the stored one (server side), `null` = none. */
  function keyForTest(key: string): string | undefined | null {
    const typed = drafts[key]?.trim();
    if (typed) return typed;
    return secrets[key]?.is_set ? undefined : null;
  }

  async function handleClearSecret(key: string) {
    const label = SECRET_LABELS[key] ?? key;
    const reason = await confirm({
      title: `Xoá API key ${label}?`,
      description:
        "Tính năng dùng key này sẽ ngừng chạy nếu không có key dự phòng. Không thể xem lại key đã xoá.",
      confirmLabel: "Xoá key",
    });
    if (!reason) return;
    setClearingKey(key);
    setError(null);
    try {
      await setSystemSecret(key, "", reason);
      setDrafts((prev) => ({ ...prev, [key]: "" }));
      await loadSecrets();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Xoá key thất bại");
    } finally {
      setClearingKey(null);
    }
  }

  // ── Default Voice CRUD ──
  async function handleAddDefaultVoice(voice: {
    voice_id: string;
    name: string;
    language: string;
    gender?: string;
    public_owner_id?: string;
    languageConfirmed?: boolean;
  }) {
    const res = await fetch("/api/voice/defaults", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(voice),
    });
    const data = await res.json();
    if (data.voice) {
      setDefaultVoices((prev) => [
        ...prev.filter((v) => v.id !== data.voice.id),
        data.voice,
      ]);
    } else if (data.error) {
      throw new Error(data.error);
    }
  }

  async function handleRemoveDefaultVoice(id: string) {
    const voice = defaultVoices.find((v) => v.id === id);
    if (!voice) return;
    const reason = await confirm({
      title: `Xoá giọng ${voice.name}?`,
      description:
        "Giọng sẽ rời danh sách mặc định. Không xoá giọng tại nhà cung cấp; có thể thêm lại bằng ID.",
      confirmLabel: "Xoá giọng",
    });
    if (!reason) return;
    setError(null);
    try {
      await confirmedAdminAction("default_voice.delete", [id], reason);
      setDefaultVoices((prev) => prev.filter((v) => v.id !== id));
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Không xoá được giọng; danh sách được giữ nguyên.",
      );
    }
  }

  // ── test provider ──
  async function testProvider(
    provider: string,
    /** undefined → the server tests the stored key (it never comes to the browser). */
    apiKey: string | undefined,
    baseUrl?: string,
  ): Promise<TestResult> {
    const res = await fetch("/api/admin/test-provider", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, apiKey, baseUrl }),
    });
    return res.json();
  }

  async function handleTestElevenLabs() {
    // A-04b: the server uses a key of the pool (they never come to the browser).
    if (
      canManageSecrets &&
      !providerKeys.some((k) => k.provider === "elevenlabs" && k.enabled)
    ) {
      setElevenTest({ ok: false, error: "Thêm key ElevenLabs vào kho trước" });
      return;
    }
    setElevenTesting(true);
    setElevenTest(null);
    try {
      const result = await testProvider("elevenlabs", undefined);
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
    const key = keyForTest(providerKeyMap[selectedProvider] || "");
    if (key === null) {
      setAiTest({ ok: false, error: "Nhập API key trước" });
      return;
    }
    if (
      key === undefined &&
      selectedProvider === "custom" &&
      settings["custom_provider_url"] !== original["custom_provider_url"]
    ) {
      // The stored key is only ever sent to the SAVED base URL.
      setAiTest({
        ok: false,
        error: "Lưu Base URL trước khi thử key đã lưu (hoặc nhập lại key)",
      });
      return;
    }
    setAiTesting(true);
    setAiTest(null);
    try {
      const result = await testProvider(
        selectedProvider,
        key,
        selectedProvider === "custom" && key
          ? settings["custom_provider_url"]
          : undefined,
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
    // Like illustration: no DALL·E key → the OpenAI key is used.
    let key = keyForTest("dalle_api_key");
    if (key === null && secrets["openai_api_key"]?.is_set) key = undefined;
    if (key === null) {
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
    let touchedSecrets = false;
    try {
      const changed: Record<string, string> = {};
      for (const [k, v] of Object.entries(settings)) {
        // API keys never go through app_settings (A-04: Vault only).
        if (isSecretSettingKey(k)) continue;
        if (v !== (original[k] ?? "")) {
          changed[k] = v;
        }
      }
      if (Object.keys(changed).length > 0) {
        await updateAppSettings(changed);
      }
      setOriginal({ ...settings });
      // A-04: write-only — each new key goes straight to Vault, only its status comes back.
      for (const [k, v] of pendingSecrets) {
        touchedSecrets = true;
        await setSystemSecret(k, v);
        setDrafts((prev) => ({ ...prev, [k]: "" }));
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lưu thất bại");
    } finally {
      if (touchedSecrets) await loadSecrets().catch(() => {});
      setSaving(false);
    }
  };

  // ── helper: get AI key field for selected provider ──
  function aiKeyField() {
    const map: Record<
      string,
      { key: string; placeholder: string; helpUrl?: string; helpLabel?: string }
    > = {
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

  return {
    settings,
    original,
    secrets,
    providerKeys,
    drafts,
    clearingKey,
    loading,
    saving,
    saved,
    error,
    elevenTest,
    elevenTesting,
    voices,
    defaultVoices,
    aiTest,
    aiTesting,
    aiModels,
    dalleTest,
    dalleTesting,
    selectedProvider,
    loadProviderKeys,
    handleChange,
    handleDraft,
    handleClearSecret,
    handleAddDefaultVoice,
    handleRemoveDefaultVoice,
    handleReorderDefaultVoices,
    handleToggleDefaultVoice,
    handleTestElevenLabs,
    handleTestAI,
    handleTestDalle,
    handleSave,
    hasChanges,
    aiKeyField,
    setAiTest,
    setAiModels,
  };
}
export type SettingsController = ReturnType<typeof useAdminSettings>;
