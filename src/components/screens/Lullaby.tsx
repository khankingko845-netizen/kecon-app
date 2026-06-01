"use client";

import { useState } from "react";
import { ChevronLeft, Clock, Moon, CloudRain, Waves, Music, Bug, Volume2 } from "lucide-react";
import { soundOptions } from "@/lib/data";

interface LullabyProps {
  onBack: () => void;
}

const iconMap: Record<string, typeof Moon> = {
  "cloud-rain": CloudRain,
  waves: Waves,
  music: Music,
  bug: Bug,
};

const timerOptions = ["15p", "30p", "45p", "Auto"];

export default function Lullaby({ onBack }: LullabyProps) {
  const [activeSound, setActiveSound] = useState("rain");
  const [activeTimer, setActiveTimer] = useState("15p");
  const [voiceVol, setVoiceVol] = useState(60);
  const [bgVol, setBgVol] = useState(30);

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#0C1445] to-[#070B2E] flex flex-col items-center text-white relative overflow-hidden">
      {/* Stars */}
      {[
        { top: "10%", left: "15%", delay: "0s" },
        { top: "6%", left: "60%", delay: "0.7s" },
        { top: "18%", right: "20%", delay: "1.3s" },
        { top: "25%", left: "40%", delay: "2s" },
        { top: "30%", left: "80%", delay: "0.4s" },
        { top: "8%", left: "32%", delay: "1.8s" },
        { top: "45%", left: "10%", delay: "0.9s" },
        { top: "55%", left: "75%", delay: "1.5s" },
      ].map((star, i) => (
        <div
          key={i}
          className="absolute w-0.5 h-0.5 rounded-full bg-white/50"
          style={{
            ...star,
            animation: `twinkle 3s ease-in-out infinite ${star.delay}`,
          }}
        />
      ))}

      {/* Top Bar */}
      <div className="w-full flex justify-between items-center px-5 pt-14 pb-2 z-10">
        <button
          onClick={onBack}
          className="w-9 h-9 rounded-xl bg-white/5 flex items-center justify-center"
        >
          <ChevronLeft size={20} className="text-white/50" />
        </button>
        <div className="flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-white/5 text-xs font-bold text-white/40">
          <Clock size={14} /> 15 phút
        </div>
      </div>

      {/* Moon */}
      <div
        className="w-28 h-28 rounded-full flex items-center justify-center mt-10 mb-5 z-10"
        style={{
          background: "radial-gradient(circle at 40% 35%, #FEF3C7, #FBBF24)",
          boxShadow: "0 0 50px 15px rgba(251,191,36,0.1)",
        }}
      >
        <Moon size={48} className="text-amber-800" />
      </div>

      <h2 className="text-[22px] font-extrabold tracking-tight z-10 mb-1">
        Chế Độ Ru Ngủ
      </h2>
      <p className="text-[13px] text-white/35 font-medium z-10 mb-7">
        Thỏ Con Dũng Cảm · Giọng Mẹ Lan
      </p>

      {/* Sound Pills */}
      <div className="flex gap-2 z-10 mb-7">
        {soundOptions.map((s) => {
          const Icon = iconMap[s.icon] || Music;
          const active = activeSound === s.id;
          return (
            <button
              key={s.id}
              onClick={() => setActiveSound(s.id)}
              className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-[13px] font-semibold transition-all ${
                active
                  ? "bg-indigo-500/15 border border-indigo-500/30 text-indigo-300"
                  : "bg-white/[0.04] border border-white/[0.06] text-white/35"
              }`}
            >
              <Icon size={14} /> {s.name}
            </button>
          );
        })}
      </div>

      {/* Volume Sliders */}
      <div className="w-[80%] z-10 mb-3">
        <div className="flex justify-between items-center text-xs font-semibold text-white/30 mb-2">
          <span className="flex items-center gap-1.5">
            <Volume2 size={14} /> Giọng đọc
          </span>
          <span>{voiceVol}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          value={voiceVol}
          onChange={(e) => setVoiceVol(Number(e.target.value))}
          className="w-full h-1 bg-white/[0.06] rounded-full appearance-none accent-indigo-400"
        />
      </div>

      <div className="w-[80%] z-10 mb-3">
        <div className="flex justify-between items-center text-xs font-semibold text-white/30 mb-2">
          <span className="flex items-center gap-1.5">
            <Music size={14} /> Âm nền
          </span>
          <span>{bgVol}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          value={bgVol}
          onChange={(e) => setBgVol(Number(e.target.value))}
          className="w-full h-1 bg-white/[0.06] rounded-full appearance-none accent-indigo-400"
        />
      </div>

      {/* Timer Chips */}
      <div className="flex gap-2 z-10 mt-5">
        {timerOptions.map((t) => (
          <button
            key={t}
            onClick={() => setActiveTimer(t)}
            className={`px-5 py-3 rounded-xl text-sm font-bold transition-all ${
              activeTimer === t
                ? "bg-gradient-to-br from-indigo-500 to-violet-400 text-white shadow-lg shadow-indigo-500/35"
                : "bg-white/[0.04] text-white/30"
            }`}
          >
            {t}
          </button>
        ))}
      </div>
    </div>
  );
}
