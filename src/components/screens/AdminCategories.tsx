"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Loader2, Plus, Pencil, Trash2, GripVertical, X, Check, Eye, EyeOff,
} from "lucide-react";
import TopBar from "@/components/ui/TopBar";
import {
  getStoryCategories,
  upsertStoryCategory,
  deleteStoryCategory,
  type StoryCategoryRow,
} from "@/lib/db";

interface Props {
  onBack: () => void;
}

const EMOJI_SUGGESTIONS = ["📖","🏰","🗺️","🌙","🐾","📚","💛","👨‍👩‍👧‍👦","🔬","🐉","😂","🎵","🌿","📜","🫂","✨","📝","🎭","🧩","🎮","⚽","🍳","🏥","💻","🌍"];

export default function AdminCategories({ onBack }: Props) {
  const [categories, setCategories] = useState<StoryCategoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<StoryCategoryRow | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getStoryCategories();
      setCategories(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

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
    setSaving(true);
    try {
      await deleteStoryCategory(id);
      setDeleteConfirm(null);
      await load();
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (cat: StoryCategoryRow) => {
    await upsertStoryCategory({ ...cat, is_active: !cat.is_active });
    await load();
  };

  return (
    <div className="min-h-screen bg-surface dark:bg-[#0A0A0F] pb-28">
      <TopBar
        title="Danh mục truyện"
        onBack={onBack}
        rightElement={
          <button
            onClick={startNew}
            className="w-9 h-9 rounded-full bg-accent flex items-center justify-center text-white"
          >
            <Plus size={18} />
          </button>
        }
      />

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
                className={`bg-white dark:bg-white/[0.04] rounded-2xl p-3.5 shadow-[0_1px_3px_rgba(0,0,0,0.04)] dark:shadow-none ${
                  !cat.is_active ? "opacity-50" : ""
                }`}
              >
                <div className="flex items-center gap-3">
                  <GripVertical size={16} className="text-gray-300 shrink-0" />
                  <span className="text-xl shrink-0">{cat.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-bold text-txt dark:text-white truncate">{cat.label}</p>
                    <p className="text-[11px] text-txt-secondary dark:text-white/50 truncate">
                      {cat.id} · {cat.description || "Không có mô tả"}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => toggleActive(cat)}
                      className={`w-7 h-7 rounded-lg flex items-center justify-center ${
                        cat.is_active ? "text-emerald-500" : "text-gray-300"
                      }`}
                    >
                      {cat.is_active ? <Eye size={14} /> : <EyeOff size={14} />}
                    </button>
                    <button
                      onClick={() => { setEditing(cat); setIsNew(false); }}
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-blue-500"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={() => setDeleteConfirm(cat.id)}
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-red-400"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                {/* Delete confirm */}
                {deleteConfirm === cat.id && (
                  <div className="mt-2 p-2.5 bg-red-50 rounded-xl flex items-center gap-2">
                    <span className="text-[12px] text-red-600 font-medium flex-1">
                      Xoá danh mục &quot;{cat.label}&quot;?
                    </span>
                    <button
                      onClick={() => handleDelete(cat.id)}
                      disabled={saving}
                      className="px-3 py-1 rounded-lg bg-red-500 text-white text-[12px] font-bold"
                    >
                      {saving ? <Loader2 size={12} className="animate-spin" /> : "Xoá"}
                    </button>
                    <button
                      onClick={() => setDeleteConfirm(null)}
                      className="px-2 py-1 rounded-lg text-gray-500 dark:text-white/40 text-[12px] font-bold"
                    >
                      Huỷ
                    </button>
                  </div>
                )}
              </div>
            ))}

            {categories.length === 0 && (
              <div className="text-center py-12 text-[13px] text-txt-secondary dark:text-white/50">
                Chưa có danh mục nào. Bấm + để thêm.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Edit/New Modal */}
      {editing && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end justify-center">
          <div className="bg-white dark:bg-white/[0.04] w-full max-w-[430px] rounded-t-3xl p-5 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[15px] font-black text-txt dark:text-white">
                {isNew ? "Thêm danh mục" : "Sửa danh mục"}
              </h3>
              <button onClick={() => { setEditing(null); setIsNew(false); }}>
                <X size={20} className="text-gray-400 dark:text-white/30" />
              </button>
            </div>

            {/* ID */}
            <label className="block text-[12px] font-bold text-txt-secondary dark:text-white/50 mb-1">
              ID (tiếng Anh, không dấu)
            </label>
            <input
              value={editing.id}
              onChange={(e) => setEditing({ ...editing, id: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })}
              placeholder="vd: fairy_tale"
              disabled={!isNew}
              className="w-full px-3 py-2.5 rounded-xl border border-gray-200 dark:border-white/10 text-sm mb-3 disabled:bg-gray-50 dark:bg-white/[0.04]"
            />

            {/* Label */}
            <label className="block text-[12px] font-bold text-txt-secondary dark:text-white/50 mb-1">
              Tên hiển thị
            </label>
            <input
              value={editing.label}
              onChange={(e) => setEditing({ ...editing, label: e.target.value })}
              placeholder="Cổ tích"
              className="w-full px-3 py-2.5 rounded-xl border border-gray-200 dark:border-white/10 text-sm mb-3"
            />

            {/* Emoji */}
            <label className="block text-[12px] font-bold text-txt-secondary dark:text-white/50 mb-1">
              Emoji
            </label>
            <div className="flex gap-1.5 flex-wrap mb-3">
              {EMOJI_SUGGESTIONS.map((em) => (
                <button
                  key={em}
                  onClick={() => setEditing({ ...editing, emoji: em })}
                  className={`w-9 h-9 rounded-lg text-lg flex items-center justify-center ${
                    editing.emoji === em ? "bg-accent/20 ring-2 ring-accent" : "bg-gray-100 dark:bg-white/[0.06]"
                  }`}
                >
                  {em}
                </button>
              ))}
              <input
                value={editing.emoji}
                onChange={(e) => setEditing({ ...editing, emoji: e.target.value })}
                className="w-12 h-9 rounded-lg border border-gray-200 dark:border-white/10 text-center text-lg"
                maxLength={2}
              />
            </div>

            {/* Description */}
            <label className="block text-[12px] font-bold text-txt-secondary dark:text-white/50 mb-1">
              Mô tả
            </label>
            <input
              value={editing.description || ""}
              onChange={(e) => setEditing({ ...editing, description: e.target.value })}
              placeholder="Mô tả ngắn về danh mục"
              className="w-full px-3 py-2.5 rounded-xl border border-gray-200 dark:border-white/10 text-sm mb-3"
            />

            {/* Sort order */}
            <label className="block text-[12px] font-bold text-txt-secondary dark:text-white/50 mb-1">
              Thứ tự hiển thị
            </label>
            <input
              type="number"
              value={editing.sort_order}
              onChange={(e) => setEditing({ ...editing, sort_order: parseInt(e.target.value) || 0 })}
              className="w-full px-3 py-2.5 rounded-xl border border-gray-200 dark:border-white/10 text-sm mb-3"
            />

            {/* Active toggle */}
            <div className="flex items-center gap-2 mb-5">
              <button
                onClick={() => setEditing({ ...editing, is_active: !editing.is_active })}
                className={`w-10 h-6 rounded-full transition-colors ${
                  editing.is_active ? "bg-emerald-500" : "bg-gray-300"
                }`}
              >
                <div className={`w-5 h-5 bg-white dark:bg-white/[0.04] rounded-full shadow-sm transition-transform ${
                  editing.is_active ? "translate-x-[18px]" : "translate-x-[2px]"
                }`} />
              </button>
              <span className="text-[13px] font-medium text-txt dark:text-white">
                {editing.is_active ? "Đang hiển thị" : "Đã ẩn"}
              </span>
            </div>

            <button
              onClick={save}
              disabled={saving || !editing.id || !editing.label}
              className="w-full py-3 rounded-2xl bg-accent text-white font-bold text-[14px] disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
              {isNew ? "Thêm danh mục" : "Lưu thay đổi"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
