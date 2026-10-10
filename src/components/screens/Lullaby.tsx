"use client";

import { useState, useEffect, useRef } from "react";
import { ChevronLeft, Clock, Moon, CloudRain, Waves, Music, Bug, Wind, Flame, Trees } from "@/components/ui/icons";
import { AmbientEngine, type AmbientType } from "@/lib/audio-engine";
import Mascot from "@/components/ui/Mascot";
import AmbientLibraryControls from "@/components/ui/AmbientLibraryControls";
import { AMBIENT_TRACKS } from "@/lib/ambient-library";
import { ScreenOff, ScreenOffButton } from "@/components/ui/NightControls";

interface LullabyProps {
 onBack: () => void;
}

const soundIcons: Record<AmbientType, typeof Moon> = {
 rain: CloudRain, waves: Waves, wind: Wind, fire: Flame,
 forest: Trees, night: Bug, lullaby: Music, stream: Waves,
};
const sounds = AMBIENT_TRACKS.map(({ id, label }) => ({ id, name: label, Icon: soundIcons[id] }));

const timerOptions = ["15p", "30p", "45p", "Auto"];
const timerMinutes: Record<string, number> = { "15p": 15, "30p": 30, "45p": 45, Auto: 60 };

export default function Lullaby({ onBack }: LullabyProps) {
 const [screenOff, setScreenOff] = useState(false);
 const engineRef = useRef<AmbientEngine | null>(null);
 const [activeSounds, setActiveSounds] = useState<Set<AmbientType>>(new Set());
 const [activeTimer, setActiveTimer] = useState("15p");
 const [bgVol, setBgVol] = useState(25);
 const [pending, setPending] = useState<Set<AmbientType>>(new Set());
 const [ambientError, setAmbientError] = useState("");
 const intents = useRef(new Map<AmbientType, number>());
 const [remaining, setRemaining] = useState<number | null>(null);

 // Initialize engine lazily.
 const getEngine = () => {
 if (!engineRef.current) engineRef.current = new AmbientEngine();
 return engineRef.current;
 };

 useEffect(() => {
 return () => {
 engineRef.current?.dispose();
 engineRef.current = null;
 };
 }, []);

 const toggleSound = (id: AmbientType) => {
 const engine = getEngine();
 const intent = (intents.current.get(id) ?? 0) + 1;
 intents.current.set(id, intent);
 setAmbientError("");
 if (activeSounds.has(id) || pending.has(id)) {
 engine.stopLayer(id);
 setActiveSounds((prev) => { const next = new Set(prev); next.delete(id); return next; });
 setPending((prev) => { const next = new Set(prev); next.delete(id); return next; });
 } else {
 engine.setVolume(id, bgVol / 100);
 setPending((prev) => new Set(prev).add(id));
 void engine.play(id).then(() => {
   if(intents.current.get(id) === intent) setActiveSounds((prev) => new Set(prev).add(id));
 }).catch((error: Error) => {
   if(error.name !== "AbortError" && intents.current.get(id) === intent) setAmbientError(error.message);
 }).finally(() => {
   if(intents.current.get(id) === intent) setPending((prev) => { const next = new Set(prev); next.delete(id); return next; });
 });
 }
 };

 // Apply background volume to all active layers.
 useEffect(() => {
 const engine = engineRef.current;
 if (!engine) return;
 activeSounds.forEach((id) => engine.setVolume(id, bgVol / 100));
 }, [bgVol, activeSounds]);

 // Sleep timer countdown.
 useEffect(() => {
 if (remaining === null) return;
 if (remaining <= 0) {
 engineRef.current?.stopAll();
 setActiveSounds(new Set());
 setRemaining(null);
 return;
 }
 const t = setTimeout(() => setRemaining((r) => (r === null ? null : r - 1)), 1000);
 return () => clearTimeout(t);
 }, [remaining]);

 const startTimer = (label: string) => {
 setActiveTimer(label);
 setRemaining(timerMinutes[label] * 60);
 };

 const fmt = (s: number) =>
 `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

 return (
 <div className="min-h-screen bg-gradient-to-b from-night to-[#0E0B26] flex flex-col items-center text-moon relative overflow-hidden">
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
 aria-label="Quay lại"
 className="w-11 h-11 rounded-xl bg-white/5 flex items-center justify-center"
 >
 <ChevronLeft size={22} className="text-moon-2" />
 </button>
 <div className="flex items-center gap-2">
 <div className="flex items-center gap-1.5 px-4 h-11 rounded-full bg-white/5 text-xs font-bold text-moon-2">
 <Clock size={14} /> {remaining !== null ? fmt(remaining) : "Hẹn giờ"}
 </div>
 <ScreenOffButton onClick={() => setScreenOff(true)} />
 </div>
 </div>
 {screenOff && <ScreenOff onWake={() => setScreenOff(false)} remaining={remaining} />}

 {/* Moon + Đóm buồn ngủ (UI v2, night mode) */}
 <div className="relative w-48 h-44 mt-6 mb-4 z-10 flex items-end justify-center">
 <div
 aria-hidden
 className="absolute right-2 top-0 w-24 h-24 rounded-full"
 style={{
 background: "radial-gradient(circle at 40% 35%, #F3E9D2, #E8D6A8)",
 boxShadow: "0 0 50px 15px rgba(243,233,210,0.10)",
 }}
 />
 <Mascot state="sleepy" size={150} priority className="relative" />
 </div>

 <h2 className="font-display text-[26px] font-extrabold tracking-tight text-moon z-10 mb-1">
 Ru ngủ cùng Đóm
 </h2>
 <p className="text-[14px] text-moon-2 font-medium z-10 mb-7">
 Chạm chọn tối đa 3 âm nền · file có giấy phép
 </p>

 {/* Sound Pills */}
 <div className="flex flex-wrap justify-center gap-2 z-10 mb-7 px-5">
 {sounds.map((s) => {
 const Icon = s.Icon;
 const active = activeSounds.has(s.id);
 return (
 <button
 key={s.id}
 aria-pressed={active}
 aria-busy={pending.has(s.id)}
 onClick={() => toggleSound(s.id)}
 className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-[13px] font-semibold transition-all ${
 active
 ? "bg-amber/[0.16] border border-amber/35 text-amber"
 : "bg-night-card/70 border border-moon/10 text-moon-2"
 }`}
 >
 <Icon size={14} /> {s.name}{pending.has(s.id) ? " · tải…" : ""}
 </button>
 );
 })}
 </div>

 {ambientError && <p role="alert" aria-label="Lỗi phát âm nền" className="w-[80%] z-10 mb-3 text-sm text-[#FBCDC5]">{ambientError}</p>}
 {/* This screen has no narrator: avoid a nonfunctional "voice volume" control. */}
 <div className="w-[80%] z-10 mb-3">
 <div className="flex justify-between items-center text-xs font-bold text-moon-2 mb-2">
 <span className="flex items-center gap-1.5">
 <Music size={14} /> Âm nền
 </span>
 <span>{bgVol}%</span>
 </div>
 <input
 aria-label="Âm lượng âm nền"
 type="range"
 min={0}
 max={100}
 value={bgVol}
 onChange={(e) => setBgVol(Number(e.target.value))}
 className="w-full h-1 bg-white/[0.06] rounded-full appearance-none accent-amber"
 />
 </div>
 <div className="w-[80%] z-10"><AmbientLibraryControls /></div>

 {/* Timer Chips */}
 <div className="flex gap-2 z-10 mt-5">
 {timerOptions.map((t) => (
 <button
 key={t}
 onClick={() => startTimer(t)}
 className={`min-h-[48px] px-5 rounded-2xl text-[15px] font-extrabold transition-all ${
 activeTimer === t
 ? "bg-amber text-night shadow-[0_4px_0_#B9441C]"
 : "bg-night-card/70 border border-moon/10 text-moon-2"
 }`}
 >
 {t}
 </button>
 ))}
 </div>
 </div>
 );
}
