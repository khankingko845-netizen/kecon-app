"use client";

import { useState, useEffect, useCallback } from "react";
import {
 Loader2, Plus, Pencil, Trash2, X, Check, Eye, EyeOff,
 Search, ChevronDown, FileText, Copy,
} from "lucide-react";
import TopBar from "@/components/ui/TopBar";
import {
 getAllStoryTemplates,
 upsertStoryTemplate,
 deleteStoryTemplate,
 toggleStoryTemplateActive,
 getStoryCategories,
 type StoryTemplateRow,
 type StoryCategoryRow,
} from "@/lib/db";
import type { Screen } from "@/lib/types";

interface Props {
 onBack: () => void;
 onNavigate: (screen: Screen, data?: Record<string, string>) => void;
}

const BLANK_TPL: Omit<StoryTemplateRow, "created_at" | "created_by"> = {
 id: "",
 title: "",
 description: "",
 category: "fairy_tale",
 emoji: "📖",
 age_min: 3,
 age_max: 8,
 moral_lesson: "",
 tags: [],
 locale: "vi",
 is_active: true,
 sort_order: 100,
 pages: [{ content: "", scene_description: "" }],
};

export default function AdminTemplates({ onBack, onNavigate }: Props) {
 const [templates, setTemplates] = useState<StoryTemplateRow[]>([]);
 const [categories, setCategories] = useState<StoryCategoryRow[]>([]);
 const [loading, setLoading] = useState(true);
 const [search, setSearch] = useState("");
 const [catFilter, setCatFilter] = useState("all");
 const [editing, setEditing] = useState<(typeof BLANK_TPL & { created_at?: string; created_by?: string | null }) | null>(null);
 const [isNew, setIsNew] = useState(false);
 const [saving, setSaving] = useState(false);
 const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
 const [tagInput, setTagInput] = useState("");

 const load = useCallback(async () => {
 setLoading(true);
 try {
 const [tpls, cats] = await Promise.all([getAllStoryTemplates(), getStoryCategories()]);
 setTemplates(tpls);
 setCategories(cats);
 } finally {
 setLoading(false);
 }
 }, []);

 useEffect(() => { load(); }, [load]);

 const filtered = templates.filter((t) => {
 if (catFilter !== "all" && t.category !== catFilter) return false;
 if (search && !t.title.toLowerCase().includes(search.toLowerCase())) return false;
 return true;
 });

 const catLabel = (id: string) => categories.find((c) => c.id === id)?.label || id;
 const catEmoji = (id: string) => categories.find((c) => c.id === id)?.emoji || "📖";

 const startNew = () => {
 setIsNew(true);
 setEditing({ ...BLANK_TPL });
 };

 const startEdit = (tpl: StoryTemplateRow) => {
 setIsNew(false);
 setEditing({ ...tpl });
 };

 const addPage = () => {
 if (!editing) return;
 setEditing({
 ...editing,
 pages: [...editing.pages, { content: "", scene_description: "" }],
 });
 };

 const removePage = (idx: number) => {
 if (!editing || editing.pages.length <= 1) return;
 setEditing({
 ...editing,
 pages: editing.pages.filter((_, i) => i !== idx),
 });
 };

 const updatePage = (idx: number, field: string, val: string) => {
 if (!editing) return;
 const pages = [...editing.pages];
 pages[idx] = { ...pages[idx], [field]: val };
 setEditing({ ...editing, pages });
 };

 const addTag = () => {
 if (!editing || !tagInput.trim()) return;
 setEditing({ ...editing, tags: [...(editing.tags || []), tagInput.trim()] });
 setTagInput("");
 };

 const removeTag = (idx: number) => {
 if (!editing) return;
 setEditing({ ...editing, tags: (editing.tags || []).filter((_, i) => i !== idx) });
 };

 const save = async () => {
 if (!editing || !editing.title || !editing.category || editing.pages.length === 0) return;
 setSaving(true);
 try {
 const payload: Record<string, unknown> = {
 title: editing.title,
 description: editing.description,
 category: editing.category,
 emoji: editing.emoji,
 age_min: editing.age_min,
 age_max: editing.age_max,
 moral_lesson: editing.moral_lesson,
 tags: editing.tags,
 locale: editing.locale,
 is_active: editing.is_active,
 sort_order: editing.sort_order,
 pages: editing.pages,
 };
 if (editing.id) payload.id = editing.id;
 await upsertStoryTemplate(payload as Parameters<typeof upsertStoryTemplate>[0]);
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
 await deleteStoryTemplate(id);
 setDeleteConfirm(null);
 await load();
 } finally {
 setSaving(false);
 }
 };

 const handleToggle = async (tpl: StoryTemplateRow) => {
 await toggleStoryTemplateActive(tpl.id, !tpl.is_active);
 await load();
 };

 const duplicate = (tpl: StoryTemplateRow) => {
 setIsNew(true);
 setEditing({
 ...tpl,
 id: "",
 title: tpl.title + " (bản sao)",
 });
 };

 // If editing, show editor
 if (editing) {
 return (
 <div className="min-h-screen bg-surface dark:bg-[#0A0A0F] pb-28">
 <TopBar
 title={isNew ? "Thêm mẫu truyện" : "Sửa mẫu truyện"}
 onBack={() => { setEditing(null); setIsNew(false); }}
 rightElement={
 <button
 onClick={save}
 disabled={saving || !editing.title}
 className="px-4 py-1.5 rounded-xl bg-accent text-white text-[13px] font-bold disabled:opacity-50 flex items-center gap-1"
 >
 {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
 Lưu
 </button>
 }
 />
 <div className="px-5 pt-1 space-y-3">
 {/* Title */}
 <div>
 <label className="block text-[12px] font-bold text-txt-secondary dark:text-white/50 mb-1">Tiêu đề *</label>
 <input
 value={editing.title}
 onChange={(e) => setEditing({ ...editing, title: e.target.value })}
 placeholder="Tên truyện mẫu"
 className="w-full px-3 py-2.5 rounded-xl border border-gray-200 dark:border-white/10 text-sm"
 />
 </div>

 {/* Description */}
 <div>
 <label className="block text-[12px] font-bold text-txt-secondary dark:text-white/50 mb-1">Mô tả</label>
 <input
 value={editing.description || ""}
 onChange={(e) => setEditing({ ...editing, description: e.target.value })}
 placeholder="Tóm tắt ngắn"
 className="w-full px-3 py-2.5 rounded-xl border border-gray-200 dark:border-white/10 text-sm"
 />
 </div>

 {/* Category + Emoji row */}
 <div className="flex gap-2">
 <div className="flex-1">
 <label className="block text-[12px] font-bold text-txt-secondary dark:text-white/50 mb-1">Danh mục *</label>
 <select
 value={editing.category}
 onChange={(e) => setEditing({ ...editing, category: e.target.value, emoji: catEmoji(e.target.value) })}
 className="w-full px-3 py-2.5 rounded-xl border border-gray-200 dark:border-white/10 text-sm"
 >
 {categories.filter((c) => c.is_active).map((c) => (
 <option key={c.id} value={c.id}>{c.emoji} {c.label}</option>
 ))}
 </select>
 </div>
 <div className="w-20">
 <label className="block text-[12px] font-bold text-txt-secondary dark:text-white/50 mb-1">Emoji</label>
 <input
 value={editing.emoji || ""}
 onChange={(e) => setEditing({ ...editing, emoji: e.target.value })}
 className="w-full px-3 py-2.5 rounded-xl border border-gray-200 dark:border-white/10 text-sm text-center text-lg"
 maxLength={2}
 />
 </div>
 </div>

 {/* Age range */}
 <div className="flex gap-2">
 <div className="flex-1">
 <label className="block text-[12px] font-bold text-txt-secondary dark:text-white/50 mb-1">Tuổi từ</label>
 <input
 type="number"
 value={editing.age_min ?? 0}
 onChange={(e) => setEditing({ ...editing, age_min: parseInt(e.target.value) || 0 })}
 className="w-full px-3 py-2.5 rounded-xl border border-gray-200 dark:border-white/10 text-sm"
 min={0} max={18}
 />
 </div>
 <div className="flex-1">
 <label className="block text-[12px] font-bold text-txt-secondary dark:text-white/50 mb-1">Tuổi đến</label>
 <input
 type="number"
 value={editing.age_max ?? 12}
 onChange={(e) => setEditing({ ...editing, age_max: parseInt(e.target.value) || 12 })}
 className="w-full px-3 py-2.5 rounded-xl border border-gray-200 dark:border-white/10 text-sm"
 min={0} max={18}
 />
 </div>
 <div className="flex-1">
 <label className="block text-[12px] font-bold text-txt-secondary dark:text-white/50 mb-1">Ngôn ngữ</label>
 <select
 value={editing.locale || "vi"}
 onChange={(e) => setEditing({ ...editing, locale: e.target.value })}
 className="w-full px-3 py-2.5 rounded-xl border border-gray-200 dark:border-white/10 text-sm"
 >
 <option value="vi">🇻🇳 Tiếng Việt</option>
 <option value="en">🇺🇸 English</option>
 <option value="ja">🇯🇵 日本語</option>
 </select>
 </div>
 </div>

 {/* Moral lesson */}
 <div>
 <label className="block text-[12px] font-bold text-txt-secondary dark:text-white/50 mb-1">Bài học đạo đức</label>
 <input
 value={editing.moral_lesson || ""}
 onChange={(e) => setEditing({ ...editing, moral_lesson: e.target.value })}
 placeholder="Bài học rút ra từ câu chuyện"
 className="w-full px-3 py-2.5 rounded-xl border border-gray-200 dark:border-white/10 text-sm"
 />
 </div>

 {/* Tags */}
 <div>
 <label className="block text-[12px] font-bold text-txt-secondary dark:text-white/50 mb-1">Tags</label>
 <div className="flex flex-wrap gap-1 mb-1.5">
 {(editing.tags || []).map((tag, i) => (
 <span
 key={i}
 className="px-2 py-0.5 bg-accent/10 text-accent rounded-lg text-[11px] font-bold flex items-center gap-1"
 >
 {tag}
 <button onClick={() => removeTag(i)}><X size={10} /></button>
 </span>
 ))}
 </div>
 <div className="flex gap-1">
 <input
 value={tagInput}
 onChange={(e) => setTagInput(e.target.value)}
 onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addTag())}
 placeholder="Thêm tag..."
 className="flex-1 px-3 py-2 rounded-xl border border-gray-200 dark:border-white/10 text-sm"
 />
 <button
 onClick={addTag}
 className="px-3 py-2 rounded-xl bg-gray-100 dark:bg-white/[0.06] text-[12px] font-bold text-txt-secondary dark:text-white/50"
 >
 +
 </button>
 </div>
 </div>

 {/* Active + sort */}
 <div className="flex items-center gap-4">
 <div className="flex items-center gap-2">
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
 <span className="text-[12px] font-medium">{editing.is_active ? "Hiện" : "Ẩn"}</span>
 </div>
 <div className="flex items-center gap-1.5">
 <span className="text-[12px] font-medium text-txt-secondary dark:text-white/50">Thứ tự:</span>
 <input
 type="number"
 value={editing.sort_order ?? 100}
 onChange={(e) => setEditing({ ...editing, sort_order: parseInt(e.target.value) || 0 })}
 className="w-16 px-2 py-1.5 rounded-lg border border-gray-200 dark:border-white/10 text-sm text-center"
 />
 </div>
 </div>

 {/* Pages */}
 <div>
 <div className="flex items-center justify-between mb-2">
 <label className="text-[13px] font-black text-txt dark:text-white">
 Nội dung ({editing.pages.length} trang)
 </label>
 <button
 onClick={addPage}
 className="px-3 py-1 rounded-lg bg-accent/10 text-accent text-[12px] font-bold flex items-center gap-1"
 >
 <Plus size={12} /> Thêm trang
 </button>
 </div>
 {editing.pages.map((page, idx) => (
 <div key={idx} className="bg-white dark:bg-white/[0.04] rounded-2xl p-3 mb-2 border border-gray-100 dark:border-white/[0.06]">
 <div className="flex items-center justify-between mb-1.5">
 <span className="text-[11px] font-black text-accent">Trang {idx + 1}</span>
 {editing.pages.length > 1 && (
 <button
 onClick={() => removePage(idx)}
 className="text-red-400 hover:text-red-600"
 >
 <Trash2 size={13} />
 </button>
 )}
 </div>
 <textarea
 value={page.content}
 onChange={(e) => updatePage(idx, "content", e.target.value)}
 placeholder="Nội dung trang..."
 rows={3}
 className="w-full px-2.5 py-2 rounded-xl border border-gray-200 dark:border-white/10 text-sm mb-1.5 resize-none"
 />
 <input
 value={page.scene_description || ""}
 onChange={(e) => updatePage(idx, "scene_description", e.target.value)}
 placeholder="Mô tả bối cảnh (cho hình minh hoạ)"
 className="w-full px-2.5 py-1.5 rounded-lg border border-gray-100 dark:border-white/[0.06] text-[12px] text-txt-secondary dark:text-white/50"
 />
 </div>
 ))}
 </div>
 </div>
 </div>
 );
 }

 return (
 <div className="min-h-screen bg-surface dark:bg-[#0A0A0F] pb-28">
 <TopBar
 title="Mẫu truyện"
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
 {/* Search */}
 <div className="bg-white dark:bg-white/[0.04] rounded-[14px] px-4 py-3 flex items-center gap-2.5 shadow-[0_1px_3px_rgba(0,0,0,0.04)] dark:shadow-none mb-3">
 <Search size={18} className="text-gray-400 dark:text-white/30" />
 <input
 value={search}
 onChange={(e) => setSearch(e.target.value)}
 placeholder="Tìm mẫu truyện..."
 className="flex-1 text-sm outline-none bg-transparent"
 />
 </div>

 {/* Category filter */}
 <div className="flex gap-1.5 overflow-x-auto no-scrollbar mb-3">
 <button
 onClick={() => setCatFilter("all")}
 className={`px-3 py-1.5 rounded-full text-[11px] font-bold whitespace-nowrap ${
 catFilter === "all" ? "bg-accent text-white" : "bg-white dark:bg-white/[0.04] text-txt-secondary dark:text-white/50"
 }`}
 >
 Tất cả ({templates.length})
 </button>
 {categories.map((c) => {
 const count = templates.filter((t) => t.category === c.id).length;
 if (count === 0) return null;
 return (
 <button
 key={c.id}
 onClick={() => setCatFilter(c.id)}
 className={`px-3 py-1.5 rounded-full text-[11px] font-bold whitespace-nowrap ${
 catFilter === c.id ? "bg-accent text-white" : "bg-white dark:bg-white/[0.04] text-txt-secondary dark:text-white/50"
 }`}
 >
 {c.emoji} {c.label} ({count})
 </button>
 );
 })}
 </div>

 {loading ? (
 <div className="flex justify-center pt-16">
 <Loader2 size={24} className="animate-spin text-accent" />
 </div>
 ) : filtered.length === 0 ? (
 <div className="text-center py-12 text-[13px] text-txt-secondary dark:text-white/50">
 Không tìm thấy mẫu truyện nào
 </div>
 ) : (
 <div className="space-y-2">
 {filtered.map((tpl) => (
 <div
 key={tpl.id}
 className={`bg-white dark:bg-white/[0.04] rounded-2xl p-3 shadow-[0_1px_3px_rgba(0,0,0,0.04)] dark:shadow-none ${
 !tpl.is_active ? "opacity-50" : ""
 }`}
 >
 <div className="flex items-start gap-2.5">
 <span className="text-2xl shrink-0 pt-0.5">{tpl.emoji || catEmoji(tpl.category)}</span>
 <div className="flex-1 min-w-0">
 <p className="text-[13px] font-bold text-txt dark:text-white">{tpl.title}</p>
 {tpl.description && (
 <p className="text-[11px] text-txt-secondary dark:text-white/50 mt-0.5 line-clamp-1">{tpl.description}</p>
 )}
 <div className="flex items-center gap-1.5 mt-1 flex-wrap">
 <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-accent/10 text-accent">
 {catLabel(tpl.category)}
 </span>
 <span className="text-[10px] text-txt-secondary dark:text-white/50">
 {tpl.pages?.length || 0} trang
 </span>
 <span className="text-[10px] text-txt-secondary dark:text-white/50">
 · {tpl.age_min ?? 0}-{tpl.age_max ?? 12} tuổi
 </span>
 </div>
 </div>
 </div>

 {/* Actions */}
 <div className="flex gap-1.5 mt-2.5">
 <button
 onClick={() => startEdit(tpl)}
 className="flex-1 py-1.5 rounded-lg bg-gray-100 dark:bg-white/[0.06] text-txt dark:text-white text-[12px] font-bold flex items-center justify-center gap-1"
 >
 <Pencil size={12} /> Sửa
 </button>
 <button
 onClick={() => duplicate(tpl)}
 className="py-1.5 px-2.5 rounded-lg bg-violet-50 text-violet-600 text-[12px] font-bold flex items-center justify-center"
 title="Nhân bản"
 >
 <Copy size={12} />
 </button>
 <button
 onClick={() => handleToggle(tpl)}
 className={`py-1.5 px-2.5 rounded-lg text-[12px] font-bold flex items-center justify-center ${
 tpl.is_active ? "bg-emerald-50 text-emerald-600" : "bg-gray-100 dark:bg-white/[0.06] text-gray-400 dark:text-white/30"
 }`}
 title={tpl.is_active ? "Ẩn" : "Hiện"}
 >
 {tpl.is_active ? <Eye size={12} /> : <EyeOff size={12} />}
 </button>
 <button
 onClick={() => setDeleteConfirm(tpl.id)}
 className="py-1.5 px-2.5 rounded-lg bg-red-50 text-red-600 text-[12px] font-bold flex items-center justify-center"
 >
 <Trash2 size={12} />
 </button>
 </div>

 {/* Delete confirm */}
 {deleteConfirm === tpl.id && (
 <div className="mt-2 p-2.5 bg-red-50 rounded-xl flex items-center gap-2">
 <span className="text-[12px] text-red-600 font-medium flex-1">
 Xoá &quot;{tpl.title}&quot;?
 </span>
 <button
 onClick={() => handleDelete(tpl.id)}
 disabled={saving}
 className="px-3 py-1 rounded-lg bg-red-500 text-white text-[12px] font-bold"
 >
 Xoá
 </button>
 <button
 onClick={() => setDeleteConfirm(null)}
 className="px-2 py-1 text-gray-500 dark:text-white/40 text-[12px] font-bold"
 >
 Huỷ
 </button>
 </div>
 )}
 </div>
 ))}
 </div>
 )}
 </div>
 </div>
 );
}
