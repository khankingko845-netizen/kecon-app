"use client";

import { Play, Plus, User, UserRound } from "lucide-react";
import { voiceProfiles } from "@/lib/data";
import type { Screen } from "@/lib/types";

interface VoiceProfilesProps {
  onNavigate: (screen: Screen) => void;
}

export default function VoiceProfiles({ onNavigate }: VoiceProfilesProps) {
  return (
    <div className="min-h-screen bg-surface pb-24">
      <div className="px-5 pt-14">
        <h2 className="text-[28px] font-black tracking-tight mb-0.5">
          Giọng Nói
        </h2>
        <p className="text-[13px] text-txt-secondary font-medium">
          Voice profiles gia đình
        </p>
      </div>

      <div className="px-5 pt-4 space-y-2.5">
        {voiceProfiles.map((v) => (
          <div
            key={v.id}
            className="bg-white rounded-2xl p-4 flex items-center gap-3.5 shadow-[0_1px_3px_rgba(0,0,0,0.04)]"
          >
            <div
              className={`w-[50px] h-[50px] rounded-2xl bg-gradient-to-br ${v.gradient} flex items-center justify-center text-white shrink-0`}
            >
              {v.gender === "female" ? (
                <UserRound size={24} />
              ) : (
                <User size={24} />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <h5 className="text-base font-bold mb-0.5">{v.name}</h5>
              <p className="text-[11px] text-txt-secondary mb-1.5">
                {v.storyCount} truyện · {v.date}
              </p>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${v.quality}%`,
                      background: v.quality >= 80 ? "#22C55E" : "#FBBF24",
                    }}
                  />
                </div>
                <span
                  className="text-[13px] font-bold"
                  style={{
                    color: v.quality >= 80 ? "#16A34A" : "#D97706",
                  }}
                >
                  {v.quality}%
                </span>
              </div>
            </div>
            <button className="w-[38px] h-[38px] rounded-xl bg-surface border border-gray-200 flex items-center justify-center text-txt shrink-0 active:scale-95 transition-transform">
              <Play size={16} fill="currentColor" />
            </button>
          </div>
        ))}

        {/* Add Voice */}
        <button
          onClick={() => onNavigate("recording")}
          className="w-full border-2 border-dashed border-gray-300 rounded-2xl p-6 text-center active:scale-[0.98] transition-transform"
        >
          <div className="w-11 h-11 rounded-[14px] bg-gray-100 flex items-center justify-center text-accent mx-auto mb-2">
            <Plus size={20} />
          </div>
          <h5 className="text-[15px] font-bold mb-0.5">
            Thêm Giọng Nói Mới
          </h5>
          <p className="text-xs text-txt-secondary">
            Ghi âm 30s — 3 phút để tạo voice
          </p>
        </button>
      </div>
    </div>
  );
}
