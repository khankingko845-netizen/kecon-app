"use client";

import { ChevronDown } from "@/components/ui/icons";
import { SecretInput, TestButton } from "./SettingsFields";
import { DEFAULT_CUSTOM_IMAGE_MODEL, DEFAULT_GEMINI_IMAGE_MODEL, DEFAULT_OPENAI_IMAGE_MODEL } from "@/lib/illustration-models";

import type { SettingsController } from "./useAdminSettings";

const PROVIDERS = [
  { id: "auto", name: "Tự động (OpenAI → Gemini → Tuỳ chỉnh)" },
  { id: "openai", name: "OpenAI GPT Image" },
  { id: "gemini", name: "Google Gemini (Nano Banana)" },
  { id: "custom", name: "Nhà cung cấp tuỳ chỉnh (OpenAI-compatible, ví dụ CometAPI)" },
  { id: "off", name: "Tắt — chỉ dùng tranh khung cảnh có sẵn" },
];
const QUALITIES = [
  { id: "low", name: "Thấp — rẻ, nhanh (khuyên dùng)" },
  { id: "medium", name: "Vừa" },
  { id: "high", name: "Cao — đắt" },
];
const selectClass =
  "w-full px-3.5 py-3 rounded-xl border border-gray-200 bg-surface text-sm font-semibold outline-none focus:border-accent transition-colors appearance-none pr-10";

export default function IllustrationSettings({
  controller,
  canManageSecrets,
}: {
  controller: SettingsController;
  canManageSecrets: boolean;
}) {
  const {
    settings,
    handleChange,
    secrets,
    drafts,
    clearingKey,
    dalleTest,
    dalleTesting,
    handleDraft,
    handleClearSecret,
    handleTestDalle,
  } = controller;
  const provider = settings["illustration_provider"] || "auto";
  return (
    <section id="illustration" className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      <div className="flex items-center gap-2.5 px-5 mt-6 mb-2">
        <h3 className="text-lg font-semibold text-ink">Minh Họa AI (tranh từng trang)</h3>
      </div>
      <div className="bg-white px-5 py-4 space-y-4">
        <p className="text-sm text-txt-secondary leading-relaxed">
          Truyện luôn có tranh khung cảnh dựng sẵn. Khi bật tính năng “Minh hoạ AI” và có key, Đóm vẽ thêm tranh riêng
          cho từng trang (giữ nhân vật giống nhau giữa các trang) và lưu vào kho ảnh — không dùng link hết hạn.
        </p>
        <div>
          <label htmlFor="illustration-provider" className="text-sm font-bold text-txt-secondary mb-1.5 block">
            Nhà cung cấp
          </label>
          <div className="relative">
            <select
              id="illustration-provider"
              value={provider}
              onChange={(e) => handleChange("illustration_provider", e.target.value)}
              className={selectClass}
            >
              {PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-txt-secondary pointer-events-none" />
          </div>
        </div>
        <div>
          <label htmlFor="illustration-model" className="text-sm font-bold text-txt-secondary mb-1.5 block">
            Model (để trống = mặc định)
          </label>
          <input
            id="illustration-model"
            value={settings["illustration_model"] || ""}
            onChange={(e) => handleChange("illustration_model", e.target.value.trim())}
            placeholder={
              provider === "gemini" ? DEFAULT_GEMINI_IMAGE_MODEL : provider === "custom" ? DEFAULT_CUSTOM_IMAGE_MODEL : DEFAULT_OPENAI_IMAGE_MODEL
            }
            className="w-full px-3.5 py-3 rounded-xl border border-gray-200 bg-surface text-sm font-mono outline-none focus:border-accent"
          />
          <p className="text-sm text-txt-secondary mt-1">
            OpenAI: {DEFAULT_OPENAI_IMAGE_MODEL}, gpt-image-1.5, gpt-image-1-mini · Gemini: {DEFAULT_GEMINI_IMAGE_MODEL} · Tuỳ
            chỉnh: {DEFAULT_CUSTOM_IMAGE_MODEL} (model gpt-image-* của cổng)
          </p>
        </div>
        <div>
          <label htmlFor="illustration-quality" className="text-sm font-bold text-txt-secondary mb-1.5 block">
            Chất lượng (OpenAI)
          </label>
          <div className="relative">
            <select
              id="illustration-quality"
              value={settings["illustration_quality"] || "low"}
              onChange={(e) => handleChange("illustration_quality", e.target.value)}
              className={selectClass}
            >
              {QUALITIES.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.name}
                </option>
              ))}
            </select>
            <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-txt-secondary pointer-events-none" />
          </div>
        </div>
        <div>
          <label className="text-sm font-bold text-txt-secondary mb-1.5 block">OpenAI API Key (minh hoạ)</label>
          <SecretInput
            settingKey="dalle_api_key"
            status={secrets["dalle_api_key"]}
            value={drafts["dalle_api_key"] ?? ""}
            onChange={(v) => handleDraft("dalle_api_key", v)}
            onClear={() => handleClearSecret("dalle_api_key")}
            clearing={clearingKey === "dalle_api_key"}
            placeholder="sk-..."
            locked={!canManageSecrets}
          />
          <p className="text-sm text-txt-secondary mt-1">
            Để trống sẽ dùng OpenAI Key ở mục AI. Gemini dùng Gemini Key ở mục AI. Tuỳ chỉnh dùng địa chỉ + key của nhà cung cấp
            tuỳ chỉnh ở mục AI (ảnh được nén WebP trước khi lưu).
          </p>
        </div>
        <TestButton loading={dalleTesting} result={dalleTest} onClick={handleTestDalle} />
      </div>
    </section>
  );
}
