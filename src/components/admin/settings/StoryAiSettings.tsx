"use client";
import { ExternalLink } from "@/components/ui/icons";

import { SecretInput, TestButton, ModelSelect } from "./SettingsFields";
import { AI_PROVIDERS } from "./types";

import type { SettingsController } from "./useAdminSettings";
export default function StoryAiSettings({
  controller,
  canManageSecrets,
}: {
  controller: SettingsController;
  canManageSecrets: boolean;
}) {
  const {
    settings,
    secrets,
    drafts,
    clearingKey,
    aiTest,
    aiTesting,
    aiModels,
    selectedProvider,
    handleChange,
    handleDraft,
    handleClearSecret,
    handleTestAI,
    aiKeyField,
    setAiTest,
    setAiModels,
  } = controller;
  return (
    <section
      id="story-ai"
      className="overflow-hidden rounded-xl border border-gray-200 bg-white"
    >
      {" "}
      <div className="flex items-center gap-2.5 px-5 mt-6 mb-2">
        <h3 className="text-lg font-semibold text-ink">AI Tạo Truyện</h3>
      </div>
      <div className="bg-white  px-5 py-4 space-y-4">
        {/* Provider selector */}
        <div>
          <label className="text-sm font-bold text-txt-secondary  mb-1.5 block">
            Provider Mặc Định
          </label>
          <div className="grid grid-cols-4 gap-1.5">
            {AI_PROVIDERS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  handleChange("default_ai_provider", p.id);
                  setAiTest(null);
                  setAiModels([]);
                }}
                className={`py-2.5 rounded-xl text-sm font-bold border-[1.5px] transition-all ${
                  selectedProvider === p.id
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-gray-200  bg-surface  text-txt-secondary "
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
            <label className="text-sm font-bold text-txt-secondary  mb-1.5 block">
              Base URL (OpenAI-compatible)
            </label>
            <input
              type="text"
              aria-label="Base URL (OpenAI-compatible)"
              value={settings["custom_provider_url"] ?? ""}
              onChange={(e) =>
                handleChange("custom_provider_url", e.target.value)
              }
              placeholder="https://openrouter.ai/api/v1"
              className="w-full px-3.5 py-3 rounded-xl border border-gray-200  bg-surface  text-sm font-mono outline-none focus:border-accent transition-colors"
            />
            <p className="text-sm text-txt-secondary  mt-1">
              Hỗ trợ OpenRouter, Groq, Together, LM Studio, Ollama…
            </p>
          </div>
        )}

        {/* API Key for selected provider */}
        <div>
          <label className="text-sm font-bold text-txt-secondary  mb-1.5 block">
            API Key —{" "}
            {AI_PROVIDERS.find((p) => p.id === selectedProvider)?.label}
          </label>
          <SecretInput
            key={aiKeyField().key}
            settingKey={aiKeyField().key}
            status={secrets[aiKeyField().key]}
            value={drafts[aiKeyField().key] ?? ""}
            onChange={(v) => handleDraft(aiKeyField().key, v)}
            onClear={() => handleClearSecret(aiKeyField().key)}
            clearing={clearingKey === aiKeyField().key}
            placeholder={aiKeyField().placeholder}
            locked={!canManageSecrets}
          />
          {aiKeyField().helpUrl && (
            <a
              href={aiKeyField().helpUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-accent text-sm font-semibold mt-1.5"
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

        {/* Model selector */}
        <div>
          <label className="text-sm font-bold text-txt-secondary  mb-1.5 block">
            Model Mặc Định
          </label>
          <ModelSelect
            value={settings["default_ai_model"] ?? ""}
            onChange={(v) => handleChange("default_ai_model", v)}
            models={aiModels}
            placeholder="vd: gpt-4o-mini"
            allowFreeText={
              selectedProvider === "custom" || aiModels.length === 0
            }
          />
          {aiModels.length === 0 && (
            <p className="text-sm text-txt-secondary  mt-1">
              Nhấn &quot;Test Kết Nối&quot; để tải danh sách models từ provider
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
