"use client";
import { ChevronDown } from "@/components/ui/icons";
import ProviderKeyPool from "@/components/screens/ProviderKeyPool";
import DefaultVoicesManager from "./DefaultVoicesManager";
import { TestButton } from "./SettingsFields";

import type { SettingsController } from "./useAdminSettings";
export default function ElevenLabsSettings({
  controller,
  canManageSecrets,
}: {
  controller: SettingsController;
  canManageSecrets: boolean;
}) {
  const {
    settings,
    providerKeys,
    elevenTest,
    elevenTesting,
    voices,
    defaultVoices,
    loadProviderKeys,
    handleChange,
    handleAddDefaultVoice,
    handleRemoveDefaultVoice,
    handleReorderDefaultVoices,
    handleToggleDefaultVoice,
    handleTestElevenLabs,
  } = controller;
  return (
    <section
      id="elevenlabs"
      className="overflow-hidden rounded-xl border border-gray-200 bg-white"
    >
      {" "}
      <div className="flex items-center gap-2.5 px-5 mt-6 mb-2">
        <h3 className="text-lg font-semibold text-ink">
          Giọng Nói (ElevenLabs)
        </h3>
      </div>
      <div className="bg-white  px-5 py-4 space-y-4">
        {/* A-04b: many keys, rotated + failover */}
        <ProviderKeyPool
          provider="elevenlabs"
          rows={providerKeys.filter((k) => k.provider === "elevenlabs")}
          onChanged={loadProviderKeys}
          locked={!canManageSecrets}
        />

        {/* Test */}
        <TestButton
          loading={elevenTesting}
          result={elevenTest}
          onClick={handleTestElevenLabs}
        />

        {/* Model */}
        <div>
          <label className="text-sm font-bold text-txt-secondary  mb-1.5 block">
            Model TTS
          </label>
          <div className="relative">
            <select
              aria-label="Model TTS ElevenLabs"
              value={
                settings["elevenlabs_model_id"] ?? "eleven_multilingual_v2"
              }
              onChange={(e) =>
                handleChange("elevenlabs_model_id", e.target.value)
              }
              className="w-full px-3.5 py-3 rounded-xl border border-gray-200  bg-surface  text-sm font-semibold outline-none focus:border-accent transition-colors appearance-none pr-10"
            >
              <option value="eleven_v3">
                Eleven v3 (mới nhất, chất lượng cao nhất)
              </option>
              <option value="eleven_multilingual_v2">
                Multilingual v2 (29 ngôn ngữ, không có tiếng Việt)
              </option>
              <option value="eleven_turbo_v2_5">Turbo v2.5 (nhanh)</option>
              <option value="eleven_flash_v2_5">Flash v2.5 (rẻ nhất)</option>
            </select>
            <ChevronDown
              size={16}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-txt-secondary  pointer-events-none"
            />
          </div>
        </div>

        <p className="text-sm text-txt-secondary ">
          Tiếng Việt tự dùng Flash v2.5 nếu model đã chọn không hỗ trợ. Mẫu nghe
          thử được tạo bằng câu tiếng Việt, không dùng preview gốc của thư viện.
        </p>
        {/* Default voices per language (multi-select) */}
        <DefaultVoicesManager
          availableVoices={voices}
          defaultVoices={defaultVoices}
          onAdd={handleAddDefaultVoice}
          onRemove={handleRemoveDefaultVoice}
          onReorder={handleReorderDefaultVoices}
          onToggle={handleToggleDefaultVoice}
          loading={elevenTesting}
        />
      </div>
    </section>
  );
}
