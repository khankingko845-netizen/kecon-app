"use client";
import { useToast } from "@/components/ui/Toast";

import { useState, useRef, useCallback, useEffect } from "react";
import {
 Palette, Eraser, RotateCcw, Sparkles, Undo2,
} from "@/components/ui/icons";
import { GlowDots } from "@/components/ui/states";
import TopBar from "@/components/ui/TopBar";
import { useSettings } from "@/lib/settings-context";
import { useChildProfiles } from "@/lib/child-profiles-context";
import { useData } from "@/lib/data-context";
import type { Screen } from "@/lib/types";
import { normalizeAgeBand } from "@/lib/age-bands";

// Named so a screen reader can announce each swatch (the colour alone has no name).
const COLORS = [
 { value: "#1a1a1a", name: "đen" }, { value: "#EF4444", name: "đỏ" }, { value: "#F59E0B", name: "vàng" },
 { value: "#10B981", name: "xanh lá" }, { value: "#3B82F6", name: "xanh dương" }, { value: "#8B5CF6", name: "tím" },
 { value: "#EC4899", name: "hồng" }, { value: "#F97316", name: "cam" }, { value: "#14B8A6", name: "xanh ngọc" },
 { value: "#6366F1", name: "chàm" }, { value: "#D946EF", name: "tím hồng" }, { value: "#84CC16", name: "xanh chanh" },
 { value: "#06B6D4", name: "xanh da trời" }, { value: "#A855F7", name: "tím nhạt" }, { value: "#ffffff", name: "trắng" },
];

const BRUSH_SIZES = [3, 6, 10, 16, 24];
const BRUSH_NAMES = ["rất mảnh", "mảnh", "vừa", "to", "rất to"];

interface DrawStoryProps {
 onBack: () => void;
 onNavigate: (screen: Screen, data?: Record<string, string>) => void;
}

interface DrawPoint {
 x: number;
 y: number;
}

