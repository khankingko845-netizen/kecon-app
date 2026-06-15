"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import {
  Palette, Eraser, RotateCcw, Sparkles, Loader2, ChevronLeft,
  Minus, Plus, Undo2,
} from "lucide-react";
import TopBar from "@/components/ui/TopBar";
import { useSettings } from "@/lib/settings-context";
import { useData } from "@/lib/data-context";
import type { Screen } from "@/lib/types";

const COLORS = [
  "#1a1a1a", "#EF4444", "#F59E0B", "#10B981", "#3B82F6",
  "#8B5CF6", "#EC4899", "#F97316", "#14B8A6", "#6366F1",
  "#D946EF", "#84CC16", "#06B6D4", "#A855F7", "#ffffff",
];

const BRUSH_SIZES = [3, 6, 10, 16, 24];

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
  const [childName, setChildName] = useState(settings.childName || "");
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
          childName: childName || undefined,
          age: settings.childAge || "4-6",
          language: settings.language || "vi",
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Lỗi tạo truyện");

      await refreshStories();
      onNavigate("player", { storyId: data.storyId });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Đã xảy ra lỗi");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <TopBar title="✏️ Vẽ Truyện" onBack={onBack} />

      <div className="flex-1 flex flex-col px-4 pt-2 pb-4">
        {/* Child Name */}
        <div className="mb-3">
          <input
            type="text"
            value={childName}
            onChange={(e) => setChildName(e.target.value)}
            placeholder="Tên bé (tuỳ chọn)"
            className="w-full px-4 py-2.5 rounded-xl border border-gray-200 bg-surface text-sm font-medium text-txt outline-none focus:border-accent"
          />
        </div>

        {/* Canvas */}
        <div className="relative flex-1 rounded-2xl border-2 border-gray-200 overflow-hidden bg-white mb-3 touch-none">
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
        <div className="bg-gray-50 rounded-2xl p-3 mb-3">
          {/* Colors */}
          <div className="flex gap-1.5 mb-2.5 overflow-x-auto no-scrollbar">
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => { setColor(c); setIsEraser(false); }}
                className={`w-7 h-7 rounded-full shrink-0 border-2 transition-all ${
                  color === c && !isEraser ? "border-accent scale-110" : "border-gray-200"
                }`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>

          {/* Tools */}
          <div className="flex items-center gap-2">
            {/* Brush sizes */}
            <div className="flex gap-1 items-center">
              {BRUSH_SIZES.map((size) => (
                <button
                  key={size}
                  onClick={() => setBrushSize(size)}
                  className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                    brushSize === size ? "bg-accent text-white" : "bg-white text-gray-500"
                  }`}
                >
                  <div
                    className="rounded-full bg-current"
                    style={{ width: Math.min(size, 16), height: Math.min(size, 16) }}
                  />
                </button>
              ))}
            </div>

            <div className="flex-1" />

            {/* Eraser */}
            <button
              onClick={() => setIsEraser(!isEraser)}
              className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                isEraser ? "bg-accent text-white" : "bg-white text-gray-500"
              }`}
            >
              <Eraser size={18} />
            </button>

            {/* Undo */}
            <button
              onClick={undo}
              className="w-9 h-9 rounded-xl bg-white text-gray-500 flex items-center justify-center"
            >
              <Undo2 size={18} />
            </button>

            {/* Clear */}
            <button
              onClick={clearCanvas}
              className="w-9 h-9 rounded-xl bg-white text-gray-500 flex items-center justify-center"
            >
              <RotateCcw size={18} />
            </button>
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
              <Loader2 size={20} className="animate-spin" />
              AI đang phân tích bản vẽ...
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
