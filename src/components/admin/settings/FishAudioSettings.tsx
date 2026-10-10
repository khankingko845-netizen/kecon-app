"use client";
import { ChevronDown } from "@/components/ui/icons";
import ProviderKeyPool from "@/components/screens/ProviderKeyPool";

import { FISH_MODELS } from "@/lib/fishaudio";
import type { SettingsController } from "./useAdminSettings";
export default function FishAudioSettings({
  controller,
  canManageSecrets,
}: {
  controller: SettingsController;
  canManageSecrets: boolean;
}) {
  const { settings, providerKeys, loadProviderKeys, handleChange } = controller;
  return (
    <section
      id="fishaudio"
      className="overflow-hidden rounded-xl border border-gray-200 bg-white"
    >
      {" "}
      <div className="flex items-center gap-2.5 px-5 mt-6 mb-2">
        <h3 className="text-lg font-semibold text-ink">
          Giọng Nói (Fish Audio)
        </h3>
      </div>
      <div className="bg-white  px-5 py-4 space-y-4">
        <ProviderKeyPool
          provider="fishaudio"
          rows={providerKeys.filter((k) => k.provider === "fishaudio")}
          onChanged={loadProviderKeys}
          locked={!canManageSecrets}
        />
        <div>
          <label
            htmlFor="fishaudio-model"
            className="text-sm font-bold text-txt-secondary  mb-1.5 block"
          >
            Model TTS Fish Audio
          </label>
          <div className="relative">
            <select
              id="fishaudio-model"
              value={settings["fishaudio_model_id"] || "s2.1-pro"}
              onChange={(e) =>
                handleChange("fishaudio_model_id", e.target.value)
              }
              className="w-full px-3.5 py-3 rounded-xl border border-gray-200  bg-surface  text-sm font-semibold outline-none focus:border-accent transition-colors appearance-none pr-10"
            >
              {FISH_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <ChevronDown
              size={16}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-txt-secondary  pointer-events-none"
            />
          </div>
          <p className="text-sm text-txt-secondary  mt-1.5 leading-relaxed">
            Giọng Fish Audio dùng mã{" "}
            <code className="font-mono">fish:&lt;id giọng&gt;</code> (id lấy ở
            fish.audio → Voice Library / giọng của bạn) — thêm vào &quot;Giọng
            mặc định&quot; ở trên bằng ô nhập thủ công.
          </p>
        </div>
      </div>
    </section>
  );
}
