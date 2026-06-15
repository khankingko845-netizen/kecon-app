"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Plus, Trash2, ChevronUp, ChevronDown, Save, Loader2,
  Image as ImageIcon, Globe, FileText, Check, Sparkles, GitBranch, X,
  Headphones, Volume2,
} from "lucide-react";
import TopBar from "@/components/ui/TopBar";
import { useSettings } from "@/lib/settings-context";
import { useData } from "@/lib/data-context";
import { illustrateApi, ttsApi } from "@/lib/api-client";
import {
  getStory,
  getStoryPages,
  updateStory,
  updateStoryPage,
  createStoryPage,
  deleteStoryPage,
  syncPageOrder,
  setStoryPageCount,
  publishStory,
  uploadTtsAudio,
  savePageAudio,
  getPagesMissingAudio,
  type StoryRow,
  type StoryPageRow,
  type PageChoice,
} from "@/lib/db";
import { EFFECT_LABELS, type EffectType } from "@/lib/scene-effects";
import type { Screen } from "@/lib/types";

const EFFECT_NONE = "none";

const CATEGORY_OPTIONS: { id: string; label: string }[] = [
  { id: "fairy_tale", label: "Cổ tích" },
  { id: "adventure", label: "Phiêu lưu" },
  { id: "bedtime", label: "Ru ngủ" },
  { id: "animal", label: "Động vật" },
  { id: "educational", label: "Học chơi" },
  { id: "custom", label: "Tùy chỉnh" },
];

interface StoryEditorProps {
  storyId?: string;
  onBack: () => void;
  onNavigate: (screen: Screen, data?: Record<string, string>) => void;
}

