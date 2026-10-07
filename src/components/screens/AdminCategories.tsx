"use client";

import { useAdminConfirm } from "@/components/admin/AdminConfirm";
import { confirmedAdminAction } from "@/lib/admin-confirmed-actions";
import { useState, useEffect, useCallback } from "react";
import {
  Loader2,
  Plus,
  Pencil,
  Trash2,
  GripVertical,
  X,
  Check,
  Eye,
  EyeOff,
} from "@/components/ui/icons";
import { AdminHeader as TopBar } from "@/components/admin/AdminUi";
import {
  getStoryCategories,
  upsertStoryCategory,
  type StoryCategoryRow,
} from "@/lib/db";

interface Props {
  onBack: () => void;
}

const EMOJI_SUGGESTIONS = [
  "📖",
  "🏰",
  "🗺️",
  "🌙",
  "🐾",
  "📚",
  "💛",
  "👨‍👩‍👧‍👦",
  "🔬",
  "🐉",
  "😂",
  "🎵",
  "🌿",
  "📜",
  "🫂",
  "✨",
  "📝",
  "🎭",
  "🧩",
  "🎮",
  "⚽",
  "🍳",
  "🏥",
  "💻",
  "🌍",
];

export default function AdminCategories({ onBack }: Props) {
  const [categories, setCategories] = useState<StoryCategoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<StoryCategoryRow | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const confirm = useAdminConfirm();
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getStoryCategories();
      setCategories(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const startNew = () => {
    setIsNew(true);
    setEditing({
      id: "",
      label: "",
      emoji: "📖",
      description: "",
      sort_order: (categories.length + 1) * 10,
      is_active: true,
      parent_id: null,
      created_at: "",
    });
  };

  const save = async () => {
    if (!editing || !editing.id || !editing.label) return;
    setSaving(true);
    try {
      await upsertStoryCategory({
        id: editing.id,
        label: editing.label,
        emoji: editing.emoji,
        description: editing.description,
        sort_order: editing.sort_order,
        is_active: editing.is_active,
        parent_id: editing.parent_id,
      });
      setEditing(null);
      setIsNew(false);
      await load();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const item = categories.find((x) => x.id === id);
    if (!item) return;
    const reason = await confirm({
      title: `Xoá danh mục “${item.label}”?`,
      description:
        "Xoá cấu hình này khỏi hệ thống. Không thể khôi phục tự động.",
      confirmLabel: "Xoá danh mục",
    });
    if (!reason) return;
    setSaving(true);
    setDeleteError(null);
    try {
      await confirmedAdminAction("category.delete", [id], reason);
      await load();
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : "Xoá thất bại");
    } finally {
      setSaving(false);
    }
  };
  const toggleActive = async (cat: StoryCategoryRow) => {
    await upsertStoryCategory({ ...cat, is_active: !cat.is_active });
    await load();
  };

  return (
    <div className="min-h-screen bg-surface  pb-28">
      <TopBar
        title="Danh mục truyện"
        onBack={onBack}
        rightElement={
          <button
            aria-label="Thêm danh mục"
            onClick={startNew}
            className="w-9 h-9 rounded-full bg-accent flex items-center justify-center text-white"
          >
            <Plus size={18} />
          </button>
        }
      />

      {deleteError && (
        <p role="alert" className="m-5 rounded-xl bg-red-50 p-4 text-red-800">
          {deleteError}
        </p>
      )}
      <div className="px-5 pt-1">
        {loading ? (
          <div className="flex justify-center pt-16">
            <Loader2 size={24} className="animate-spin text-accent" />
          </div>
        ) : (
          <div className="space-y-2">
            {categories.map((cat) => (
              <div
                key={cat.id}
                className={`bg-white  rounded-2xl p-3.5 shadow-[0_1px_3px_rgba(0,0,0,0.04)]  ${
                  !cat.is_active ? "opacity-50" : ""
                }`}
              >
                <div className="flex items-center gap-3">
                  <GripVertical size={16} className="text-gray-300 shrink-0" />
                  <span className="text-xl shrink-0">{cat.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-txt  truncate">
                      {cat.label}
                    </p>
                    <p className="text-sm text-txt-secondary  truncate">
                      {cat.id} · {cat.description || "Không có mô tả"}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      aria-label={`${cat.is_active ? "Ẩn" : "Hiện"} danh mục ${cat.label}`}
                      onClick={() => toggleActive(cat)}
                      className={`w-7 h-7 rounded-lg flex items-center justify-center ${
                        cat.is_active ? "text-emerald-800" : "text-gray-300"
                      }`}
                    >
                      {cat.is_active ? <Eye size={14} /> : <EyeOff size={14} />}
                    </button>
                    <button
                      aria-label={`Sửa danh mục ${cat.label}`}
                      onClick={() => {
                        setEditing(cat);
                        setIsNew(false);
                      }}
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-blue-500"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={() => handleDelete(cat.id)}
                      aria-label={`Xoá danh mục ${cat.label}`}
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-red-400"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            ))}

            {categories.length === 0 && (
              <div className="text-center py-12 text-sm text-txt-secondary ">
                Chưa có danh mục nào. Bấm + để thêm.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Edit/New Modal */}
      {editing && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end justify-center">
          <div className="bg-white  w-full max-w-[430px] rounded-t-3xl p-5 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[15px] font-black text-txt ">
                {isNew ? "Thêm danh mục" : "Sửa danh mục"}
              </h3>
              <button
                aria-label="Đóng form danh mục"
                onClick={() => {
                  setEditing(null);
                  setIsNew(false);
                }}
              >
                <X size={20} className="text-gray-400 " />
              </button>
            </div>

            {/* ID */}
            <label className="block text-sm font-bold text-txt-secondary  mb-1">
              ID (tiếng Anh, không dấu)
            </label>
            <input
              aria-label="ID (tiếng Anh, không dấu)"
              value={editing.id}
              onChange={(e) =>
                setEditing({
                  ...editing,
                  id: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"),
                })
              }
              placeholder="vd: fairy_tale"
              disabled={!isNew}
              className="w-full px-3 py-2.5 rounded-xl border border-gray-200  text-sm mb-3 disabled:bg-gray-50 "
            />

            {/* Label */}
            <label className="block text-sm font-bold text-txt-secondary  mb-1">
              Tên hiển thị
            </label>
            <input
              aria-label="Tên hiển thị"
              value={editing.label}
              onChange={(e) =>
                setEditing({ ...editing, label: e.target.value })
              }
              placeholder="Cổ tích"
              className="w-full px-3 py-2.5 rounded-xl border border-gray-200  text-sm mb-3"
            />

            {/* Emoji */}
            <label className="block text-sm font-bold text-txt-secondary  mb-1">
              Emoji
            </label>
            <div className="flex gap-1.5 flex-wrap mb-3">
              {EMOJI_SUGGESTIONS.map((em) => (
                <button
                  key={em}
                  onClick={() => setEditing({ ...editing, emoji: em })}
                  className={`w-9 h-9 rounded-lg text-lg flex items-center justify-center ${
                    editing.emoji === em
                      ? "bg-accent/20 ring-2 ring-accent"
                      : "bg-gray-100 "
                  }`}
                >
                  {em}
                </button>
              ))}
              <input
                aria-label="Emoji tuỳ chỉnh"
                value={editing.emoji}
                onChange={(e) =>
                  setEditing({ ...editing, emoji: e.target.value })
                }
                className="w-12 h-9 rounded-lg border border-gray-200  text-center text-lg"
                maxLength={2}
              />
            </div>

            {/* Description */}
            <label className="block text-sm font-bold text-txt-secondary  mb-1">
              Mô tả
            </label>
            <input
              aria-label="Mô tả"
              value={editing.description || ""}
              onChange={(e) =>
                setEditing({ ...editing, description: e.target.value })
              }
              placeholder="Mô tả ngắn về danh mục"
              className="w-full px-3 py-2.5 rounded-xl border border-gray-200  text-sm mb-3"
            />

            {/* Sort order */}
            <label className="block text-sm font-bold text-txt-secondary  mb-1">
              Thứ tự hiển thị
            </label>
            <input
              aria-label="Thứ tự hiển thị"
              type="number"
              value={editing.sort_order}
              onChange={(e) =>
                setEditing({
                  ...editing,
                  sort_order: parseInt(e.target.value) || 0,
                })
              }
              className="w-full px-3 py-2.5 rounded-xl border border-gray-200  text-sm mb-3"
            />

            {/* Active toggle */}
            <div className="flex items-center gap-2 mb-5">
              <button
                onClick={() =>
                  setEditing({ ...editing, is_active: !editing.is_active })
                }
                className={`w-10 h-6 rounded-full transition-colors ${
                  editing.is_active ? "bg-emerald-500" : "bg-gray-300"
                }`}
              >
                <div
                  className={`w-5 h-5 bg-white  rounded-full shadow-sm transition-transform ${
                    editing.is_active
                      ? "translate-x-[18px]"
                      : "translate-x-[2px]"
                  }`}
                />
              </button>
              <span className="text-sm font-medium text-txt ">
                {editing.is_active ? "Đang hiển thị" : "Đã ẩn"}
              </span>
            </div>

            <button
              onClick={save}
              disabled={saving || !editing.id || !editing.label}
              className="w-full py-3 rounded-2xl bg-accent text-white font-bold text-[14px] disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {saving ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Check size={16} />
              )}
              {isNew ? "Thêm danh mục" : "Lưu thay đổi"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
