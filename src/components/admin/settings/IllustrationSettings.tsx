"use client";

import { SecretInput, TestButton } from "./SettingsFields";

import type { SettingsController } from "./useAdminSettings";
export default function IllustrationSettings({
  controller,
  canManageSecrets,
}: {
  controller: SettingsController;
  canManageSecrets: boolean;
}) {
  const {
    secrets,
    drafts,
    clearingKey,
    dalleTest,
    dalleTesting,
    handleDraft,
    handleClearSecret,
    handleTestDalle,
  } = controller;
  return (
    <section
      id="illustration"
      className="overflow-hidden rounded-xl border border-gray-200 bg-white"
    >
      {" "}
      <div className="flex items-center gap-2.5 px-5 mt-6 mb-2">
        <h3 className="text-lg font-semibold text-ink">Minh Họa AI (DALL·E)</h3>
      </div>
      <div className="bg-white  px-5 py-4 space-y-4">
        <div>
          <label className="text-sm font-bold text-txt-secondary  mb-1.5 block">
            OpenAI API Key (DALL·E)
          </label>
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
          <p className="text-sm text-txt-secondary  mt-1">
            Dùng chung key OpenAI. Nếu để trống sẽ fallback sang OpenAI Key ở
            mục AI.
          </p>
        </div>
        <TestButton
          loading={dalleTesting}
          result={dalleTest}
          onClick={handleTestDalle}
        />
      </div>
    </section>
  );
}