export default function StoryEditor({ storyId, onBack, onNavigate }: StoryEditorProps) {
  const { settings } = useSettings();
  const { refreshStories } = useData();
  const [story, setStory] = useState<StoryRow | null>(null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("custom");
  const [description, setDescription] = useState("");
  const [ageMin, setAgeMin] = useState(3);
  const [ageMax, setAgeMax] = useState(8);
  const [showMeta, setShowMeta] = useState(false);
  const [pages, setPages] = useState<StoryPageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [illustrating, setIllustrating] = useState<string | null>(null);
  const [batchTTS, setBatchTTS] = useState<{ running: boolean; current: number; total: number }>({
    running: false,
    current: 0,
    total: 0,
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!storyId) {
      setLoading(false);
      return;
    }
    let active = true;
    Promise.all([getStory(storyId), getStoryPages(storyId)])
      .then(([s, p]) => {
        if (!active) return;
        setStory(s);
        setTitle(s?.title ?? "");
        setCategory(s?.category ?? "custom");
        setDescription(s?.description ?? "");
        setAgeMin(s?.target_age_min ?? 3);
        setAgeMax(s?.target_age_max ?? 8);
        setPages(p);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Lỗi tải truyện"))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [storyId]);

  const updatePageLocal = (id: string, patch: Partial<StoryPageRow>) => {
    setPages((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  };

  const addChoice = (page: StoryPageRow) => {
    const next: PageChoice[] = [
      ...(page.choices ?? []),
      { label: "", description: "", target: Math.min(page.page_number + 1, pages.length) },
    ];
    updatePageLocal(page.id, { choices: next });
  };

  const updateChoice = (
    page: StoryPageRow,
    idx: number,
    patch: Partial<PageChoice>
  ) => {
    const next = (page.choices ?? []).map((c, i) =>
      i === idx ? { ...c, ...patch } : c
    );
    updatePageLocal(page.id, { choices: next });
  };

  const removeChoice = (page: StoryPageRow, idx: number) => {
    const next = (page.choices ?? []).filter((_, i) => i !== idx);
    updatePageLocal(page.id, { choices: next });
  };

  const handleAddPage = async () => {
    if (!storyId) return;
    try {
      const newPage = await createStoryPage(storyId, pages.length + 1);
      setPages((prev) => [...prev, newPage]);
      await setStoryPageCount(storyId, pages.length + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không thêm được trang");
    }
  };

  const handleDeletePage = async (id: string) => {
    if (!storyId) return;
    try {
      await deleteStoryPage(id);
      const remaining = pages
        .filter((p) => p.id !== id)
        .map((p, i) => ({ ...p, page_number: i + 1 }));
      setPages(remaining);
      await syncPageOrder(remaining.map((p) => ({ id: p.id, page_number: p.page_number })));
      await setStoryPageCount(storyId, remaining.length);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không xoá được trang");
    }
  };

  const movePage = async (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= pages.length) return;
    const reordered = [...pages];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    const renumbered = reordered.map((p, i) => ({ ...p, page_number: i + 1 }));
    setPages(renumbered);
    await syncPageOrder(renumbered.map((p) => ({ id: p.id, page_number: p.page_number })));
  };

  const handleSave = useCallback(async () => {
    if (!storyId) return;
    setSaving(true);
    setError(null);
    try {
      const branching = pages.some((p) => (p.choices?.length ?? 0) > 0);
      await updateStory(storyId, {
        title,
        category,
        description,
        target_age_min: ageMin,
        target_age_max: ageMax,
        is_branching: branching,
      });
      await Promise.all(
        pages.map((p) =>
          updateStoryPage(p.id, {
            content: p.content,
            scene_description: p.scene_description,
            page_number: p.page_number,
            particle_effect: p.particle_effect,
            choices: p.choices ?? [],
          })
        )
      );
      await refreshStories();
      setSavedAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lưu thất bại");
    } finally {
      setSaving(false);
    }
  }, [storyId, title, category, description, ageMin, ageMax, pages, refreshStories]);

  const handleIllustrate = async (page: StoryPageRow) => {
    const prompt = page.scene_description || page.content;
    if (!prompt) return;
    setIllustrating(page.id);
    setError(null);
    try {
      const url = await illustrateApi(prompt, settings.storyApiKey || undefined);
      updatePageLocal(page.id, { illustration_url: url });
      await updateStoryPage(page.id, { illustration_url: url });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Tạo minh hoạ thất bại");
    } finally {
      setIllustrating(null);
    }
  };

  const handlePublish = async () => {
    if (!storyId || !story) return;
    setSaving(true);
    try {
      await handleSave();
      await publishStory(storyId, !story.is_published);
      setStory({ ...story, is_published: !story.is_published });
      await refreshStories();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi xuất bản");
    } finally {
      setSaving(false);
    }
  };

  const handleBatchTTS = async () => {
    if (!storyId || !settings.elevenLabsApiKey) {
      setError("Cần cấu hình ElevenLabs API Key trong Cài Đặt");
      return;
    }
    const missing = await getPagesMissingAudio(storyId);
    if (missing.length === 0) {
      setError("Tất cả trang đã có audio");
      return;
    }
    setBatchTTS({ running: true, current: 0, total: missing.length });
    setError(null);
    const voiceId = "pNInz6obpgDQGcFmaJgB"; // Default voice
    for (let i = 0; i < missing.length; i++) {
      setBatchTTS((prev) => ({ ...prev, current: i + 1 }));
      try {
        const text = missing[i].content;
        if (!text) continue;
        const blob = await ttsApi(
          voiceId,
          text,
          settings.elevenLabsApiKey,
          settings.elevenLabsModelId,
          story?.locale || "vi"
        );
        const audioUrl = await uploadTtsAudio(missing[i].id, blob);
        await savePageAudio(missing[i].id, audioUrl, 0);
        updatePageLocal(missing[i].id, { audio_url: audioUrl });
      } catch (e) {
        setError(`Lỗi trang ${missing[i].page_number}: ${e instanceof Error ? e.message : "?"}`);
        break;
      }
    }
    setBatchTTS({ running: false, current: 0, total: 0 });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-white">
        <TopBar title="Soạn Truyện" onBack={onBack} />
        <div className="flex justify-center pt-20">
          <Loader2 size={26} className="animate-spin text-accent" />
        </div>
      </div>
    );
  }

  if (!story) {
    return (
      <div className="min-h-screen bg-white">
        <TopBar title="Soạn Truyện" onBack={onBack} />
        <p className="px-5 pt-10 text-center text-txt-secondary text-sm">
          Không tìm thấy truyện.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface pb-32">
      <TopBar title="Soạn Truyện" onBack={onBack} />

      <div className="px-5 pt-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Tiêu đề truyện"
          className="w-full px-4 py-3.5 rounded-xl border-[1.5px] border-gray-200 bg-white text-[17px] font-bold text-txt outline-none focus:border-accent transition-colors mb-2"
        />

        {/* Metadata (collapsible) */}
        <button
          onClick={() => setShowMeta((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-2.5 rounded-xl bg-white border border-gray-100 text-[13px] font-bold text-txt-secondary mb-2"
        >
          <span>Chi tiết truyện</span>
          {showMeta ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        {showMeta && (
          <div className="bg-white rounded-xl border border-gray-100 p-3.5 mb-2 space-y-3">
            <div>
              <label className="text-[12px] font-bold text-txt-secondary block mb-1.5">Thể loại</label>
              <div className="flex flex-wrap gap-1.5">
                {CATEGORY_OPTIONS.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setCategory(c.id)}
                    className={`px-2.5 py-1.5 rounded-lg text-[12px] font-bold ${
                      category === c.id
                        ? "bg-accent text-white"
                        : "bg-gray-100 text-txt-secondary"
                    }`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-[12px] font-bold text-txt-secondary block mb-1.5">Mô tả ngắn</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Tóm tắt nội dung truyện..."
                rows={2}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-[13px] outline-none focus:border-accent resize-none"
              />
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-[12px] font-bold text-txt-secondary block mb-1.5">Tuổi từ</label>
                <input
                  type="number"
                  min={0}
                  max={18}
                  value={ageMin}
                  onChange={(e) => setAgeMin(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-[13px] outline-none focus:border-accent"
                />
              </div>
              <div className="flex-1">
                <label className="text-[12px] font-bold text-txt-secondary block mb-1.5">Tuổi đến</label>
                <input
                  type="number"
                  min={0}
                  max={18}
                  value={ageMax}
                  onChange={(e) => setAgeMax(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-[13px] outline-none focus:border-accent"
                />
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 mb-4">
          <span className="text-[11px] font-bold px-2.5 py-1 rounded-md bg-gray-100 text-txt-secondary">
            {pages.length} trang
          </span>
          <span
            className={`text-[11px] font-bold px-2.5 py-1 rounded-md ${
              story.is_published
                ? "bg-emerald-100 text-emerald-700"
                : "bg-amber-100 text-amber-700"
            }`}
          >
            {story.is_published ? "Đã xuất bản" : "Bản nháp"}
          </span>
          {savedAt && (
            <span className="text-[11px] text-emerald-600 font-semibold flex items-center gap-1">
              <Check size={12} /> Đã lưu
            </span>
          )}
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-[13px] text-red-700">
            {error}
          </div>
        )}

        {/* Pages */}
        <div className="space-y-3">
          {pages.map((page, i) => (
            <div
              key={page.id}
              className="bg-white rounded-2xl border border-gray-100 p-3.5 shadow-[0_1px_3px_rgba(0,0,0,0.03)]"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-[13px] font-black text-accent">
                  Trang {i + 1}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => movePage(i, -1)}
                    disabled={i === 0}
                    className="w-7 h-7 rounded-lg bg-gray-50 flex items-center justify-center text-gray-500 disabled:opacity-30"
                  >
                    <ChevronUp size={16} />
                  </button>
                  <button
                    onClick={() => movePage(i, 1)}
                    disabled={i === pages.length - 1}
                    className="w-7 h-7 rounded-lg bg-gray-50 flex items-center justify-center text-gray-500 disabled:opacity-30"
                  >
                    <ChevronDown size={16} />
                  </button>
                  <button
                    onClick={() => handleDeletePage(page.id)}
                    className="w-7 h-7 rounded-lg bg-red-50 flex items-center justify-center text-red-500"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              <textarea
                value={page.content}
                onChange={(e) => updatePageLocal(page.id, { content: e.target.value })}
                placeholder="Nội dung trang..."
                className="w-full px-3 py-2.5 rounded-xl border-[1.5px] border-gray-200 bg-surface text-[14px] text-txt outline-none focus:border-accent transition-colors resize-none h-24 mb-2"
              />
              <input
                value={page.scene_description ?? ""}
                onChange={(e) => updatePageLocal(page.id, { scene_description: e.target.value })}
                placeholder="Mô tả cảnh (cho minh hoạ AI)..."
                className="w-full px-3 py-2.5 rounded-xl border-[1.5px] border-gray-200 bg-surface text-[12px] text-txt-secondary outline-none focus:border-accent transition-colors mb-2"
              />

              {/* Visual effect for this page */}
              <label className="text-[11px] font-bold text-txt-secondary mb-1.5 flex items-center gap-1">
                <Sparkles size={12} className="text-accent-2" /> Hiệu ứng hình ảnh
              </label>
              <select
                value={page.particle_effect ?? EFFECT_NONE}
                onChange={(e) =>
                  updatePageLocal(page.id, {
                    particle_effect:
                      e.target.value === EFFECT_NONE ? null : e.target.value,
                  })
                }
                className="w-full px-3 py-2 rounded-xl border-[1.5px] border-gray-200 bg-surface text-[12px] text-txt outline-none focus:border-accent transition-colors mb-3"
              >
                <option value={EFFECT_NONE}>Tự động theo cảnh</option>
                {(Object.keys(EFFECT_LABELS) as EffectType[]).map((t) => (
                  <option key={t} value={t}>
                    {EFFECT_LABELS[t]}
                  </option>
                ))}
              </select>

              {/* Branching choices for this page */}
              <div className="mb-2 rounded-xl bg-surface border border-gray-100 p-2.5">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] font-bold text-txt-secondary flex items-center gap-1">
                    <GitBranch size={12} className="text-emerald-600" /> Lựa chọn rẽ nhánh
                  </span>
                  <button
                    onClick={() => addChoice(page)}
                    className="text-[11px] font-bold text-emerald-700 flex items-center gap-0.5"
                  >
                    <Plus size={12} /> Thêm
                  </button>
                </div>
                {(page.choices ?? []).length === 0 ? (
                  <p className="text-[11px] text-txt-secondary/60">
                    Không có lựa chọn — trang đọc tuần tự.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {(page.choices ?? []).map((choice, ci) => (
                      <div key={ci} className="flex items-center gap-1.5">
                        <input
                          value={choice.label}
                          onChange={(e) =>
                            updateChoice(page, ci, { label: e.target.value })
                          }
                          placeholder={`Lựa chọn ${ci + 1}`}
                          className="flex-1 px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white text-[12px] text-txt outline-none focus:border-accent"
                        />
                        <select
                          value={choice.target}
                          onChange={(e) =>
                            updateChoice(page, ci, {
                              target: Number(e.target.value),
                            })
                          }
                          className="px-2 py-1.5 rounded-lg border border-gray-200 bg-white text-[12px] text-txt outline-none focus:border-accent"
                        >
                          {pages.map((_, pi) => (
                            <option key={pi} value={pi + 1}>
                              → Trang {pi + 1}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={() => removeChoice(page, ci)}
                          className="w-6 h-6 rounded-lg bg-red-50 flex items-center justify-center text-red-500 shrink-0"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {page.illustration_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={page.illustration_url}
                  alt={`Minh hoạ trang ${i + 1}`}
                  className="w-full h-40 object-cover rounded-xl mb-2"
                />
              ) : null}

              <button
                onClick={() => handleIllustrate(page)}
                disabled={illustrating === page.id}
                className="inline-flex items-center gap-1.5 text-[12px] font-bold text-accent-2 px-3 py-1.5 rounded-lg bg-accent-2/10 disabled:opacity-50"
              >
                {illustrating === page.id ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <ImageIcon size={13} />
                )}
                {page.illustration_url ? "Tạo lại minh hoạ" : "Minh hoạ AI"}
              </button>
            </div>
          ))}
        </div>

        <button
          onClick={handleAddPage}
          className="w-full mt-3 py-3.5 rounded-2xl border-2 border-dashed border-gray-300 text-[14px] font-bold text-txt-secondary flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
        >
          <Plus size={18} /> Thêm trang
        </button>

        {/* Batch TTS */}
        <button
          onClick={handleBatchTTS}
          disabled={batchTTS.running}
          className="w-full mt-3 py-3.5 rounded-2xl bg-violet-50 border border-violet-200 text-[14px] font-bold text-violet-700 flex items-center justify-center gap-2 active:scale-[0.98] transition-transform disabled:opacity-60"
        >
          {batchTTS.running ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Đang tạo audio {batchTTS.current}/{batchTTS.total}...
            </>
          ) : (
            <>
              <Headphones size={16} /> Tạo giọng đọc toàn bộ
            </>
          )}
        </button>
        <p className="text-[11px] text-txt-secondary text-center mt-1 mb-2">
          Tự động tạo TTS cho các trang chưa có audio (cần ElevenLabs API Key)
        </p>

        <div className="flex gap-2 mt-2">
          <button
            onClick={() => onNavigate("player", { storyId: story.id })}
            className="flex-1 py-3.5 rounded-2xl bg-gray-100 text-[14px] font-bold text-txt flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
          >
            <FileText size={16} /> Xem thử
          </button>
          <button
            onClick={handlePublish}
            disabled={saving}
            className="flex-1 py-3.5 rounded-2xl bg-emerald-500 text-white text-[14px] font-bold flex items-center justify-center gap-2 active:scale-[0.98] transition-transform disabled:opacity-60"
          >
            <Globe size={16} />
            {story.is_published ? "Gỡ xuất bản" : "Xuất bản"}
          </button>
        </div>
      </div>

      {/* Sticky Save */}
      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] px-5 py-4 bg-gradient-to-t from-white via-white to-transparent">
        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full py-[16px] rounded-[14px] bg-gradient-to-r from-accent to-pink-500 text-white font-bold text-[15px] flex items-center justify-center gap-2 shadow-lg shadow-accent/30 active:scale-[0.98] transition-transform disabled:opacity-60"
        >
          {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
          Lưu truyện
        </button>
      </div>
    </div>
  );
}
