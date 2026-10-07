"use client";

import { useAdminConfirm } from "@/components/admin/AdminConfirm";
import { confirmedAdminAction } from "@/lib/admin-confirmed-actions";
import { useState, useEffect, useCallback } from "react";
import {
  Loader2,
  Search,
  Globe,
  Trash2,
  RotateCcw,
  Pencil,
  CheckSquare,
  Square,
  Eye,
  Bookmark,
  FileText,
} from "@/components/ui/icons";
import { AdminHeader as TopBar } from "@/components/admin/AdminUi";
import { useData } from "@/lib/data-context";
import {
  getAdminStories,
  bulkPublishStories,
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
  if (s.deleted_at) return { text: "Đã xoá", cls: "bg-red-100 text-red-700" };
  if (s.is_published || s.status === "published")
    return { text: "Xuất bản", cls: "bg-emerald-100 text-emerald-800" };
  if (s.status === "pending_review")
    return { text: "Chờ duyệt", cls: "bg-amber-100 text-amber-800" };
  return { text: "Nháp", cls: "bg-gray-100  text-gray-500 " };
}

export default function AdminStories({
  onBack,
  onNavigate,
}: AdminStoriesProps) {
  const { refreshStories } = useData();
  const confirm = useAdminConfirm();
  const [actionError, setActionError] = useState<string | null>(null);
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
    const reason =
      action !== "publish"
        ? await confirm({
            title:
              action === "delete"
                ? `Xoá ${ids.length} truyện?`
                : `Ẩn ${ids.length} truyện?`,
            description:
              action === "delete"
                ? "Truyện sẽ vào thùng rác và ngừng xuất hiện. Có thể khôi phục sau."
                : "Truyện sẽ ngừng hiển thị trong thư viện bé.",
            confirmLabel: action === "delete" ? "Xoá truyện" : "Ẩn truyện",
          })
        : null;
    if (action !== "publish" && !reason) return;
    setActionError(null);
    setWorking(true);
    try {
      if (action === "publish") await bulkPublishStories(ids, true);
      else
        await confirmedAdminAction(
          action === "unpublish" ? "story.unpublish" : "story.trash",
          ids,
          reason!,
        );
      await refreshStories();
      await load();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Thao tác chưa thành công",
      );
    } finally {
      setWorking(false);
    }
  };

  const handleRowAction = async (
    story: StoryRow,
    action: "publish" | "delete" | "restore" | "template",
  ) => {
    const dangerous =
      action === "delete" || (action === "publish" && story.is_published);
    const reason = dangerous
      ? await confirm({
          title:
            action === "delete"
              ? `Xoá truyện “${story.title}”?`
              : `Ẩn truyện “${story.title}”?`,
          description:
            action === "delete"
              ? "Chuyển vào thùng rác; có thể khôi phục sau."
              : "Ngừng hiển thị truyện trong thư viện bé.",
          confirmLabel: action === "delete" ? "Xoá truyện" : "Ẩn truyện",
        })
      : null;
    if (dangerous && !reason) return;
    setWorking(true);
    setActionError(null);
    try {
      if (dangerous)
        await confirmedAdminAction(
          action === "delete" ? "story.trash" : "story.unpublish",
          [story.id],
          reason!,
        );
      else if (action === "publish") await publishStory(story.id, true);
      else if (action === "restore") await restoreStory(story.id);
      else if (action === "template") await createTemplateFromStory(story.id);
      await refreshStories();
      await load();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Thao tác chưa thành công",
      );
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface  pb-28">
      <TopBar
        title="Quản lý truyện"
        onBack={onBack}
        rightElement={
          <button
            onClick={() => setShowDeleted((v) => !v)}
            className={`text-sm font-bold px-2.5 py-1.5 rounded-lg ${
              showDeleted
                ? "bg-red-100 text-red-700"
                : "bg-gray-100  text-txt-secondary "
            }`}
          >
            {showDeleted ? "Ẩn đã xoá" : "Thùng rác"}
          </button>
        }
      />

      <div className="px-5 pt-1">
        {actionError && (
          <p role="alert" className="m-5 rounded-xl bg-red-50 p-4 text-red-800">
            {actionError}
          </p>
        )}
        {/* Search */}
        <div className="bg-white  rounded-[14px] px-4 py-3 flex items-center gap-2.5 shadow-[0_1px_3px_rgba(0,0,0,0.04)]  mb-3">
          <Search size={18} className="text-gray-400 " />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Tìm truyện theo tiêu đề"
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
              className={`px-3 py-1.5 rounded-full text-sm font-bold whitespace-nowrap ${
                status === t.id
                  ? "bg-accent text-white"
                  : "bg-white  text-txt-secondary "
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
              className="flex items-center gap-1.5 text-sm font-bold text-txt-secondary "
            >
              {allSelected ? (
                <CheckSquare size={16} className="text-accent" />
              ) : (
                <Square size={16} />
              )}
              Chọn tất cả
            </button>
            <span className="text-sm text-txt-secondary  font-medium">
              {stories.length} truyện
            </span>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center pt-16">
            <Loader2 size={24} className="animate-spin text-accent" />
          </div>
        ) : stories.length === 0 ? (
          <div className="bg-white  rounded-2xl p-6 text-center text-sm text-txt-secondary  mt-2">
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
                  className={`bg-white  rounded-2xl p-3 shadow-[0_1px_3px_rgba(0,0,0,0.03)] ${
                    isSel ? "ring-2 ring-accent" : ""
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <button
                      aria-label={`Chọn truyện ${story.title}`}
                      aria-pressed={isSel}
                      onClick={() => toggle(story.id)}
                      className="shrink-0"
                    >
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
                        <p className="text-sm font-bold truncate">
                          {story.title}
                        </p>
                        {story.is_platform_content && (
                          <Globe size={11} className="text-accent shrink-0" />
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                        <span
                          className={`text-sm font-black whitespace-nowrap px-1.5 py-0.5 rounded ${badge.cls}`}
                        >
                          {badge.text}
                        </span>
                        <span className="text-sm text-txt-secondary ">
                          {categoryLabels[story.category] || story.category} ·{" "}
                          {story.page_count} trang · {story.play_count} nghe
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
                        className="flex-1 py-1.5 rounded-lg bg-emerald-50 text-emerald-800 text-sm font-bold flex items-center justify-center gap-1 disabled:opacity-60"
                      >
                        <RotateCcw size={13} /> Khôi phục
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={() =>
                            onNavigate("editor", { storyId: story.id })
                          }
                          className="flex-1 py-1.5 rounded-lg bg-gray-100  text-txt  text-sm font-bold flex items-center justify-center gap-1"
                        >
                          <Pencil size={13} /> Sửa
                        </button>
                        <button
                          onClick={() =>
                            onNavigate("player", { storyId: story.id })
                          }
                          aria-label={`Xem trước ${story.title}`}
                          className="py-1.5 px-2.5 rounded-lg bg-gray-100  text-txt  text-sm font-bold flex items-center justify-center"
                        >
                          <Eye size={13} />
                        </button>
                        <button
                          onClick={() => handleRowAction(story, "template")}
                          disabled={working}
                          className="py-1.5 px-2.5 rounded-lg bg-violet-50 text-violet-800 text-sm font-bold flex items-center justify-center disabled:opacity-60"
                          title="Lưu làm template"
                        >
                          <Bookmark size={13} />
                        </button>
                        <button
                          onClick={() => handleRowAction(story, "publish")}
                          disabled={working}
                          className={`py-1.5 px-2.5 rounded-lg text-sm font-bold flex items-center justify-center disabled:opacity-60 ${
                            story.is_published
                              ? "bg-amber-50 text-amber-800"
                              : "bg-emerald-500 text-white"
                          }`}
                          title={
                            story.is_published ? "Gỡ xuất bản" : "Xuất bản"
                          }
                        >
                          <Globe size={13} />
                        </button>
                        <button
                          aria-label={`Xoá truyện ${story.title}`}
                          onClick={() => handleRowAction(story, "delete")}
                          disabled={working}
                          className="py-1.5 px-2.5 rounded-lg bg-red-50 text-red-700 text-sm font-bold flex items-center justify-center disabled:opacity-60"
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
        <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] bg-white  border-t border-gray-100  px-4 py-3 flex items-center gap-2 shadow-[0_-2px_12px_rgba(0,0,0,0.06)]">
          <span className="text-sm font-bold text-txt-secondary  shrink-0">
            {selected.size} chọn
          </span>
          <button
            onClick={() => doBulk("publish")}
            disabled={working}
            className="flex-1 py-2 rounded-xl bg-emerald-500 text-white text-sm font-bold flex items-center justify-center gap-1 disabled:opacity-60"
          >
            {working ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Globe size={13} />
            )}
            Xuất bản
          </button>
          <button
            onClick={() => doBulk("unpublish")}
            disabled={working}
            className="flex-1 py-2 rounded-xl bg-amber-100 text-amber-700 text-sm font-bold flex items-center justify-center gap-1 disabled:opacity-60"
          >
            <FileText size={13} /> Gỡ
          </button>
          <button
            onClick={() => doBulk("delete")}
            disabled={working}
            className="flex-1 py-2 rounded-xl bg-red-50 text-red-700 text-sm font-bold flex items-center justify-center gap-1 disabled:opacity-60"
          >
            <Trash2 size={13} /> Xoá
          </button>
        </div>
      )}
    </div>
  );
}
