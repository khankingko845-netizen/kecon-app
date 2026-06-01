"use client";

import { useState } from "react";
import { Plus, User, UserRound, Trash2, Loader2, Mic } from "lucide-react";
import { useData } from "@/lib/data-context";
import { deleteVoiceProfile, gradientFor } from "@/lib/db";
import type { Screen } from "@/lib/types";

interface VoiceProfilesProps {
  onNavigate: (screen: Screen) => void;
}

function relationLabel(relation: string): string {
  const map: Record<string, string> = {
    parent: "Bố/Mẹ",
    mother: "Mẹ",
    father: "Bố",
    grandparent: "Ông/Bà",
    other: "Khác",
  };
  return map[relation] || relation;
}

export default function VoiceProfiles({ onNavigate }: VoiceProfilesProps) {
  const { voiceProfiles, loading, refreshVoices } = useData();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await deleteVoiceProfile(id);
      await refreshVoices();
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="min-h-screen bg-surface pb-24">
      <div className="px-5 pt-14">
        <h2 className="text-[28px] font-black tracking-tight mb-0.5">Giọng Nói</h2>
        <p className="text-[13px] text-txt-secondary font-medium">
          Voice profiles gia đình
        </p>
      </div>

      <div className="px-5 pt-4 space-y-2.5">
        {loading && voiceProfiles.length === 0 && (
          <div className="flex justify-center py-8">
            <Loader2 size={24} className="animate-spin text-accent" />
          </div>
        )}

        {voiceProfiles.map((v) => {
          const quality = Math.round(v.quality_score);
          return (
            <div
              key={v.id}
              className="bg-white rounded-2xl p-4 flex items-center gap-3.5 shadow-[0_1px_3px_rgba(0,0,0,0.04)]"
            >
              <div
                className={`w-[50px] h-[50px] rounded-2xl bg-gradient-to-br ${gradientFor(v.id)} flex items-center justify-center text-white shrink-0`}
              >
                {v.gender === "female" ? <UserRound size={24} /> : <User size={24} />}
              </div>
              <div className="flex-1 min-w-0">
                <h5 className="text-base font-bold mb-0.5 truncate">{v.name}</h5>
                <p className="text-[11px] text-txt-secondary mb-1.5">
                  {relationLabel(v.relation)}
                  {v.elevenlabs_voice_id ? " · Đã clone" : " · Chưa clone"}
                </p>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${quality}%`,
                        background: quality >= 80 ? "#22C55E" : "#FBBF24",
                      }}
                    />
                  </div>
                  <span
                    className="text-[13px] font-bold"
                    style={{ color: quality >= 80 ? "#16A34A" : "#D97706" }}
                  >
                    {quality}%
                  </span>
                </div>
              </div>
              <button
                onClick={() => handleDelete(v.id)}
                disabled={deletingId === v.id}
                className="w-[38px] h-[38px] rounded-xl bg-surface border border-gray-200 flex items-center justify-center text-red-400 shrink-0 active:scale-95 transition-transform"
                aria-label="Xóa giọng"
              >
                {deletingId === v.id ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Trash2 size={16} />
                )}
              </button>
            </div>
          );
        })}

        {!loading && voiceProfiles.length === 0 && (
          <div className="bg-white rounded-2xl p-6 text-center shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-accent-2/20 to-accent/20 flex items-center justify-center text-accent mx-auto mb-2">
              <Mic size={22} />
            </div>
            <p className="text-[14px] font-bold text-txt mb-0.5">
              Chưa có giọng nào
            </p>
            <p className="text-[12px] text-txt-secondary">
              Ghi âm để tạo giọng đọc đầu tiên
            </p>
          </div>
        )}

        {/* Add Voice */}
        <button
          onClick={() => onNavigate("recording")}
          className="w-full border-2 border-dashed border-gray-300 rounded-2xl p-6 text-center active:scale-[0.98] transition-transform"
        >
          <div className="w-11 h-11 rounded-[14px] bg-gray-100 flex items-center justify-center text-accent mx-auto mb-2">
            <Plus size={20} />
          </div>
          <h5 className="text-[15px] font-bold mb-0.5">Thêm Giọng Nói Mới</h5>
          <p className="text-xs text-txt-secondary">
            Ghi âm 30s — 3 phút để tạo voice
          </p>
        </button>
      </div>
    </div>
  );
}
