"use client";

import { useState, useEffect, useCallback } from "react";
import {
  BookOpen, Mic, Play, Heart, Loader2, Lightbulb, Globe,
  FileText, CheckCircle2, AlertTriangle, Sparkles,
  PenLine, Upload, LayoutList, Users, BarChart3, Plus, X, Settings,
  FolderOpen, BookTemplate,
} from "lucide-react";
import TopBar from "@/components/ui/TopBar";
import { useData } from "@/lib/data-context";
import {
  getAdminStats,
  getModerationQueue,
  computeContentGaps,
  publishStory,
  createBlankStory,
  gradientFor,
  type AdminStats,
  type ContentGap,
  type StoryRow,
} from "@/lib/db";
import type { Screen } from "@/lib/types";

interface AdminDashboardProps {
  onBack: () => void;
  onNavigate: (screen: Screen, data?: Record<string, string>) => void;
}

const categoryLabels: Record<string, string> = {
  fairy_tale: "Cổ tích",
  adventure: "Phiêu lưu",
  bedtime: "Ru ngủ",
  animal: "Động vật",
  educational: "Học chơi",
  custom: "Tùy chỉnh",
};

export default function AdminDashboard({ onBack, onNavigate }: AdminDashboardProps) {
  const { refreshStories } = useData();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [gaps, setGaps] = useState<ContentGap[]>([]);
  const [queue, setQueue] = useState<StoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, q] = await Promise.all([getAdminStats(), getModerationQueue()]);
      setStats(s);
      setGaps(computeContentGaps(s.categoryBreakdown));
      setQueue(q);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handlePublish = async (story: StoryRow) => {
    setWorking(story.id);
    try {
      await publishStory(story.id, true);
      setQueue((prev) => prev.filter((s) => s.id !== story.id));
      await refreshStories();
      await load();
    } catch {
      /* ignore */
    } finally {
      setWorking(null);
    }
  };

  const handleWriteByHand = async () => {
    setCreating(true);
    try {
      const id = await createBlankStory({
        title: "Truyện mới",
        source: "manual",
        isPlatformContent: true,
      });
      setShowCreate(false);
      onNavigate("editor", { storyId: id });
    } catch {
      /* ignore */
    } finally {
      setCreating(false);
    }
  };

  const maxCat = stats
    ? Math.max(...stats.categoryBreakdown.map((c) => c.count), 1)
    : 1;

  const kpis = stats
    ? [
        { icon: BookOpen, label: "Truyện", value: stats.totalStories, color: "text-accent bg-orange-50" },
        { icon: Globe, label: "Đã xuất bản", value: stats.publishedStories, color: "text-emerald-600 bg-emerald-50" },
        { icon: Play, label: "Lượt nghe", value: stats.totalPlays, color: "text-blue-600 bg-blue-50" },
        { icon: Heart, label: "Yêu thích", value: stats.totalLikes, color: "text-pink-600 bg-pink-50" },
        { icon: Mic, label: "Giọng nói", value: stats.totalVoices, color: "text-violet-600 bg-violet-50" },
        { icon: FileText, label: "Bản nháp", value: stats.draftStories, color: "text-amber-600 bg-amber-50" },
      ]
    : [];

  return (
    <div className="min-h-screen bg-surface dark:bg-[#0A0A0F] pb-10">
      <TopBar title="Quản Trị" onBack={onBack} />

      {loading ? (
        <div className="flex justify-center pt-20">
          <Loader2 size={26} className="animate-spin text-accent" />
        </div>
      ) : (
        <div className="px-5 pt-2">
          {/* Create story + management hub */}
          <button
            onClick={() => setShowCreate(true)}
            className="w-full mb-3 rounded-2xl bg-gradient-to-r from-accent to-pink-500 text-white p-4 flex items-center gap-3 shadow-[0_4px_12px_rgba(255,107,61,0.25)] active:scale-[0.99] transition-transform"
          >
            <div className="w-10 h-10 rounded-xl bg-white dark:bg-white/[0.04]/20 flex items-center justify-center">
              <Plus size={20} />
            </div>
            <div className="text-left">
              <div className="text-[15px] font-black">Tạo truyện mới</div>
              <div className="text-[12px] text-white/85">Viết tay · AI · Upload</div>
            </div>
          </button>

          <div className="grid grid-cols-3 gap-2 mb-6">
            {[
              { icon: LayoutList, label: "Truyện", screen: "admin-stories" as Screen, color: "text-blue-600 bg-blue-50" },
              { icon: FolderOpen, label: "Danh mục", screen: "admin-categories" as Screen, color: "text-teal-600 bg-teal-50" },
              { icon: BookOpen, label: "Mẫu", screen: "admin-templates" as Screen, color: "text-pink-600 bg-pink-50" },
              { icon: Users, label: "Users", screen: "admin-users" as Screen, color: "text-violet-600 bg-violet-50" },
              { icon: BarChart3, label: "Thống kê", screen: "admin-analytics" as Screen, color: "text-emerald-600 bg-emerald-50" },
              { icon: Settings, label: "Cài Đặt", screen: "admin-settings" as Screen, color: "text-orange-600 bg-orange-50" },
            ].map((m) => (
              <button
                key={m.label}
                onClick={() => onNavigate(m.screen)}
                className="bg-white dark:bg-white/[0.04] rounded-2xl p-3 shadow-[0_1px_3px_rgba(0,0,0,0.03)] flex flex-col items-center gap-1.5 active:scale-[0.97] transition-transform"
              >
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${m.color}`}>
                  <m.icon size={17} />
                </div>
                <span className="text-[11px] font-bold text-txt dark:text-white text-center leading-tight">{m.label}</span>
              </button>
            ))}
          </div>

          {/* KPI grid */}
          <div className="grid grid-cols-3 gap-2.5 mb-6">
            {kpis.map((k) => (
              <div key={k.label} className="bg-white dark:bg-white/[0.04] rounded-2xl p-3 shadow-[0_1px_3px_rgba(0,0,0,0.03)]">
                <div className={`w-8 h-8 rounded-xl flex items-center justify-center mb-2 ${k.color}`}>
                  <k.icon size={16} />
                </div>
                <div className="text-[20px] font-black tracking-tight">{k.value}</div>
                <div className="text-[11px] text-txt-secondary dark:text-white/50 font-medium">{k.label}</div>
              </div>
            ))}
          </div>

          {/* Category chart */}
          <h3 className="text-[15px] font-black tracking-tight mb-2.5">
            Phân bố thể loại
          </h3>
          <div className="bg-white dark:bg-white/[0.04] rounded-2xl p-4 mb-6 shadow-[0_1px_3px_rgba(0,0,0,0.03)] space-y-2.5">
            {stats && stats.categoryBreakdown.length > 0 ? (
              stats.categoryBreakdown.map((c) => (
                <div key={c.category}>
                  <div className="flex justify-between text-[12px] font-semibold mb-1">
                    <span>{categoryLabels[c.category] || c.category}</span>
                    <span className="text-txt-secondary dark:text-white/50">{c.count}</span>
                  </div>
                  <div className="h-2 rounded-full bg-gray-100 dark:bg-white/[0.06] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-accent to-pink-500"
                      style={{ width: `${(c.count / maxCat) * 100}%` }}
                    />
                  </div>
                </div>
              ))
            ) : (
              <p className="text-[13px] text-txt-secondary dark:text-white/50 text-center py-2">
                Chưa có dữ liệu
              </p>
            )}
          </div>

          {/* AI content-gap suggestions */}
          <h3 className="text-[15px] font-black tracking-tight mb-2.5 flex items-center gap-1.5">
            <Lightbulb size={16} className="text-amber-500" /> AI gợi ý nội dung
          </h3>
          <div className="space-y-2 mb-6">
            {gaps
              .filter((g) => g.priority !== "low")
              .map((g) => (
                <div
                  key={g.category}
                  className="bg-white dark:bg-white/[0.04] rounded-2xl p-3.5 shadow-[0_1px_3px_rgba(0,0,0,0.03)] flex items-center gap-3"
                >
                  <span
                    className={`text-[10px] font-black px-2 py-1 rounded-md uppercase ${
                      g.priority === "high"
                        ? "bg-red-100 text-red-600"
                        : "bg-amber-100 text-amber-600"
                    }`}
                  >
                    {g.priority === "high" ? "Cao" : "Vừa"}
                  </span>
                  <p className="flex-1 text-[13px] font-medium text-txt dark:text-white">
                    {g.suggestion}
                  </p>
                  <button
                    onClick={() => onNavigate("create")}
                    className="w-8 h-8 rounded-xl bg-accent/10 flex items-center justify-center text-accent shrink-0"
                  >
                    <Sparkles size={15} />
                  </button>
                </div>
              ))}
            {gaps.filter((g) => g.priority !== "low").length === 0 && (
              <div className="bg-white dark:bg-white/[0.04] rounded-2xl p-4 text-center text-[13px] text-emerald-600 font-semibold flex items-center justify-center gap-1.5">
                <CheckCircle2 size={16} /> Nội dung đã đa dạng
              </div>
            )}
          </div>

          {/* Moderation queue */}
          <h3 className="text-[15px] font-black tracking-tight mb-2.5 flex items-center gap-1.5">
            <AlertTriangle size={16} className="text-amber-500" /> Hàng chờ duyệt
            <span className="text-[12px] font-bold text-txt-secondary dark:text-white/50">
              ({queue.length})
            </span>
          </h3>
          <div className="space-y-2">
            {queue.length === 0 ? (
              <div className="bg-white dark:bg-white/[0.04] rounded-2xl p-4 text-center text-[13px] text-txt-secondary dark:text-white/50">
                Không có truyện chờ duyệt
              </div>
            ) : (
              queue.map((story) => (
                <div
                  key={story.id}
                  className="bg-white dark:bg-white/[0.04] rounded-2xl p-3 shadow-[0_1px_3px_rgba(0,0,0,0.03)] flex items-center gap-3"
                >
                  <div
                    className={`w-11 h-11 rounded-xl bg-gradient-to-br ${gradientFor(story.id)} shrink-0`}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-bold truncate">{story.title}</p>
                    <p className="text-[11px] text-txt-secondary dark:text-white/50">
                      {categoryLabels[story.category] || story.category} ·{" "}
                      {story.page_count} trang
                    </p>
                  </div>
                  <button
                    onClick={() => onNavigate("editor", { storyId: story.id })}
                    className="px-2.5 py-1.5 rounded-lg bg-gray-100 dark:bg-white/[0.06] text-[12px] font-bold text-txt dark:text-white"
                  >
                    Sửa
                  </button>
                  <button
                    onClick={() => handlePublish(story)}
                    disabled={working === story.id}
                    className="px-2.5 py-1.5 rounded-lg bg-emerald-500 text-white text-[12px] font-bold flex items-center gap-1 disabled:opacity-60"
                  >
                    {working === story.id ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <Globe size={12} />
                    )}
                    Duyệt
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {showCreate && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-end justify-center"
          onClick={() => !creating && setShowCreate(false)}
        >
          <div
            className="w-full max-w-[430px] bg-white dark:bg-white/[0.04] rounded-t-3xl p-5 pb-8 animate-[slideUp_0.2s_ease]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[16px] font-black tracking-tight">Tạo truyện mới</h3>
              <button
                onClick={() => !creating && setShowCreate(false)}
                className="w-8 h-8 rounded-full bg-gray-100 dark:bg-white/[0.06] flex items-center justify-center text-txt-secondary dark:text-white/50"
              >
                <X size={16} />
              </button>
            </div>
            <div className="space-y-2.5">
              <button
                onClick={handleWriteByHand}
                disabled={creating}
                className="w-full bg-surface dark:bg-white/[0.04] rounded-2xl p-4 flex items-center gap-3 active:scale-[0.99] transition-transform disabled:opacity-60"
              >
                <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center text-accent">
                  {creating ? <Loader2 size={18} className="animate-spin" /> : <PenLine size={18} />}
                </div>
                <div className="text-left">
                  <div className="text-[14px] font-bold">Viết tay</div>
                  <div className="text-[12px] text-txt-secondary dark:text-white/50">Tạo truyện trống &amp; tự viết từng trang</div>
                </div>
              </button>
              <button
                onClick={() => { setShowCreate(false); onNavigate("create"); }}
                className="w-full bg-surface dark:bg-white/[0.04] rounded-2xl p-4 flex items-center gap-3 active:scale-[0.99] transition-transform"
              >
                <div className="w-10 h-10 rounded-xl bg-violet-100 flex items-center justify-center text-violet-600">
                  <Sparkles size={18} />
                </div>
                <div className="text-left">
                  <div className="text-[14px] font-bold">AI tạo</div>
                  <div className="text-[12px] text-txt-secondary dark:text-white/50">AI sinh cốt truyện theo chủ đề</div>
                </div>
              </button>
              <button
                onClick={() => { setShowCreate(false); onNavigate("upload"); }}
                className="w-full bg-surface dark:bg-white/[0.04] rounded-2xl p-4 flex items-center gap-3 active:scale-[0.99] transition-transform"
              >
                <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center text-blue-600">
                  <Upload size={18} />
                </div>
                <div className="text-left">
                  <div className="text-[14px] font-bold">Upload file</div>
                  <div className="text-[12px] text-txt-secondary dark:text-white/50">Nhập .txt / .docx / .pdf</div>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