export default function DrawStory({ onBack, onNavigate }: DrawStoryProps) {
 const { settings } = useSettings();
 const { refreshStories } = useData();
 const canvasRef = useRef<HTMLCanvasElement>(null);
 const [isDrawing, setIsDrawing] = useState(false);
 const [color, setColor] = useState("#1a1a1a");
 const [brushSize, setBrushSize] = useState(6);
 const [isEraser, setIsEraser] = useState(false);
 const [isGenerating, setIsGenerating] = useState(false);
 const [error, setError] = useState<string | null>(null);
 const { toast } = useToast();
 // T10: prefilled with the child chosen on this device; typing another name drops the profile.
 const { activeChild } = useChildProfiles();
 const [typedName, setTypedName] = useState<string | null>(null);
 const childName = typedName ?? activeChild?.display_name ?? "";
 const profileId = typedName === null ? activeChild?.id : undefined;
 const [hasDrawn, setHasDrawn] = useState(false);
 const undoStack = useRef<ImageData[]>([]);
 const lastPoint = useRef<DrawPoint | null>(null);

 // Initialize canvas
 useEffect(() => {
 const canvas = canvasRef.current;
 if (!canvas) return;
 const ctx = canvas.getContext("2d");
 if (!ctx) return;
 // Set canvas size
 const rect = canvas.getBoundingClientRect();
 canvas.width = rect.width * 2;
 canvas.height = rect.height * 2;
 ctx.scale(2, 2);
 ctx.fillStyle = "#ffffff";
 ctx.fillRect(0, 0, rect.width, rect.height);
 ctx.lineCap = "round";
 ctx.lineJoin = "round";
 }, []);

 const saveState = useCallback(() => {
 const canvas = canvasRef.current;
 if (!canvas) return;
 const ctx = canvas.getContext("2d");
 if (!ctx) return;
 undoStack.current.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
 if (undoStack.current.length > 20) undoStack.current.shift();
 }, []);

 const undo = useCallback(() => {
 const canvas = canvasRef.current;
 if (!canvas || undoStack.current.length === 0) return;
 const ctx = canvas.getContext("2d");
 if (!ctx) return;
 const state = undoStack.current.pop()!;
 ctx.putImageData(state, 0, 0);
 }, []);

 const clearCanvas = useCallback(() => {
 const canvas = canvasRef.current;
 if (!canvas) return;
 const ctx = canvas.getContext("2d");
 if (!ctx) return;
 saveState();
 const rect = canvas.getBoundingClientRect();
 ctx.fillStyle = "#ffffff";
 ctx.fillRect(0, 0, rect.width, rect.height);
 setHasDrawn(false);
 }, [saveState]);

 const getPos = (e: React.TouchEvent | React.MouseEvent): DrawPoint => {
 const canvas = canvasRef.current!;
 const rect = canvas.getBoundingClientRect();
 if ("touches" in e) {
 const touch = e.touches[0];
 return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
 }
 return {
 x: (e as React.MouseEvent).clientX - rect.left,
 y: (e as React.MouseEvent).clientY - rect.top,
 };
 };

 const startDraw = (e: React.TouchEvent | React.MouseEvent) => {
 e.preventDefault();
 saveState();
 setIsDrawing(true);
 setHasDrawn(true);
 const pos = getPos(e);
 lastPoint.current = pos;
 const ctx = canvasRef.current?.getContext("2d");
 if (!ctx) return;
 ctx.beginPath();
 ctx.arc(pos.x, pos.y, (isEraser ? brushSize * 2 : brushSize) / 2, 0, Math.PI * 2);
 ctx.fillStyle = isEraser ? "#ffffff" : color;
 ctx.fill();
 };

 const draw = (e: React.TouchEvent | React.MouseEvent) => {
 e.preventDefault();
 if (!isDrawing) return;
 const ctx = canvasRef.current?.getContext("2d");
 if (!ctx || !lastPoint.current) return;
 const pos = getPos(e);
 ctx.beginPath();
 ctx.moveTo(lastPoint.current.x, lastPoint.current.y);
 ctx.lineTo(pos.x, pos.y);
 ctx.strokeStyle = isEraser ? "#ffffff" : color;
 ctx.lineWidth = isEraser ? brushSize * 2 : brushSize;
 ctx.stroke();
 lastPoint.current = pos;
 };

 const endDraw = () => {
 setIsDrawing(false);
 lastPoint.current = null;
 };

 const handleGenerate = async () => {
 const canvas = canvasRef.current;
 if (!canvas) return;

 setIsGenerating(true);
 setError(null);

 try {
 const imageData = canvas.toDataURL("image/png");

 const res = await fetch("/api/story/from-drawing", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({
 imageData,
 childName: childName.trim() || undefined,
 childProfileId: profileId,
 age: normalizeAgeBand(settings.childAge),
 language: settings.language || "vi",
 }),
 });

 const data = await res.json();
 if (!res.ok) throw new Error(data.error || "Lỗi tạo truyện");

 await refreshStories();
 toast("success", "Đã tạo truyện từ tranh.");
 onNavigate("player", { storyId: data.storyId });
 } catch (err) {
 toast("error", "Chưa tạo được truyện từ tranh.");
 setError(err instanceof Error ? err.message : "Đã xảy ra lỗi");
 } finally {
 setIsGenerating(false);
 }
 };

 return (
 <div className="min-h-screen bg-white dark:bg-white/[0.04] flex flex-col">
 <TopBar title="✏️ Vẽ Truyện" onBack={onBack} />

 <div className="flex-1 flex flex-col px-4 pt-2 pb-4">
 {/* Child Name */}
 <div className="mb-3">
 <input
 type="text"
 value={childName}
 onChange={(e) => setTypedName(e.target.value)}
 maxLength={40}
 placeholder="Tên bé (tuỳ chọn)"
 aria-label="Tên bé (tuỳ chọn)"
 className="w-full min-h-11 px-4 py-2.5 rounded-xl border border-gray-200 dark:border-white/10 bg-surface dark:bg-white/[0.04] text-sm font-medium text-txt dark:text-white outline-none focus:border-accent"
 />
 </div>

 {/* Canvas */}
 <div className="relative flex-1 rounded-2xl border-2 border-gray-200 dark:border-white/10 overflow-hidden bg-white dark:bg-white/[0.04] mb-3 touch-none">
 <canvas
 ref={canvasRef}
 className="w-full h-full"
 style={{ touchAction: "none" }}
 onMouseDown={startDraw}
 onMouseMove={draw}
 onMouseUp={endDraw}
 onMouseLeave={endDraw}
 onTouchStart={startDraw}
 onTouchMove={draw}
 onTouchEnd={endDraw}
 />
 {!hasDrawn && (
 <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
 <div className="text-center text-gray-300">
 <Palette size={48} className="mx-auto mb-2" />
 <p className="text-sm font-bold">Bé vẽ tranh ở đây!</p>
 <p className="text-xs">AI sẽ tạo truyện từ bản vẽ</p>
 </div>
 </div>
 )}
 </div>

 {/* Toolbar */}
 <div className="bg-gray-50 dark:bg-white/[0.04] rounded-2xl p-3 mb-3">
 {/* Colors — 44 px targets; the row scrolls sideways inside the card */}
 <div role="group" aria-label="Màu bút" className="-mx-1 mb-2 flex gap-0.5 overflow-x-auto px-1 no-scrollbar">
 {COLORS.map((c) => {
 const on = color === c.value && !isEraser;
 return (
 <button
 key={c.value}
 type="button"
 aria-label={`Màu ${c.name}`}
 aria-pressed={on}
 onClick={() => { setColor(c.value); setIsEraser(false); }}
 className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
 >
 <span
 className={`h-8 w-8 rounded-full border-2 transition-all ${on ? "border-accent scale-110 ring-2 ring-accent/30" : "border-gray-200 dark:border-white/10"}`}
 style={{ backgroundColor: c.value }}
 />
 </button>
 );
 })}
 </div>

 {/* Tools: brush sizes, then eraser / undo / clear (wrap on narrow phones) */}
 <div className="flex flex-wrap items-center gap-2">
 <div role="group" aria-label="Cỡ nét" className="flex gap-1 items-center">
 {BRUSH_SIZES.map((size, i) => (
 <button
 key={size}
 type="button"
 aria-label={`Nét ${BRUSH_NAMES[i]}`}
 aria-pressed={brushSize === size}
 onClick={() => setBrushSize(size)}
 className={`h-11 w-11 rounded-lg flex items-center justify-center ${
 brushSize === size ? "bg-accent text-white" : "bg-white dark:bg-white/[0.04] text-gray-500 dark:text-white/40"
 }`}
 >
 <div
 className="rounded-full bg-current"
 style={{ width: Math.min(size, 16), height: Math.min(size, 16) }}
 />
 </button>
 ))}
 </div>

 <div className="ml-auto flex gap-2">
 <button
 type="button"
 aria-label="Tẩy"
 aria-pressed={isEraser}
 onClick={() => setIsEraser(!isEraser)}
 className={`h-11 w-11 rounded-xl flex items-center justify-center ${
 isEraser ? "bg-accent text-white" : "bg-white dark:bg-white/[0.04] text-gray-500 dark:text-white/40"
 }`}
 >
 <Eraser size={18} aria-hidden />
 </button>
 <button
 type="button"
 aria-label="Hoàn tác nét vừa vẽ"
 onClick={undo}
 className="h-11 w-11 rounded-xl bg-white dark:bg-white/[0.04] text-gray-500 dark:text-white/40 flex items-center justify-center"
 >
 <Undo2 size={18} aria-hidden />
 </button>
 <button
 type="button"
 aria-label="Xoá hết tranh"
 onClick={clearCanvas}
 className="h-11 w-11 rounded-xl bg-white dark:bg-white/[0.04] text-gray-500 dark:text-white/40 flex items-center justify-center"
 >
 <RotateCcw size={18} aria-hidden />
 </button>
 </div>
 </div>
 </div>

 {/* Error */}
 {error && (
 <div className="mb-3 p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">
 {error}
 </div>
 )}

 {/* Generate Button */}
 <button
 onClick={handleGenerate}
 disabled={!hasDrawn || isGenerating}
 className="w-full py-4 rounded-2xl bg-gradient-to-r from-violet-500 to-pink-500 text-white font-bold text-base flex items-center justify-center gap-2 shadow-lg shadow-violet-500/30 active:scale-[0.98] transition-transform disabled:opacity-50"
 >
 {isGenerating ? (
 <>
 <GlowDots size={7} />
 Đóm đang ngắm tranh của bé…
 </>
 ) : (
 <>
 <Sparkles size={20} />
 Tạo Truyện Từ Bản Vẽ
 </>
 )}
 </button>
 </div>
 </div>
 );
}
