"use client";

import { useState, useRef, useCallback } from "react";
import {
  ChevronLeft, Camera, ImagePlus, Loader2, Sparkles, Trash2,
  BookOpen, CheckCircle, AlertCircle, X, RotateCcw, ZoomIn,
} from "lucide-react";
import { useSettings } from "@/lib/settings-context";
import { useAuth } from "@/lib/auth-context";
import { useData } from "@/lib/data-context";
import { createClient } from "@/lib/supabase/client";
import type { Screen } from "@/lib/types";

interface ScanBookProps {
  onBack: () => void;
  onNavigate: (screen: Screen, data?: Record<string, string>) => void;
}

type ScanStep = "capture" | "processing" | "review" | "saving";

interface ScannedPage {
  text: string;
  sceneDescription: string;
}

interface ScanResult {
  title: string;
  pages: ScannedPage[];
  language: string;
  suggestedCategory: string;
  summary: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  fairy_tale: "🏰 Cổ tích",
  adventure: "🚀 Phiêu lưu",
  bedtime: "🌙 Ru ngủ",
  animal: "🐰 Động vật",
  educational: "📖 Giáo dục",
  custom: "🎨 Tùy chỉnh",
};

export default function ScanBook({ onBack, onNavigate }: ScanBookProps) {
  const { settings, systemStatus } = useSettings();
  const { profile } = useAuth();
  const { refreshStories } = useData();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const [images, setImages] = useState<string[]>([]);
  const [step, setStep] = useState<ScanStep>("capture");
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState("");
  const [previewIdx, setPreviewIdx] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editPages, setEditPages] = useState<ScannedPage[]>([]);
  const [savingProgress, setSavingProgress] = useState("");

  const compressImage = useCallback(
    (file: File): Promise<string> =>
      new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement("canvas");
            const MAX = 1600;
            let { width, height } = img;
            if (width > MAX || height > MAX) {
              const ratio = Math.min(MAX / width, MAX / height);
              width *= ratio;
              height *= ratio;
            }
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d")!;
            ctx.drawImage(img, 0, 0, width, height);
            resolve(canvas.toDataURL("image/jpeg", 0.85));
          };
          img.onerror = reject;
          img.src = reader.result as string;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      }),
    []
  );

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files) return;
      const newImages: string[] = [];
      for (let i = 0; i < Math.min(files.length, 10 - images.length); i++) {
        const compressed = await compressImage(files[i]);
        newImages.push(compressed);
      }
      setImages((prev) => [...prev, ...newImages]);
    },
    [images.length, compressImage]
  );

  const removeImage = (idx: number) => {
    setImages((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleScan = async () => {
    if (images.length === 0) return;
    setStep("processing");
    setError("");

    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const provider =
        systemStatus.defaultStoryProvider || settings.storyProvider || "openai";

      const res = await fetch("/api/story/scan", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          images: images.map((img) => img), // data URLs
          provider,
          apiKey: settings.storyApiKey || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Scan failed");

      setResult(data);
      setEditTitle(data.title || "Truyện từ sách");
      setEditPages(data.pages || []);
      setStep("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi khi scan");
      setStep("capture");
    }
  };

  const handleSave = async () => {
    if (!result || !profile?.id) return;
    setStep("saving");
    setSavingProgress("Đang lưu truyện...");

    try {
      const supabase = createClient();

      const categoryReverse: Record<string, string> = {
        fairy_tale: "cotich",
        adventure: "phieuluu",
        bedtime: "ngungon",
        animal: "dongvat",
        educational: "hocchoi",
        custom: "tuviet",
      };

      // Save story
      const { data: storyRow, error: storyErr } = await supabase
        .from("stories")
        .insert({
          user_id: profile.id,
          title: editTitle,
          description: result.summary,
          category: result.suggestedCategory || "custom",
          theme: categoryReverse[result.suggestedCategory] || "tuviet",
          target_age_min: 2,
          target_age_max: 10,
          locale: result.language || "vi",
          page_count: editPages.length,
          source: "scan",
          status: "draft",
        })
        .select("id")
        .single();

      if (storyErr) throw new Error(storyErr.message);

      setSavingProgress("Đang lưu trang...");

      // Save pages
      const pageRows = editPages.map((p, i) => ({
        story_id: storyRow.id,
        page_number: i + 1,
        content: p.text,
        scene_description: p.sceneDescription,
      }));
      const { error: pagesErr } = await supabase
        .from("story_pages")
        .insert(pageRows);
      if (pagesErr) throw new Error(pagesErr.message);

      // Track
      try {
        await supabase.from("user_behavior").insert({
          user_id: profile.id,
          action_type: "scan_create",
          story_id: storyRow.id,
          metadata: { imageCount: images.length, pageCount: editPages.length },
        });
      } catch { /* ignore tracking errors */ }

      setSavingProgress("Hoàn tất!");
      refreshStories();

      // Navigate to editor for this story
      setTimeout(() => {
        onNavigate("editor", { storyId: storyRow.id });
      }, 800);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi khi lưu");
      setStep("review");
    }
  };

  return (
    <div className="min-h-screen bg-surface pb-24">
      <div className="px-5 pt-14">
        {/* Header */}
        <div className="flex items-center gap-3 mb-5">
          <button
            onClick={step === "review" ? () => setStep("capture") : onBack}
            className="w-9 h-9 rounded-xl bg-white flex items-center justify-center shadow-sm"
          >
            <ChevronLeft size={18} />
          </button>
          <h2 className="text-[22px] font-black tracking-tight">
            {step === "capture"
              ? "Chụp Truyện Từ Sách"
              : step === "processing"
                ? "Đang Nhận Dạng..."
                : step === "saving"
                  ? "Đang Lưu..."
                  : "Xem Lại Nội Dung"}
          </h2>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-100 flex items-start gap-2">
            <AlertCircle size={16} className="text-red-500 mt-0.5 flex-shrink-0" />
            <p className="text-[12px] text-red-600">{error}</p>
            <button onClick={() => setError("")} className="ml-auto"><X size={14} className="text-red-400" /></button>
          </div>
        )}

        {/* Step: Capture */}
        {step === "capture" && (
          <>
            {/* Instructions */}
            <div className="bg-white rounded-2xl p-4 shadow-sm mb-4">
              <div className="flex items-center gap-2 mb-2">
                <BookOpen size={18} className="text-accent" />
                <p className="text-[14px] font-bold">Hướng dẫn</p>
              </div>
              <ul className="text-[12px] text-txt-secondary space-y-1.5 ml-1">
                <li>📸 Chụp rõ từng trang sách (tối đa 10 ảnh)</li>
                <li>💡 Đặt sách trên nền sáng, chụp thẳng</li>
                <li>🤖 AI sẽ đọc và trích xuất nội dung tự động</li>
                <li>✏️ Bạn có thể chỉnh sửa trước khi lưu</li>
              </ul>
            </div>

            {/* Image grid */}
            {images.length > 0 && (
              <div className="mb-4">
                <p className="text-[12px] font-semibold text-txt-secondary mb-2">
                  {images.length}/10 ảnh
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {images.map((img, idx) => (
                    <div key={idx} className="relative aspect-[3/4] rounded-xl overflow-hidden bg-gray-100">
                      <img
                        src={img}
                        alt={`Trang ${idx + 1}`}
                        className="w-full h-full object-cover cursor-pointer"
                        onClick={() => setPreviewIdx(idx)}
                      />
                      <button
                        onClick={() => removeImage(idx)}
                        className="absolute top-1 right-1 w-6 h-6 rounded-full bg-red-500 text-white flex items-center justify-center"
                      >
                        <X size={12} />
                      </button>
                      <span className="absolute bottom-1 left-1 text-[10px] bg-black/50 text-white px-1.5 rounded-full">
                        {idx + 1}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Capture buttons */}
            <div className="grid grid-cols-2 gap-3 mb-5">
              <button
                onClick={() => cameraInputRef.current?.click()}
                className="bg-gradient-to-r from-accent to-purple-500 text-white rounded-2xl p-4 flex flex-col items-center gap-2 active:scale-95 transition-transform"
              >
                <Camera size={24} />
                <span className="text-[13px] font-bold">Chụp Ảnh</span>
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="bg-white rounded-2xl p-4 flex flex-col items-center gap-2 border border-gray-200 active:scale-95 transition-transform"
              >
                <ImagePlus size={24} className="text-accent" />
                <span className="text-[13px] font-bold text-txt">Chọn Từ Thư Viện</span>
              </button>
            </div>

            {/* Hidden inputs */}
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
            />
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
            />

            {/* Scan button */}
            {images.length > 0 && (
              <button
                onClick={handleScan}
                className="w-full py-4 rounded-2xl bg-gradient-to-r from-accent to-pink-500 text-white text-[15px] font-bold flex items-center justify-center gap-2 active:scale-[0.98] transition-transform shadow-lg"
              >
                <Sparkles size={18} /> Nhận Dạng Nội Dung ({images.length} ảnh)
              </button>
            )}
          </>
        )}

        {/* Step: Processing */}
        {step === "processing" && (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="w-20 h-20 rounded-full bg-accent/10 flex items-center justify-center mb-4">
              <Loader2 size={36} className="animate-spin text-accent" />
            </div>
            <p className="text-[16px] font-bold text-txt">AI đang đọc sách...</p>
            <p className="text-[12px] text-txt-secondary mt-2 text-center">
              Đang phân tích {images.length} ảnh và trích xuất nội dung.
              <br />Quá trình có thể mất 10-30 giây.
            </p>
          </div>
        )}

        {/* Step: Review */}
        {step === "review" && result && (
          <>
            {/* Title */}
            <div className="bg-white rounded-2xl p-4 shadow-sm mb-3">
              <label className="text-[12px] font-semibold text-txt-secondary mb-1 block">
                Tên truyện
              </label>
              <input
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="w-full text-[16px] font-bold text-txt border-b border-gray-200 pb-1 focus:border-accent outline-none"
              />
            </div>

            {/* Meta info */}
            <div className="flex gap-2 mb-4">
              <span className="px-3 py-1 bg-accent/10 text-accent rounded-full text-[11px] font-bold">
                {result.language === "vi" ? "🇻🇳 Tiếng Việt" : result.language === "en" ? "🇺🇸 English" : result.language}
              </span>
              <span className="px-3 py-1 bg-purple-50 text-purple-600 rounded-full text-[11px] font-bold">
                {CATEGORY_LABELS[result.suggestedCategory] || "📚 Truyện"}
              </span>
              <span className="px-3 py-1 bg-green-50 text-green-600 rounded-full text-[11px] font-bold">
                {editPages.length} trang
              </span>
            </div>

            {/* Summary */}
            <div className="bg-blue-50 rounded-xl p-3 mb-4">
              <p className="text-[11px] text-blue-700">{result.summary}</p>
            </div>

            {/* Pages */}
            <div className="space-y-3 mb-6">
              {editPages.map((page, idx) => (
                <div key={idx} className="bg-white rounded-2xl p-4 shadow-sm">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[12px] font-bold text-accent">
                      Trang {idx + 1}
                    </span>
                    <button
                      onClick={() => {
                        setEditPages((prev) => prev.filter((_, i) => i !== idx));
                      }}
                      className="text-red-400 hover:text-red-600"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <textarea
                    value={page.text}
                    onChange={(e) => {
                      const updated = [...editPages];
                      updated[idx] = { ...updated[idx], text: e.target.value };
                      setEditPages(updated);
                    }}
                    rows={4}
                    className="w-full text-[13px] text-txt border border-gray-100 rounded-lg p-2 focus:border-accent outline-none resize-none"
                  />
                </div>
              ))}
            </div>

            {/* Actions */}
            <div className="space-y-3">
              <button
                onClick={handleSave}
                className="w-full py-4 rounded-2xl bg-gradient-to-r from-accent to-pink-500 text-white text-[15px] font-bold flex items-center justify-center gap-2 active:scale-[0.98] transition-transform shadow-lg"
              >
                <CheckCircle size={18} /> Lưu Truyện & Chỉnh Sửa
              </button>
              <button
                onClick={() => { setStep("capture"); setResult(null); }}
                className="w-full py-3 rounded-2xl bg-white text-txt text-[14px] font-bold flex items-center justify-center gap-2 border border-gray-200"
              >
                <RotateCcw size={16} /> Chụp Lại
              </button>
            </div>
          </>
        )}

        {/* Step: Saving */}
        {step === "saving" && (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="w-20 h-20 rounded-full bg-green-50 flex items-center justify-center mb-4">
              <Loader2 size={36} className="animate-spin text-green-500" />
            </div>
            <p className="text-[16px] font-bold text-txt">{savingProgress}</p>
          </div>
        )}

        {/* Image preview modal */}
        {previewIdx !== null && (
          <div
            className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
            onClick={() => setPreviewIdx(null)}
          >
            <button className="absolute top-4 right-4 text-white" onClick={() => setPreviewIdx(null)}>
              <X size={24} />
            </button>
            <img
              src={images[previewIdx]}
              alt={`Preview ${previewIdx + 1}`}
              className="max-w-full max-h-[90vh] object-contain rounded-lg"
            />
            <span className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white text-[13px] bg-black/60 px-3 py-1 rounded-full">
              Trang {previewIdx + 1} / {images.length}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
