"use client";

import { useState, useRef, useCallback } from "react";
import { Plus, User, UserRound, Trash2, Loader2, Mic, Pencil, Check, X, Volume2, Square } from "lucide-react";
import { useData } from "@/lib/data-context";
import { deleteVoiceProfile, updateVoiceProfile, gradientFor } from "@/lib/db";
import { useSettings } from "@/lib/settings-context";
import type { Screen } from "@/lib/types";

interface VoiceProfilesProps {
 onNavigate: (screen: Screen) => void;
}

function relationLabel(relation: string): string {
 const map: Record<string, string> = {
 parent: "Bố/Mẹ",
 mother: "Mẹ",
 father: "Bố",
 grandparent: "Ông/Bà",
 other: "Khác",
 };
 return map[relation] || relation;
}

export default function VoiceProfiles({ onNavigate }: VoiceProfilesProps) {
 const { voiceProfiles, loading, refreshVoices } = useData();
 const { settings } = useSettings();
 const [deletingId, setDeletingId] = useState<string | null>(null);

 // Edit name state
 const [editingId, setEditingId] = useState<string | null>(null);
 const [editName, setEditName] = useState("");
 const [savingEdit, setSavingEdit] = useState(false);

 // Voice preview state
 const [playingId, setPlayingId] = useState<string | null>(null);
 const [loadingPreview, setLoadingPreview] = useState<string | null>(null);
 const previewRef = useRef<HTMLAudioElement | null>(null);

 const handleDelete = async (id: string) => {
 setDeletingId(id);
 try {
 await deleteVoiceProfile(id);
 await refreshVoices();
 } finally {
 setDeletingId(null);
 }
 };

 const startEdit = (id: string, currentName: string) => {
 setEditingId(id);
 setEditName(currentName);
 };

 const cancelEdit = () => {
 setEditingId(null);
 setEditName("");
 };

 const saveEdit = async () => {
 if (!editingId || !editName.trim()) return;
 setSavingEdit(true);
 try {
 await updateVoiceProfile(editingId, { name: editName.trim() });
 await refreshVoices();
 setEditingId(null);
 setEditName("");
 } finally {
 setSavingEdit(false);
 }
 };

 const playPreview = useCallback(async (voiceId: string, elevenLabsId: string) => {
 // Toggle off
 if (playingId === voiceId && previewRef.current) {
 previewRef.current.pause();
 previewRef.current = null;
 setPlayingId(null);
 return;
 }
 // Stop current
 if (previewRef.current) {
 previewRef.current.pause();
 previewRef.current = null;
 }

 setLoadingPreview(voiceId);
 setPlayingId(voiceId);
 try {
 const res = await fetch("/api/voice/tts", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({
 text: "Xin chào! Đây là giọng đọc của tôi. Tôi sẽ kể cho bé nghe những câu chuyện thật hay.",
 voiceId: elevenLabsId,
 apiKey: settings.elevenLabsApiKey || undefined,
 modelId: settings.elevenLabsModelId || undefined,
 }),
 });
 if (!res.ok) throw new Error("TTS failed");
 const blob = await res.blob();
 const url = URL.createObjectURL(blob);
 const audio = new Audio(url);
 previewRef.current = audio;
 audio.onended = () => {
 setPlayingId(null);
 previewRef.current = null;
 URL.revokeObjectURL(url);
 };
 audio.play();
 } catch {
 setPlayingId(null);
 } finally {
 setLoadingPreview(null);
 }
 }, [playingId, settings.elevenLabsApiKey, settings.elevenLabsModelId]);

 return (
 <div className="min-h-screen bg-surface dark:bg-[#0A0A0F] pb-24">
 <div className="px-5 pt-14">
 <h2 className="text-[28px] font-black tracking-tight mb-0.5">Giọng Nói</h2>
 <p className="text-[13px] text-txt-secondary dark:text-white/50 font-medium">
 Voice profiles gia đình
 </p>
 </div>

 <div className="px-5 pt-4 space-y-2.5">
 {loading && voiceProfiles.length === 0 && (
 <div className="flex justify-center py-8">
 <Loader2 size={24} className="animate-spin text-accent" />
 </div>
 )}

 {voiceProfiles.map((v) => {
 const quality = Math.round(v.quality_score);
 const isEditing = editingId === v.id;
 const isPlaying = playingId === v.id;
 const isLoadingPrev = loadingPreview === v.id;

 return (
 <div
 key={v.id}
 className="bg-white dark:bg-white/[0.04] rounded-2xl p-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)] dark:shadow-none"
 >
 <div className="flex items-center gap-3.5">
 <div
 className={`w-[50px] h-[50px] rounded-2xl bg-gradient-to-br ${gradientFor(v.id)} flex items-center justify-center text-white shrink-0`}
 >
 {v.gender === "female" ? <UserRound size={24} /> : <User size={24} />}
 </div>
 <div className="flex-1 min-w-0">
 {isEditing ? (
 <div className="flex items-center gap-1.5 mb-1">
 <input
 type="text"
 value={editName}
 onChange={(e) => setEditName(e.target.value)}
 onKeyDown={(e) => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") cancelEdit(); }}
 autoFocus
 className="flex-1 px-2 py-1 text-base font-bold rounded-lg border border-accent outline-none min-w-0"
 />
 <button
 onClick={saveEdit}
 disabled={savingEdit || !editName.trim()}
 className="w-7 h-7 rounded-lg bg-emerald-500 text-white flex items-center justify-center shrink-0"
 >
 {savingEdit ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
 </button>
 <button
 onClick={cancelEdit}
 className="w-7 h-7 rounded-lg bg-gray-200 dark:bg-white/[0.08] text-gray-600 dark:text-white/50 flex items-center justify-center shrink-0"
 >
 <X size={14} />
 </button>
 </div>
 ) : (
 <div className="flex items-center gap-1.5 mb-0.5">
 <h5 className="text-base font-bold truncate">{v.name}</h5>
 <button
 onClick={() => startEdit(v.id, v.name)}
 className="w-6 h-6 rounded-md hover:bg-gray-100 dark:bg-white/[0.06] flex items-center justify-center text-gray-400 dark:text-white/30 shrink-0"
 title="Sửa tên"
 >
 <Pencil size={12} />
 </button>
 </div>
 )}
 <p className="text-[11px] text-txt-secondary dark:text-white/50 mb-1.5">
 {relationLabel(v.relation)}
 {v.elevenlabs_voice_id ? " · Đã clone" : " · Chưa clone"}
 </p>
 <div className="flex items-center gap-2">
 <div className="flex-1 h-1 bg-gray-200 dark:bg-white/[0.08] rounded-full overflow-hidden">
 <div
 className="h-full rounded-full"
 style={{
 width: `${quality}%`,
 background: quality >= 80 ? "#22C55E" : "#FBBF24",
 }}
 />
 </div>
 <span
 className="text-[13px] font-bold"
 style={{ color: quality >= 80 ? "#16A34A" : "#D97706" }}
 >
 {quality}%
 </span>
 </div>
 </div>
 <div className="flex flex-col gap-1.5 shrink-0">
 {v.elevenlabs_voice_id && (
 <button
 onClick={() => playPreview(v.id, v.elevenlabs_voice_id!)}
 disabled={isLoadingPrev}
 className={`w-[38px] h-[38px] rounded-xl border flex items-center justify-center active:scale-95 transition-all ${
 isPlaying
 ? "bg-violet-500 border-violet-500 text-white"
 : "bg-surface dark:bg-white/[0.04] border-gray-200 dark:border-white/10 text-violet-500"
 }`}
 title="Nghe giọng"
 >
 {isLoadingPrev ? (
 <Loader2 size={16} className="animate-spin" />
 ) : isPlaying ? (
 <Square size={16} />
 ) : (
 <Volume2 size={16} />
 )}
 </button>
 )}
 <button
 onClick={() => handleDelete(v.id)}
 disabled={deletingId === v.id}
 className="w-[38px] h-[38px] rounded-xl bg-surface dark:bg-white/[0.04] border border-gray-200 dark:border-white/10 flex items-center justify-center text-red-400 active:scale-95 transition-transform"
 aria-label="Xóa giọng"
 >
 {deletingId === v.id ? (
 <Loader2 size={16} className="animate-spin" />
 ) : (
 <Trash2 size={16} />
 )}
 </button>
 </div>
 </div>
 </div>
 );
 })}

 {!loading && voiceProfiles.length === 0 && (
 <div className="bg-white dark:bg-white/[0.04] rounded-2xl p-6 text-center shadow-[0_1px_3px_rgba(0,0,0,0.04)] dark:shadow-none">
 <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-accent-2/20 to-accent/20 flex items-center justify-center text-accent mx-auto mb-2">
 <Mic size={22} />
 </div>
 <p className="text-[14px] font-bold text-txt dark:text-white mb-0.5">
 Chưa có giọng nào
 </p>
 <p className="text-[12px] text-txt-secondary dark:text-white/50">
 Ghi âm để tạo giọng đọc đầu tiên
 </p>
 </div>
 )}

 {/* Add Voice */}
 <button
 onClick={() => onNavigate("recording")}
 className="w-full border-2 border-dashed border-gray-300 dark:border-white/15 rounded-2xl p-6 text-center active:scale-[0.98] transition-transform"
 >
 <div className="w-11 h-11 rounded-[14px] bg-gray-100 dark:bg-white/[0.06] flex items-center justify-center text-accent mx-auto mb-2">
 <Plus size={20} />
 </div>
 <h5 className="text-[15px] font-bold mb-0.5">Thêm Giọng Nói Mới</h5>
 <p className="text-xs text-txt-secondary dark:text-white/50">
 Ghi âm 30s — 3 phút để tạo voice
 </p>
 </button>
 </div>
 </div>
 );
}
