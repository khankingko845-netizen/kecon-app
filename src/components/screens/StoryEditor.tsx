"use client";

import { useState, useEffect, useCallback } from "react";
import {
 Plus, Trash2, ChevronUp, ChevronDown, Save, Loader2,
 Image as ImageIcon, Globe, FileText, Check, Sparkles, GitBranch, X,
 Headphones, Volume2, Users, Mic, Search,
} from "lucide-react";
import TopBar from "@/components/ui/TopBar";
import ExpertPanel from "@/components/ui/ExpertPanel";
import { AMBIENT_CATEGORIES, matchAmbientCategory } from "@/lib/ambient-sounds";
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
 type StoryCharacterRow,
 getStoryCharacters,
 addStoryCharacter,
 updateStoryCharacter,
 deleteStoryCharacter,
 updateStoryNarrator,
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
 const { settings, hasElevenLabs } = useSettings();
 const { refreshStories, voiceProfiles } = useData();
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

 // Character management
 const [characters, setCharacters] = useState<StoryCharacterRow[]>([]);
 const [showCharacters, setShowCharacters] = useState(false);
 const [addingChar, setAddingChar] = useState(false);
 const [newCharName, setNewCharName] = useState("");
 const [newCharEmoji, setNewCharEmoji] = useState("");
 const [newCharVoiceId, setNewCharVoiceId] = useState("");
 const [newCharVoiceName, setNewCharVoiceName] = useState("");
 const [newCharColor, setNewCharColor] = useState("#6B7280");
 const [lookupLoading, setLookupLoading] = useState(false);

 // Default voices for voice picker
 const [defaultVoices, setDefaultVoices] = useState<{ id: string; voice_id: string; name: string; language: string }[]>([]);

 const CHARACTER_COLORS = ["#EF4444", "#F59E0B", "#10B981", "#3B82F6", "#8B5CF6", "#EC4899", "#6B7280", "#0EA5E9"];

 useEffect(() => {
 if (!storyId) {
 setLoading(false);
 return;
 }
 let active = true;
 Promise.all([getStory(storyId), getStoryPages(storyId), getStoryCharacters(storyId)])
 .then(([s, p, c]) => {
 if (!active) return;
 setStory(s);
 setTitle(s?.title ?? "");
 setCategory(s?.category ?? "custom");
 setDescription(s?.description ?? "");
 setAgeMin(s?.target_age_min ?? 3);
 setAgeMax(s?.target_age_max ?? 8);
 setPages(p);
 setCharacters(c);
 })
 .catch((e) => setError(e instanceof Error ? e.message : "Lỗi tải truyện"))
 .finally(() => active && setLoading(false));
 return () => {
 active = false;
 };
 }, [storyId]);

 // Fetch default voices for voice picker
 useEffect(() => {
 fetch("/api/voice/defaults")
 .then((r) => r.json())
 .then((data) => { if (data.voices) setDefaultVoices(data.voices); })
 .catch(() => {});
 }, []);

 const storyLocale = story?.locale || "vi";

 const handleAddCharacter = async () => {
 if (!storyId || !newCharName.trim()) return;
 try {
 const char = await addStoryCharacter({
 storyId,
 name: newCharName.trim(),
 voiceId: newCharVoiceId || undefined,
 voiceName: newCharVoiceName || undefined,
 emoji: newCharEmoji || undefined,
 color: newCharColor,
 });
 setCharacters((prev) => [...prev, char]);
 setNewCharName("");
 setNewCharEmoji("");
 setNewCharVoiceId("");
 setNewCharVoiceName("");
 setNewCharColor("#6B7280");
 setAddingChar(false);
 } catch (e) {
 setError(e instanceof Error ? e.message : "Lỗi thêm nhân vật");
 }
 };

 const handleDeleteCharacter = async (id: string) => {
 try {
 await deleteStoryCharacter(id);
 setCharacters((prev) => prev.filter((c) => c.id !== id));
 } catch (e) {
 setError(e instanceof Error ? e.message : "Lỗi xóa nhân vật");
 }
 };

 const handleCharVoiceChange = async (charId: string, voiceId: string, voiceName: string) => {
 try {
 await updateStoryCharacter(charId, { voice_id: voiceId, voice_name: voiceName });
 setCharacters((prev) =>
 prev.map((c) => (c.id === charId ? { ...c, voice_id: voiceId, voice_name: voiceName } : c))
 );
 } catch (e) {
 setError(e instanceof Error ? e.message : "Lỗi cập nhật giọng");
 }
 };

 const handleNarratorChange = async (voiceId: string, voiceName: string) => {
 if (!storyId) return;
 try {
 await updateStoryNarrator(storyId, voiceId || null, voiceName || null);
 setStory((prev) => prev ? { ...prev, narrator_voice_id: voiceId || null, narrator_voice_name: voiceName || null } : prev);
 } catch (e) {
 setError(e instanceof Error ? e.message : "Lỗi cập nhật giọng narrator");
 }
 };

 const lookupVoiceId = async (voiceId: string): Promise<{ name: string } | null> => {
 try {
 setLookupLoading(true);
 const res = await fetch(`/api/admin/test-provider?voice_id=${encodeURIComponent(voiceId)}`);
 const data = await res.json();
 if (data.name) return { name: data.name };
 return null;
 } catch { return null; } finally { setLookupLoading(false); }
 };

 // Insert voice markup at cursor position in a textarea
 const insertMarkup = (pageId: string, speaker: string) => {
 const textarea = document.querySelector(`textarea[data-page-id="${pageId}"]`) as HTMLTextAreaElement;
 if (!textarea) return;
 const start = textarea.selectionStart;
 const end = textarea.selectionEnd;
 const selectedText = textarea.value.substring(start, end);
 const tag = speaker === "narrator"
 ? `[narrator]${selectedText || ""}[/narrator]`
 : `[character:${speaker}]${selectedText || ""}[/character]`;
 const newValue = textarea.value.substring(0, start) + tag + textarea.value.substring(end);
 updatePageLocal(pageId, { content: newValue });
 // Restore cursor position after React re-render
 setTimeout(() => {
 textarea.focus();
 const cursorPos = start + tag.length - (speaker === "narrator" ? "[/narrator]".length : "[/character]".length);
 textarea.setSelectionRange(cursorPos, cursorPos);
 }, 0);
 };

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
 if (!storyId || !hasElevenLabs) {
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
 // Resolve voice: story narrator_voice_id → first default voice for locale → fallback
 const storyNarratorId = story?.narrator_voice_id ?? null;
 let voiceId = storyNarratorId || "pNInz6obpgDQGcFmaJgB";
 if (!storyNarratorId) {
 try {
 const dvRes = await fetch(`/api/voice/defaults?language=${story?.locale || "vi"}`);
 const dvData = await dvRes.json();
 if (dvData.voices?.length > 0) {
 voiceId = dvData.voices[0].voice_id;
 }
 } catch { /* use fallback */ }
 }
 for (let i = 0; i < missing.length; i++) {
 setBatchTTS((prev) => ({ ...prev, current: i + 1 }));
 try {
 const text = missing[i].content;
 if (!text) continue;
 const blob = await ttsApi(
 voiceId,
 text,
 settings.elevenLabsApiKey || undefined,
 settings.elevenLabsModelId || undefined,
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

 // Per-page TTS generation / regeneration
 const [pageGenerating, setPageGenerating] = useState<string | null>(null);

 const handlePageTTS = async (pageId: string, forceRegenerate = false) => {
 if (!storyId || !hasElevenLabs) return;
 const page = pages.find((p) => p.id === pageId);
 if (!page?.content) return;
 if (page.audio_url && !forceRegenerate) return; // Already has audio

 setPageGenerating(pageId);
 try {
 // Resolve voice same as batch TTS
 const storyNarratorId = story?.narrator_voice_id ?? null;
 let voiceId = storyNarratorId || "pNInz6obpgDQGcFmaJgB";
 if (!storyNarratorId) {
 try {
 const dvRes = await fetch(`/api/voice/defaults?language=${story?.locale || "vi"}`);
 const dvData = await dvRes.json();
 if (dvData.voices?.length > 0) voiceId = dvData.voices[0].voice_id;
 } catch { /* use fallback */ }
 }
 const blob = await ttsApi(
 voiceId,
 page.content,
 settings.elevenLabsApiKey || undefined,
 settings.elevenLabsModelId || undefined,
 story?.locale || "vi"
 );
 const audioUrl = await uploadTtsAudio(pageId, blob);
 await savePageAudio(pageId, audioUrl, 0);
 updatePageLocal(pageId, { audio_url: audioUrl });
 } catch {
 setError("Lỗi tạo audio cho trang");
 }
 setPageGenerating(null);
 };

 if (loading) {
 return (
 <div className="min-h-screen bg-white dark:bg-white/[0.04]">
 <TopBar title="Soạn Truyện" onBack={onBack} />
 <div className="flex justify-center pt-20">
 <Loader2 size={26} className="animate-spin text-accent" />
 </div>
 </div>
 );
 }

 if (!story) {
 return (
 <div className="min-h-screen bg-white dark:bg-white/[0.04]">
 <TopBar title="Soạn Truyện" onBack={onBack} />
 <p className="px-5 pt-10 text-center text-txt-secondary dark:text-white/50 text-sm">
 Không tìm thấy truyện.
 </p>
 </div>
 );
 }

 return (
 <div className="min-h-screen bg-surface dark:bg-[#0A0A0F] pb-32">
 <TopBar title="Soạn Truyện" onBack={onBack} />

 <div className="px-5 pt-2">
 <input
 value={title}
 onChange={(e) => setTitle(e.target.value)}
 placeholder="Tiêu đề truyện"
 className="w-full px-4 py-3.5 rounded-xl border-[1.5px] border-gray-200 dark:border-white/10 bg-white dark:bg-white/[0.04] text-[17px] font-bold text-txt dark:text-white outline-none focus:border-accent transition-colors mb-2"
 />

 {/* Metadata (collapsible) */}
 <button
 onClick={() => setShowMeta((v) => !v)}
 className="w-full flex items-center justify-between px-4 py-2.5 rounded-xl bg-white dark:bg-white/[0.04] border border-gray-100 dark:border-white/[0.06] text-[13px] font-bold text-txt-secondary dark:text-white/50 mb-2"
 >
 <span>Chi tiết truyện</span>
 {showMeta ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
 </button>
 {showMeta && (
 <div className="bg-white dark:bg-white/[0.04] rounded-xl border border-gray-100 dark:border-white/[0.06] p-3.5 mb-2 space-y-3">
 <div>
 <label className="text-[12px] font-bold text-txt-secondary dark:text-white/50 block mb-1.5">Thể loại</label>
 <div className="flex flex-wrap gap-1.5">
 {CATEGORY_OPTIONS.map((c) => (
 <button
 key={c.id}
 onClick={() => setCategory(c.id)}
 className={`px-2.5 py-1.5 rounded-lg text-[12px] font-bold ${
 category === c.id
 ? "bg-accent text-white"
 : "bg-gray-100 dark:bg-white/[0.06] text-txt-secondary dark:text-white/50"
 }`}
 >
 {c.label}
 </button>
 ))}
 </div>
 </div>
 <div>
 <label className="text-[12px] font-bold text-txt-secondary dark:text-white/50 block mb-1.5">Mô tả ngắn</label>
 <textarea
 value={description}
 onChange={(e) => setDescription(e.target.value)}
 placeholder="Tóm tắt nội dung truyện..."
 rows={2}
 className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-white/10 text-[13px] outline-none focus:border-accent resize-none"
 />
 </div>
 <div className="flex gap-3">
 <div className="flex-1">
 <label className="text-[12px] font-bold text-txt-secondary dark:text-white/50 block mb-1.5">Tuổi từ</label>
 <input
 type="number"
 min={0}
 max={18}
 value={ageMin}
 onChange={(e) => setAgeMin(Number(e.target.value))}
 className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-white/10 text-[13px] outline-none focus:border-accent"
 />
 </div>
 <div className="flex-1">
 <label className="text-[12px] font-bold text-txt-secondary dark:text-white/50 block mb-1.5">Tuổi đến</label>
 <input
 type="number"
 min={0}
 max={18}
 value={ageMax}
 onChange={(e) => setAgeMax(Number(e.target.value))}
 className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-white/10 text-[13px] outline-none focus:border-accent"
 />
 </div>
 </div>
 </div>
 )}

 {/* Characters (collapsible) */}
 <button
 onClick={() => setShowCharacters((v) => !v)}
 className="w-full flex items-center justify-between px-4 py-2.5 rounded-xl bg-white dark:bg-white/[0.04] border border-gray-100 dark:border-white/[0.06] text-[13px] font-bold text-txt-secondary dark:text-white/50 mb-2"
 >
 <span className="flex items-center gap-1.5">
 <Users size={14} className="text-violet-600" /> Nhân vật & Giọng đọc
 {characters.length > 0 && (
 <span className="text-[10px] bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded-full">
 {characters.length}
 </span>
 )}
 </span>
 {showCharacters ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
 </button>
 {showCharacters && (
 <div className="bg-white dark:bg-white/[0.04] rounded-xl border border-gray-100 dark:border-white/[0.06] p-3.5 mb-2 space-y-3">
 {/* Narrator voice */}
 <div>
 <label className="text-[12px] font-bold text-txt-secondary dark:text-white/50 block mb-1.5 flex items-center gap-1">
 <Mic size={12} className="text-accent" /> Giọng Người Kể (Narrator)
 </label>
 <select
  value={story?.narrator_voice_id || ""}
  onChange={(e) => {
   const vp = voiceProfiles.find((p) => p.elevenlabs_voice_id === e.target.value);
   const dv = defaultVoices.find((d) => d.voice_id === e.target.value);
   handleNarratorChange(e.target.value, vp?.name || dv?.name || "");
  }}
  className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-white/10 text-[12px] outline-none focus:border-accent dark:bg-[#0A0A0F] dark:text-white"
 >
  <option value="">— Mặc định (theo ngôn ngữ) —</option>
  {voiceProfiles.filter((p) => p.elevenlabs_voice_id && p.is_active).length > 0 && (
   <optgroup label="🏠 Giọng gia đình">
    {voiceProfiles
     .filter((p) => p.elevenlabs_voice_id && p.is_active)
     .map((p) => (
      <option key={p.id} value={p.elevenlabs_voice_id!}>
       🏠 {p.name} ({p.relation})
      </option>
     ))}
   </optgroup>
  )}
  {defaultVoices.filter((v) => v.language === storyLocale).length > 0 && (
   <optgroup label="⭐ Giọng mặc định">
    {defaultVoices
     .filter((v) => v.language === storyLocale)
     .map((v) => (
      <option key={v.id} value={v.voice_id}>
       ⭐ {v.name}
      </option>
     ))}
   </optgroup>
  )}
  {defaultVoices
   .filter((v) => v.language !== storyLocale)
   .map((v) => (
    <option key={v.id} value={v.voice_id}>
     {v.name} ({v.language})
    </option>
   ))}
 </select>
 </div>

 {/* Characters list */}
 {characters.map((c) => (
 <div key={c.id} className="flex items-center gap-2 p-2 rounded-lg bg-surface dark:bg-white/[0.04] border border-gray-100 dark:border-white/[0.06]">
 <span className="text-lg shrink-0">{c.emoji || "👤"}</span>
 <div className="flex-1 min-w-0">
 <div className="text-[12px] font-bold text-txt dark:text-white truncate">{c.name}</div>
 <div className="text-[10px] text-txt-secondary dark:text-white/50 truncate">
 {c.voice_name || "Chưa gắn giọng"}
 </div>
 </div>
 <div className="w-4 h-4 rounded-full shrink-0" style={{ backgroundColor: c.color }} />
 <select
  value={c.voice_id || ""}
  onChange={(e) => {
   const vp = voiceProfiles.find((p) => p.elevenlabs_voice_id === e.target.value);
   const dv = defaultVoices.find((d) => d.voice_id === e.target.value);
   handleCharVoiceChange(c.id, e.target.value, vp?.name || dv?.name || "");
  }}
  className="w-28 px-1.5 py-1 rounded-lg border border-gray-200 dark:border-white/10 text-[10px] outline-none dark:bg-[#0A0A0F] dark:text-white"
 >
  <option value="">— Giọng —</option>
  {voiceProfiles
   .filter((p) => p.elevenlabs_voice_id && p.is_active)
   .map((p) => (
    <option key={p.id} value={p.elevenlabs_voice_id!}>🏠 {p.name}</option>
   ))}
  {defaultVoices
   .filter((v) => v.language === storyLocale)
   .map((v) => (
    <option key={v.id} value={v.voice_id}>⭐ {v.name}</option>
   ))}
 </select>
 <button
 onClick={() => handleDeleteCharacter(c.id)}
 className="w-6 h-6 rounded-lg bg-red-50 flex items-center justify-center text-red-500 shrink-0"
 >
 <Trash2 size={12} />
 </button>
 </div>
 ))}

 {/* Add character form */}
 {addingChar ? (
 <div className="space-y-2 p-2.5 rounded-lg bg-violet-50 border border-violet-100">
 <div className="flex gap-2">
 <input
 value={newCharEmoji}
 onChange={(e) => setNewCharEmoji(e.target.value)}
 placeholder="🐿️"
 className="w-12 px-2 py-1.5 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-white/[0.04] text-center text-[14px] outline-none focus:border-accent"
 />
 <input
 value={newCharName}
 onChange={(e) => setNewCharName(e.target.value)}
 placeholder="Tên nhân vật"
 className="flex-1 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-white/[0.04] text-[12px] outline-none focus:border-accent"
 />
 </div>
 <div className="flex items-center gap-1.5">
 <input
 value={newCharVoiceId}
 onChange={(e) => setNewCharVoiceId(e.target.value)}
 placeholder="Voice ID hoặc chọn bên dưới"
 className="flex-1 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-white/[0.04] text-[11px] outline-none focus:border-accent"
 />
 <button
 onClick={async () => {
 if (!newCharVoiceId) return;
 const result = await lookupVoiceId(newCharVoiceId);
 if (result) setNewCharVoiceName(result.name);
 }}
 disabled={lookupLoading || !newCharVoiceId}
 className="w-7 h-7 rounded-lg bg-accent/10 flex items-center justify-center text-accent disabled:opacity-30"
 >
 {lookupLoading ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
 </button>
 </div>
 {newCharVoiceName && (
 <p className="text-[10px] text-emerald-600 font-medium">✓ {newCharVoiceName}</p>
 )}
 <select
 value={newCharVoiceId}
 onChange={(e) => {
 const v = defaultVoices.find((d) => d.voice_id === e.target.value);
 setNewCharVoiceId(e.target.value);
 setNewCharVoiceName(v?.name || "");
 }}
 className="w-full px-3 py-1.5 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-white/[0.04] text-[11px] outline-none focus:border-accent"
 >
 <option value="">— Chọn giọng mặc định —</option>
 {defaultVoices
 .filter((v) => v.language === storyLocale)
 .map((v) => (
 <option key={v.id} value={v.voice_id}>⭐ {v.name}</option>
 ))}
 </select>
 <div className="flex gap-1.5 items-center">
 <span className="text-[10px] text-txt-secondary dark:text-white/50 font-medium">Màu:</span>
 {CHARACTER_COLORS.map((color) => (
 <button
 key={color}
 onClick={() => setNewCharColor(color)}
 className={`w-5 h-5 rounded-full border-2 transition-all ${
 newCharColor === color ? "border-txt scale-110" : "border-transparent"
 }`}
 style={{ backgroundColor: color }}
 />
 ))}
 </div>
 <div className="flex gap-2 mt-1">
 <button
 onClick={handleAddCharacter}
 disabled={!newCharName.trim()}
 className="flex-1 py-1.5 rounded-lg bg-violet-600 text-white text-[12px] font-bold disabled:opacity-50"
 >
 Thêm
 </button>
 <button
 onClick={() => setAddingChar(false)}
 className="flex-1 py-1.5 rounded-lg bg-gray-200 dark:bg-white/[0.08] text-txt-secondary dark:text-white/50 text-[12px] font-bold"
 >
 Hủy
 </button>
 </div>
 </div>
 ) : (
 <button
 onClick={() => setAddingChar(true)}
 className="w-full py-2 rounded-lg border border-dashed border-violet-300 text-[12px] font-bold text-violet-600 flex items-center justify-center gap-1"
 >
 <Plus size={14} /> Thêm nhân vật
 </button>
 )}
 </div>
 )}

 <div className="flex items-center gap-2 mb-4">
 <span className="text-[11px] font-bold px-2.5 py-1 rounded-md bg-gray-100 dark:bg-white/[0.06] text-txt-secondary dark:text-white/50">
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
 className="bg-white dark:bg-white/[0.04] rounded-2xl border border-gray-100 dark:border-white/[0.06] p-3.5 shadow-[0_1px_3px_rgba(0,0,0,0.03)]"
 >
 <div className="flex items-center justify-between mb-2">
 <span className="text-[13px] font-black text-accent">
 Trang {i + 1}
 </span>
 <div className="flex items-center gap-1">
 <button
 onClick={() => movePage(i, -1)}
 disabled={i === 0}
 className="w-7 h-7 rounded-lg bg-gray-50 dark:bg-white/[0.04] flex items-center justify-center text-gray-500 dark:text-white/40 disabled:opacity-30"
 >
 <ChevronUp size={16} />
 </button>
 <button
 onClick={() => movePage(i, 1)}
 disabled={i === pages.length - 1}
 className="w-7 h-7 rounded-lg bg-gray-50 dark:bg-white/[0.04] flex items-center justify-center text-gray-500 dark:text-white/40 disabled:opacity-30"
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

 {/* Markdown toolbar */}
 <div className="flex items-center gap-0.5 mb-1">
 {[
 { label: "B", wrap: "**", title: "In đậm" },
 { label: "I", wrap: "*", title: "In nghiêng" },
 { label: "—", wrap: "\n---\n", title: "Ngắt cảnh", single: true },
 { label: "❝", wrap: "> ", title: "Trích dẫn", prefix: true },
 ].map((btn) => (
 <button
 key={btn.label}
 title={btn.title}
 onClick={() => {
 const ta = document.querySelector(`textarea[data-page-id="${page.id}"]`) as HTMLTextAreaElement;
 if (!ta) return;
 const start = ta.selectionStart;
 const end = ta.selectionEnd;
 const sel = ta.value.substring(start, end);
 let newVal: string;
 let cursor: number;
 if (btn.single) {
 newVal = ta.value.substring(0, start) + btn.wrap + ta.value.substring(end);
 cursor = start + btn.wrap.length;
 } else if (btn.prefix) {
 newVal = ta.value.substring(0, start) + btn.wrap + sel + ta.value.substring(end);
 cursor = start + btn.wrap.length + sel.length;
 } else {
 newVal = ta.value.substring(0, start) + btn.wrap + sel + btn.wrap + ta.value.substring(end);
 cursor = start + btn.wrap.length + sel.length + btn.wrap.length;
 }
 updatePageLocal(page.id, { content: newVal });
 requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(cursor, cursor); });
 }}
 className="w-7 h-7 rounded-md text-[12px] font-black text-txt-secondary dark:text-white/50 bg-gray-50 dark:bg-white/[0.04] border border-gray-200 dark:border-white/10 hover:bg-gray-100 dark:bg-white/[0.06] transition-colors flex items-center justify-center"
 >
 {btn.label}
 </button>
 ))}
 </div>

 <textarea
 data-page-id={page.id}
 value={page.content}
 onChange={(e) => updatePageLocal(page.id, { content: e.target.value })}
 placeholder="Nội dung trang... Dùng **đậm**, *nghiêng*, --- ngắt cảnh"
 className="w-full px-3 py-2.5 rounded-xl border-[1.5px] border-gray-200 dark:border-white/10 bg-surface dark:bg-white/[0.04] text-[14px] text-txt dark:text-white outline-none focus:border-accent transition-colors resize-none h-24 mb-1 font-mono"
 />
 {/* Voice markup toolbar */}
 {characters.length > 0 && (
 <div className="flex flex-wrap gap-1 mb-2">
 <button
 onClick={() => insertMarkup(page.id, "narrator")}
 className="px-2 py-1 rounded-lg text-[10px] font-bold bg-gray-100 dark:bg-white/[0.06] text-gray-600 dark:text-white/50 hover:bg-gray-200 dark:bg-white/[0.08] transition-colors"
 >
 🎤 Người kể
 </button>
 {characters.map((c) => (
 <button
 key={c.id}
 onClick={() => insertMarkup(page.id, c.name)}
 className="px-2 py-1 rounded-lg text-[10px] font-bold text-white hover:opacity-80 transition-opacity"
 style={{ backgroundColor: c.color }}
 >
 {c.emoji || "👤"} {c.name}
 </button>
 ))}
 </div>
 )}
 <input
 value={page.scene_description ?? ""}
 onChange={(e) => updatePageLocal(page.id, { scene_description: e.target.value })}
 placeholder="Mô tả cảnh (cho minh hoạ AI)..."
 className="w-full px-3 py-2.5 rounded-xl border-[1.5px] border-gray-200 dark:border-white/10 bg-surface dark:bg-white/[0.04] text-[12px] text-txt-secondary dark:text-white/50 outline-none focus:border-accent transition-colors mb-2"
 />

 {/* Visual effect for this page */}
 <label className="text-[11px] font-bold text-txt-secondary dark:text-white/50 mb-1.5 flex items-center gap-1">
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
 className="w-full px-3 py-2 rounded-xl border-[1.5px] border-gray-200 dark:border-white/10 bg-surface dark:bg-white/[0.04] text-[12px] text-txt dark:text-white outline-none focus:border-accent transition-colors mb-3"
 >
 <option value={EFFECT_NONE}>Tự động theo cảnh</option>
 {(Object.keys(EFFECT_LABELS) as EffectType[]).map((t) => (
 <option key={t} value={t}>
 {EFFECT_LABELS[t]}
 </option>
 ))}
 </select>

 {/* Ambient Sound */}
 <label className="text-[11px] font-bold text-txt-secondary dark:text-white/50 mb-1.5 flex items-center gap-1">
 🔊 Âm thanh nền
 </label>
 <div className="flex flex-wrap gap-1 mb-3">
 <button
 onClick={() => updatePageLocal(page.id, { ambient_sound: null })}
 className={`px-2 py-1 rounded-lg text-[10px] font-bold border transition-colors ${
 !page.ambient_sound
 ? "border-accent bg-orange-50 text-accent"
 : "border-gray-200 dark:border-white/10 bg-white dark:bg-white/[0.04] text-txt-secondary dark:text-white/50"
 }`}
 >
 🤖 Tự động
 </button>
 {AMBIENT_CATEGORIES.map((cat) => (
 <button
 key={cat.id}
 onClick={() => updatePageLocal(page.id, { ambient_sound: cat.id })}
 className={`px-2 py-1 rounded-lg text-[10px] font-bold border transition-colors ${
 page.ambient_sound === cat.id
 ? "border-accent bg-orange-50 text-accent"
 : "border-gray-200 dark:border-white/10 bg-white dark:bg-white/[0.04] text-txt-secondary dark:text-white/50"
 }`}
 >
 {cat.emoji} {cat.label}
 </button>
 ))}
 </div>

 {/* Branching choices for this page */}
 <div className="mb-2 rounded-xl bg-surface dark:bg-white/[0.04] border border-gray-100 dark:border-white/[0.06] p-2.5">
 <div className="flex items-center justify-between mb-1.5">
 <span className="text-[11px] font-bold text-txt-secondary dark:text-white/50 flex items-center gap-1">
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
 <p className="text-[11px] text-txt-secondary dark:text-white/50/60">
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
 className="flex-1 px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-white/[0.04] text-[12px] text-txt dark:text-white outline-none focus:border-accent"
 />
 <select
 value={choice.target}
 onChange={(e) =>
 updateChoice(page, ci, {
 target: Number(e.target.value),
 })
 }
 className="px-2 py-1.5 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-white/[0.04] text-[12px] text-txt dark:text-white outline-none focus:border-accent"
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

 {/* Per-page TTS generate / regenerate */}
 {hasElevenLabs && (
 <div className="inline-flex items-center gap-1.5 ml-2">
 <button
 onClick={() => handlePageTTS(page.id, !page.audio_url)}
 disabled={pageGenerating === page.id}
 className={`inline-flex items-center gap-1.5 text-[12px] font-bold px-3 py-1.5 rounded-lg disabled:opacity-50 ${
 page.audio_url
 ? "text-emerald-700 bg-emerald-50"
 : "text-violet-700 bg-violet-50"
 }`}
 >
 {pageGenerating === page.id ? (
 <Loader2 size={13} className="animate-spin" />
 ) : (
 <Volume2 size={13} />
 )}
 {page.audio_url ? "✓ Có audio" : "Tạo audio"}
 </button>
 {page.audio_url && (
 <button
 onClick={() => handlePageTTS(page.id, true)}
 disabled={pageGenerating === page.id}
 className="inline-flex items-center gap-1 text-[11px] font-bold text-orange-600 px-2 py-1.5 rounded-lg bg-orange-50 disabled:opacity-50"
 >
 {pageGenerating === page.id ? (
 <Loader2 size={11} className="animate-spin" />
 ) : (
 <Headphones size={11} />
 )}
 Tạo lại
 </button>
 )}
 </div>
 )}
 </div>
 ))}
 </div>

 <button
 onClick={handleAddPage}
 className="w-full mt-3 py-3.5 rounded-2xl border-2 border-dashed border-gray-300 dark:border-white/15 text-[14px] font-bold text-txt-secondary dark:text-white/50 flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
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
 <p className="text-[11px] text-txt-secondary dark:text-white/50 text-center mt-1 mb-2">
 Tự động tạo TTS cho các trang chưa có audio (cần ElevenLabs API Key)
 </p>

 {/* AI Expert Panel */}
 <ExpertPanel
 storyContent={pages.map((p, i) => `Trang ${i + 1}: ${p.content}`).join("\n\n")}
 storyTitle={story?.title}
 targetAge={story?.target_age_min ? `${story.target_age_min}-${story.target_age_max}` : "4-6"}
 language={story?.locale || "vi"}
 />

 <div className="flex gap-2 mt-2">
 <button
 onClick={() => onNavigate("player", { storyId: story.id })}
 className="flex-1 py-3.5 rounded-2xl bg-gray-100 dark:bg-white/[0.06] text-[14px] font-bold text-txt dark:text-white flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
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
