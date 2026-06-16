"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Loader2, Search, Globe, Trash2, RotateCcw, Pencil, CheckSquare,
  Square, Eye, Bookmark, FileText,
} from "lucide-react";
import TopBar from "@/components/ui/TopBar";
import { useData } from "@/lib/data-context";
import {
  getAdminStories,
  bulkPublishStories,
  bulkSoftDeleteStories,
  softDeleteStory,
  restoreStory,
  publishStory,
  createTemplateFromStory,
  gradientFor,
  type StoryRow,
  type AdminStoriesFilter,
} from "@/lib/db";
import type { Screen } from "@/lib/types";

interface AdminStoriesProps {
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

const statusTabs: { id: AdminStoriesFilter["status"]; label: string }[] = [
  { id: "all", label: "Tất cả" },
  { id: "published", label: "Đã xuất bản" },
  { id: "draft", label: "Nháp" },
  { id: "pending_review", label: "Chờ duyệt" },
];

function statusBadge(s: StoryRow) {
  if (s.deleted_at)
    return { text: "Đã xoá", cls: "bg-red-100 text-red-600" };
  if (s.is_published || s.status === "published")
    return { text: "Xuất bản", cls: "bg-emerald-100 text-emerald-600" };
  if (s.status === "pending_review")
    return { text: "Chờ duyệt", cls: "bg-amber-100 text-amber-600" };
  return { text: "Nháp", cls: "bg-gray-100 dark:bg-white/[0.06] text-gray-500 dark:text-white/40" };
}

export default function AdminStories({ onBack, onNavigate }: AdminStoriesProps) {
  const { refreshStories } = useData();
  const [stories, setStories] = useState<StoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<AdminStoriesFilter["status"]>("all");
  const [search, setSearch] = useState("");
  const [showDeleted, setShowDeleted] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [working, setWorking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getAdminStories({
        status,
        search,
        includeDeleted: showDeleted,
      });
      setStories(data);
      setSelected(new Set());
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [status, search, showDeleted]);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allSelected = stories.length > 0 && selected.size === stories.length;
  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(stories.map((s) => s.id)));
  };

  const doBulk = async (action: "publish" | "unpublish" | "delete") => {
    if (selected.size === 0) return;
    const ids = Array.from(selected);
    setWorking(true);
    try {
      if (action === "publish") await bulkPublishStories(ids, true);
      else if (action === "unpublish") await bulkPublishStories(ids, false);
      else await bulkSoftDeleteStories(ids);
      await refreshStories();
      await load();
    } catch {
      /* ignore */
    } finally {
      setWorking(false);
    }
  };

  const handleRowAction = async (
    story: StoryRow,
    action: "publish" | "delete" | "restore" | "template"
  ) => {
    setWorking(true);
    try {
      if (action === "publish") await publishStory(story.id, !story.is_published);
      else if (action === "delete") await softDeleteStory(story.id);
      else if (action === "restore") await restoreStory(story.id);
      else if (action === "template") await createTemplateFromStory(story.id);
      await refreshStories();
      await load();
    } catch {
      /* ignore */
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface dark:bg-[#0A0A0F] pb-28">
      <TopBar
        title="Quản lý truyện"
        onBack={onBack}
        rightElement={
          <button
            onClick={() => setShowDeleted((v) => !v)}
            className={`text-[12px] font-bold px-2.5 py-1.5 rounded-lg ${
              showDeleted ? "bg-red-100 text-red-600" : "bg-gray-100 dark:bg-white/[0.06] text-txt-secondary dark:text-white/50"
            }`}
          >
            {showDeleted ? "Ẩn đã xoá" : "Thùng rác"}
          </button>
        }
      />

      <div className="px-5 pt-1">
        {/* Search */}
        <div className="bg-white dark:bg-white/[0.04] rounded-[14px] px-4 py-3 flex items-center gap-2.5 shadow-[0_1px_3px_rgba(0,0,0,0.04)] dark:shadow-none mb-3">
          <Search size={18} className="text-gray-400 dark:text-white/30" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm theo tiêu đề..."
            className="flex-1 text-sm outline-none bg-transparent"
          />
        </div>

        {/* Status tabs */}
        <div className="flex gap-2 overflow-x-auto no-scrollbar mb-3">
          {statusTabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setStatus(t.id)}
              className={`px-3 py-1.5 rounded-full text-[12px] font-bold whitespace-nowrap ${
                status === t.id
                  ? "bg-accent text-white"
                  : "bg-white dark:bg-white/[0.04] text-txt-secondary dark:text-white/50"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Select all + count */}
        {stories.length > 0 && (
          <div className="flex items-center justify-between mb-2">
            <button
              onClick={toggleAll}
              className="flex items-center gap-1.5 text-[12px] font-bold text-txt-secondary dark:text-white/50"
            >
              {allSelected ? (
                <CheckSquare size={16} className="text-accent" />
              ) : (
                <Square size={16} />
              )}
              Chọn tất cả
            </button>
            <span className="text-[12px] text-txt-secondary dark:text-white/50 font-medium">
              {stories.length} truyện
            </span>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center pt-16">
            <Loader2 size={24} className="animate-spin text-accent" />
          </div>
        ) : stories.length === 0 ? (
          <div className="bg-white dark:bg-white/[0.04] rounded-2xl p-6 text-center text-[13px] text-txt-secondary dark:text-white/50 mt-2">
            Không có truyện nào
          </div>
        ) : (
          <div className="space-y-2">
            {stories.map((story) => {
              const badge = statusBadge(story);
              const isSel = selected.has(story.id);
              return (
                <div
                  key={story.id}
                  className={`bg-white dark:bg-white/[0.04] rounded-2xl p-3 shadow-[0_1px_3px_rgba(0,0,0,0.03)] ${
                    isSel ? "ring-2 ring-accent" : ""
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <button onClick={() => toggle(story.id)} className="shrink-0">
                      {isSel ? (
                        <CheckSquare size={20} className="text-accent" />
                      ) : (
                        <Square size={20} className="text-gray-300" />
                      )}
                    </button>
                    <div
                      className={`w-11 h-11 rounded-xl bg-gradient-to-br ${gradientFor(story.id)} shrink-0`}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-[13px] font-bold truncate">{story.title}</p>
                        {story.is_platform_content && (
                          <Globe size={11} className="text-accent shrink-0" />
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className={`text-[10px] font-black px-1.5 py-0.5 rounded ${badge.cls}`}>
                          {badge.text}
                        </span>
                        <span className="text-[11px] text-txt-secondary dark:text-white/50">
                          {categoryLabels[story.category] || story.category} · {story.page_count} trang · {story.play_count} nghe
                        </span>
                      </div>
                    </div>
                  </div>
                  {/* Row actions */}
                  <div className="flex gap-1.5 mt-2.5 pl-[30px]">
                    {story.deleted_at ? (
                      <button
                        onClick={() => handleRowAction(story, "restore")}
                        disabled={working}
                        className="flex-1 py-1.5 rounded-lg bg-emerald-50 text-emerald-600 text-[12px] font-bold flex items-center justify-center gap-1 disabled:opacity-60"
                      >
                        <RotateCcw size={13} /> Khôi phục
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={() => onNavigate("editor", { storyId: story.id })}
                          className="flex-1 py-1.5 rounded-lg bg-gray-100 dark:bg-white/[0.06] text-txt dark:text-white text-[12px] font-bold flex items-center justify-center gap-1"
                        >
                          <Pencil size={13} /> Sửa
                        </button>
                        <button
                          onClick={() => onNavigate("player", { storyId: story.id })}
                          className="py-1.5 px-2.5 rounded-lg bg-gray-100 dark:bg-white/[0.06] text-txt dark:text-white text-[12px] font-bold flex items-center justify-center"
                        >
                          <Eye size={13} />
                        </button>
                        <button
                          onClick={() => handleRowAction(story, "template")}
                          disabled={working}
                          className="py-1.5 px-2.5 rounded-lg bg-violet-50 text-violet-600 text-[12px] font-bold flex items-center justify-center disabled:opacity-60"
                          title="Lưu làm template"
                        >
                          <Bookmark size={13} />
                        </button>
                        <button
                          onClick={() => handleRowAction(story, "publish")}
                          disabled={working}
                          className={`py-1.5 px-2.5 rounded-lg text-[12px] font-bold flex items-center justify-center disabled:opacity-60 ${
                            story.is_published
                              ? "bg-amber-50 text-amber-600"
                              : "bg-emerald-500 text-white"
                          }`}
                          title={story.is_published ? "Gỡ xuất bản" : "Xuất bản"}
                        >
                          <Globe size={13} />
                        </button>
                        <button
                          onClick={() => handleRowAction(story, "delete")}
                          disabled={working}
                          className="py-1.5 px-2.5 rounded-lg bg-red-50 text-red-600 text-[12px] font-bold flex items-center justify-center disabled:opacity-60"
                        >
                          <Trash2 size={13} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] bg-white dark:bg-white/[0.04] border-t border-gray-100 dark:border-white/[0.06] px-4 py-3 flex items-center gap-2 shadow-[0_-2px_12px_rgba(0,0,0,0.06)]">
          <span className="text-[12px] font-bold text-txt-secondary dark:text-white/50 shrink-0">
            {selected.size} chọn
          </span>
          <button
            onClick={() => doBulk("publish")}
            disabled={working}
            className="flex-1 py-2 rounded-xl bg-emerald-500 text-white text-[12px] font-bold flex items-center justify-center gap-1 disabled:opacity-60"
          >
            {working ? <Loader2 size={13} className="animate-spin" /> : <Globe size={13} />}
            Xuất bản
          </button>
          <button
            onClick={() => doBulk("unpublish")}
            disabled={working}
            className="flex-1 py-2 rounded-xl bg-amber-100 text-amber-700 text-[12px] font-bold flex items-center justify-center gap-1 disabled:opacity-60"
          >
            <FileText size={13} /> Gỡ
          </button>
          <button
            onClick={() => doBulk("delete")}
            disabled={working}
            className="flex-1 py-2 rounded-xl bg-red-50 text-red-600 text-[12px] font-bold flex items-center justify-center gap-1 disabled:opacity-60"
          >
            <Trash2 size={13} /> Xoá
          </button>
        </div>
      )}
    </div>
  );
}
