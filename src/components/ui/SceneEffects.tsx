"use client";

import { useMemo } from "react";
import {
 type EffectType,
 particleCountFor,
} from "@/lib/scene-effects";

interface SceneEffectsProps {
 effect: EffectType | null;
 // Pause animation generation when not actively playing (saves CPU).
 active?: boolean;
}

const LEAF_COLORS = ["#E8A04E", "#D9763B", "#B5651D", "#C98A3B"];
const PETAL_COLORS = ["#FBC2D4", "#F7A8C4", "#FAD0DD", "#F9B6CC"];

// Deterministic pseudo-random so SSR and client markup match (no hydration
// mismatch) while still looking scattered.
function rng(seed: number) {
 let s = seed % 2147483647;
 if (s <= 0) s += 2147483646;
 return () => {
 s = (s * 16807) % 2147483647;
 return (s - 1) / 2147483646;
 };
}

export default function SceneEffects({ effect, active = true }: SceneEffectsProps) {
 const particles = useMemo(() => {
 if (!effect) return [];
 const count = particleCountFor(effect);
 const rand = rng(effect.length * 1000 + count);
 return Array.from({ length: count }).map((_, i) => {
 const r = rand;
 const left = r() * 100;
 const delay = r() * 6;
 const duration =
 effect === "rain"
 ? 0.6 + r() * 0.7
 : effect === "fireflies"
 ? 4 + r() * 4
 : effect === "stars"
 ? 1.5 + r() * 2.5
 : 5 + r() * 6;
 const size =
 effect === "rain"
 ? 1
 : effect === "stars"
 ? 1.5 + r() * 2
 : effect === "fireflies"
 ? 3 + r() * 2
 : effect === "snow"
 ? 3 + r() * 4
 : 6 + r() * 6;
 const sway = (r() * 2 - 1) * (effect === "leaves" || effect === "petals" ? 60 : 20);
 const top = r() * 100;
 const dx = (r() * 2 - 1) * 30;
 const dy = -(10 + r() * 30);
 const color =
 effect === "leaves"
 ? LEAF_COLORS[i % LEAF_COLORS.length]
 : effect === "petals"
 ? PETAL_COLORS[i % PETAL_COLORS.length]
 : undefined;
 return { i, left, top, delay, duration, size, sway, dx, dy, color };
 });
 }, [effect]);

 if (!effect || particles.length === 0) return null;

 const cls = `fx-particle fx-${effect === "petals" ? "leaf" : effect}`;

 return (
 <div className="fx-layer" aria-hidden="true">
 {particles.map((p) => {
 const style: React.CSSProperties = {
 left: `${p.left}%`,
 animationDelay: `${p.delay}s`,
 animationDuration: `${p.duration}s`,
 animationPlayState: active ? "running" : "paused",
 };
 if (effect === "stars") {
 style.top = `${p.top}%`;
 style.width = `${p.size}px`;
 style.height = `${p.size}px`;
 } else if (effect === "fireflies") {
 style.top = `${20 + p.top * 0.6}%`;
 style.width = `${p.size}px`;
 style.height = `${p.size}px`;
 (style as Record<string, string>)["--dx"] = `${p.dx}px`;
 (style as Record<string, string>)["--dy"] = `${p.dy}px`;
 } else if (effect === "rain") {
 // width/height come from CSS class
 (style as Record<string, string>)["--sway"] = `0px`;
 } else {
 style.width = `${p.size}px`;
 style.height = `${p.size}px`;
 (style as Record<string, string>)["--sway"] = `${p.sway}px`;
 if (p.color) style.background = p.color;
 }
 return <span key={p.i} className={cls} style={style} />;
 })}
 </div>
 );
}
