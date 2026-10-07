"use client";

import { useState, useEffect, useCallback } from "react";
import { User, UserRound, Trash2, Loader2, Mic, Pencil, Check, X } from "@/components/ui/icons";
import VoicePreviewButton from "@/components/ui/VoicePreviewButton";
import NarrationToggle from "@/components/ui/NarrationToggle";
import { useAudioPlayer } from "@/lib/audio-player-context";
import { useVoicePreview } from "@/lib/use-voice-preview";
import Mascot from "@/components/ui/Mascot";
import { GlowDots } from "@/components/ui/states";
import { Bubble, Button3D, CARD_SHADOW, ProgressBar } from "@/components/ui/kit";
import { useData } from "@/lib/data-context";
import { deleteVoiceProfile, updateVoiceProfile, getVoiceProfiles, type VoiceProfileRow, type DefaultVoiceRow } from "@/lib/db";
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
 grandma: "Bà",
 grandpa: "Ông",
 other: "Khác",
 };
 return map[relation] || relation;
}

export default function VoiceProfiles({ onNavigate }: VoiceProfilesProps) {
 const { voiceProfiles, loading, refreshVoices } = useData();
 const [allVoices,setAllVoices]=useState<VoiceProfileRow[]>(voiceProfiles);
 const [defaults,setDefaults]=useState<DefaultVoiceRow[]>([]);
 const [error,setError]=useState<string|null>(null);
 const [toggling,setToggling]=useState<string|null>(null);
 const reloadAll=useCallback(async()=>{setAllVoices(await getVoiceProfiles(true));},[]);
 useEffect(()=>{let alive=true;getVoiceProfiles(true).then(v=>{if(alive)setAllVoices(v);}).catch(()=>{if(alive)setError("Chưa tải được giọng gia đình.");});fetch("/api/voice/defaults").then(r=>r.json()).then(d=>{if(alive)setDefaults(d.voices??[]);}).catch(()=>{if(alive)setError("Chưa tải được giọng của Đóm.");});return()=>{alive=false;};},[]);
 const { settings } = useSettings();
 const preview=useVoicePreview(settings.language);
 const {pause}=useAudioPlayer();
 async function toggleVoice(id:string,active:boolean){
 setToggling(id);setError(null);preview.stop();pause();
 try{await updateVoiceProfile(id,{is_active:active});await Promise.all([refreshVoices(),reloadAll()]);}catch{setError("Chưa đổi được trạng thái giọng. Hãy thử lại.");}finally{setToggling(null);}
 }
 const [deletingId, setDeletingId] = useState<string | null>(null);

 // Edit name state
 const [editingId, setEditingId] = useState<string | null>(null);
 const [editName, setEditName] = useState("");
 const [savingEdit, setSavingEdit] = useState(false);

 const handleDelete = async (id: string) => {
 setDeletingId(id);
 try {
 preview.stop();pause();await deleteVoiceProfile(id);
 await Promise.all([refreshVoices(),reloadAll()]);
 } catch {setError("Chưa xoá được giọng. Hãy thử lại.");} finally {
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
 await Promise.all([refreshVoices(),reloadAll()]);
 setEditingId(null);
 setEditName("");
 } catch {setError("Chưa lưu được tên giọng. Hãy thử lại.");} finally {
 setSavingEdit(false);
 }
 };


 return (
 <div className="min-h-screen bg-cream pb-32">
 <header className="px-5 pt-12">
 <h1 className="font-display text-[30px] font-extrabold leading-tight text-ink">Giọng đọc</h1>
 <p className="text-[15px] font-bold text-ink-2">Giọng kể của cả nhà cho bé</p>
 </header>

 {/* Đóm intro (board: Ghi giọng phụ huynh) */}
 <div className="mx-5 mt-4 flex items-center gap-3 rounded-[24px] bg-brand-soft p-4">
 <Mascot state="listen" size={84} />
 <div className="min-w-0 flex-1">
 <Bubble tail="left" className="text-[15px]">Bé thích nghe giọng ai kể nhất? Bố mẹ ghi giọng để <b className="text-brand-ink">Đóm</b> học nhé!</Bubble>
 </div>
 </div>

 <div className="px-5 pt-4 space-y-3">
 <NarrationToggle />
 <p className="text-[14px] text-ink-2">Công tắc đọc truyện được lưu trên thiết bị này. Nghe thử vẫn hoạt động khi đọc truyện đang tắt.</p>
 {(error||preview.error)&&<p role="alert" className="text-[14px] text-red-700 dark:text-red-300">{error||preview.error}</p>}
 {loading && voiceProfiles.length === 0 && (
 <div className="flex justify-center py-8" role="status" aria-label="Đang tải giọng đọc">
 <GlowDots />
 </div>
 )}

 {allVoices.map((v) => {
 const quality = Math.round(v.quality_score);
 const isEditing = editingId === v.id;


 return (
 <div
 key={v.id}
 className={`bg-white rounded-[24px] p-4 ${CARD_SHADOW}`}
 >
 <div className="flex items-center gap-3.5">
 <div
 className="w-[56px] h-[56px] rounded-[18px] bg-brand-soft flex items-center justify-center text-brand-ink shrink-0"
 >
 {v.gender === "female" ? <UserRound size={30} /> : <User size={30} />}
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
 <h3 className="font-display text-[19px] font-bold leading-tight text-ink truncate">{v.name}</h3>
 <button
 onClick={() => startEdit(v.id, v.name)}
 className="w-8 h-8 rounded-[10px] flex items-center justify-center text-ink-2 shrink-0"
 aria-label="Sửa tên"
 >
 <Pencil size={16} />
 </button>
 </div>
 )}
 <p className="text-[13px] font-bold text-ink-2 mb-2">
 {relationLabel(v.relation)}
 {v.elevenlabs_voice_id ? " · Đã clone" : " · Chưa clone"}
 </p>
 <div className="flex items-center gap-2">
 <ProgressBar value={quality} tone={quality >= 80 ? "brand" : "glow"} label={`Chất lượng giọng ${quality}%`} className="flex-1" />
 <span className="text-[13px] font-extrabold text-ink-2">{quality}%</span>
 </div>
 </div>
 <div className="flex flex-col gap-1.5 shrink-0">
 {v.elevenlabs_voice_id && <VoicePreviewButton preview={preview} voiceId={v.elevenlabs_voice_id} name={v.name} compact />}
 <button type="button" role="switch" aria-label={`Bật giọng: ${v.name}`} aria-checked={v.is_active} disabled={!!toggling} onClick={()=>toggleVoice(v.id,!v.is_active)} className="min-h-11 rounded-xl border border-brand/30 px-2 text-[14px] font-bold text-brand-ink dark:text-[#F7EFD8] disabled:opacity-50">{toggling===v.id?"…":v.is_active?"Bật":"Tắt"}</button>
 <button
 onClick={() => handleDelete(v.id)}
 disabled={deletingId === v.id}
 className="w-11 h-11 rounded-[14px] bg-[#FDE7DF] flex items-center justify-center text-cta-press active:scale-95 transition-transform"
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

 {!loading && allVoices.length === 0 && (
 <div className={`bg-white rounded-[24px] p-6 text-center ${CARD_SHADOW}`}>
 <p className="font-display text-[20px] font-bold text-ink mb-0.5">Chưa có giọng nào</p>
 <p className="text-[14px] font-bold text-ink-2">Ghi 30 giây – 3 phút để tạo giọng đọc đầu tiên</p>
 </div>
 )}

 {/* Curated choices: family voices remain the first group. */}
 <section aria-label="Giọng của Đóm" className="space-y-3">
 <h2 className="font-display text-[22px] font-bold text-ink">Giọng của Đóm</h2>
 {defaults.filter(v=>v.language===settings.language&&v.is_active).sort((a,b)=>a.sort_order-b.sort_order).map(v=><div key={v.id} className={`flex items-center gap-3 rounded-[20px] bg-white p-4 ${CARD_SHADOW}`}><span className="min-w-0 flex-1 text-[16px] font-bold text-ink">{v.name}</span><VoicePreviewButton preview={preview} voiceId={v.voice_id} name={v.name} /></div>)}
 {!defaults.some(v=>v.language===settings.language&&v.is_active)&&<p className="text-[14px] text-ink-2">Chưa có giọng mặc định cho ngôn ngữ này.</p>}
 </section>
 {/* Add Voice */}
 <div className="pt-2">
 <Button3D block onClick={() => onNavigate("recording")}>
 <Mic size={24} weight="fill" /> Ghi giọng bố mẹ
 </Button3D>
 <p className="mt-3 text-center text-[13px] font-bold text-ink-2">Ghi 30 giây – 3 phút · chỉ dùng để kể truyện cho bé</p>
 </div>
 </div>
 </div>
 );
}
