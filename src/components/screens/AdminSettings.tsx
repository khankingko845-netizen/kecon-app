"use client";
import { Save, Loader2, Check } from "@/components/ui/icons";
import { AdminHeader } from "@/components/admin/AdminUi";
import { useAdminSettings } from "@/components/admin/settings/useAdminSettings";
import ElevenLabsSettings from "@/components/admin/settings/ElevenLabsSettings";
import FishAudioSettings from "@/components/admin/settings/FishAudioSettings";
import StoryAiSettings from "@/components/admin/settings/StoryAiSettings";
import IllustrationSettings from "@/components/admin/settings/IllustrationSettings";
export default function AdminSettings({
  onBack,
  canManageSecrets = true,
}: {
  onBack: () => void;
  canManageSecrets?: boolean;
}) {
  const controller = useAdminSettings(canManageSecrets);
  const { loading, error, saving, saved, handleSave, hasChanges } = controller;
  return (
    <div className="admin-settings min-h-screen bg-parent-bg pb-12">
      <AdminHeader title="Cài Đặt Hệ Thống" onBack={onBack} />
      <div className="space-y-6 p-5">
        <p className="rounded-xl border border-gray-200 bg-white p-4 text-sm leading-relaxed text-ink-2">
          <strong className="text-ink">Cấu hình dùng chung cho KểCon.</strong>{" "}
          Key được mã hoá trong Vault, chỉ hiện 4 ký tự cuối. Chỉ nhân sự đủ
          quyền đặt hoặc thay key; người dùng thường không dùng key riêng.
        </p>
        <nav aria-label="Các phần cài đặt" className="flex flex-wrap gap-2">
          {[
            ["elevenlabs", "ElevenLabs"],
            ["fishaudio", "Fish Audio"],
            ["story-ai", "AI tạo truyện"],
            ["illustration", "Minh hoạ"],
          ].map(([id, label]) => (
            <a href={"#" + id} key={id} className="admin-button">
              {label}
            </a>
          ))}
        </nav>
        {error && (
          <p
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
          >
            {error}
          </p>
        )}
        {loading ? (
          <p role="status" className="flex items-center gap-2">
            <Loader2 size={20} className="animate-spin" />
            Đang tải cài đặt…
          </p>
        ) : (
          <>
            <ElevenLabsSettings
              controller={controller}
              canManageSecrets={canManageSecrets}
            />
            <FishAudioSettings
              controller={controller}
              canManageSecrets={canManageSecrets}
            />
            <StoryAiSettings
              controller={controller}
              canManageSecrets={canManageSecrets}
            />
            <IllustrationSettings
              controller={controller}
              canManageSecrets={canManageSecrets}
            />
            <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white p-4">
              <span className="text-sm text-ink-2">
                {hasChanges ? "Có thay đổi chưa lưu" : "Cài đặt đã đồng bộ"}
              </span>
              <button
                onClick={handleSave}
                disabled={saving || !hasChanges}
                className="admin-button bg-brand! text-white!"
              >
                <span>
                  {saving ? (
                    <Loader2 size={18} className="animate-spin" />
                  ) : saved ? (
                    <Check size={18} />
                  ) : (
                    <Save size={18} />
                  )}
                </span>
                {saving
                  ? "Đang lưu..."
                  : saved
                    ? "Đã lưu thành công!"
                    : "Lưu Cài Đặt"}
              </button>
            </div>
            <p className="text-sm text-ink-2">
              Thay đổi có hiệu lực trong vòng 1 phút, không cần khởi động lại.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
