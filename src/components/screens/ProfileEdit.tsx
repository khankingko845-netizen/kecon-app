"use client";

import { useState, useEffect } from "react";
import { ChevronLeft, Check, Users, Baby, Calendar, Globe, Loader2 } from "@/components/ui/icons";
import { useAuth } from "@/lib/auth-context";
import { useSettings } from "@/lib/settings-context";
import { ageUiFor } from "@/lib/age-ui";
import FamilyAvatar from "@/components/ui/FamilyAvatar";
import { FAMILY_AVATARS, familyAvatarFor, customAvatarUrl } from "@/lib/family-avatar";
import { buildProfileUpdate } from "@/lib/profile-form";
import { MAX_AVATAR_BYTES, avatarIdFromUrl } from "@/lib/avatar-path";
import { createClient } from "@/lib/supabase/client";
import type { Screen } from "@/lib/types";

interface ProfileEditProps {
 onNavigate: (screen: Screen, data?: Record<string, string>) => void;
 onBack: () => void;
}

export default function ProfileEdit({ onBack }: ProfileEditProps) {
 const { profile, refreshProfile } = useAuth();
 const { updateSettings } = useSettings();
 const [displayName, setDisplayName] = useState(profile?.display_name || "");
 const [familyName, setFamilyName] = useState(profile?.family_name || "");
 const [selectedAvatar, setSelectedAvatar] = useState(customAvatarUrl(profile?.avatar_url) ?? familyAvatarFor(profile?.avatar_url, profile?.avatar_emoji).src);
 const [childAge, setChildAge] = useState(profile?.child_age?.toString() || "");
 const [locale, setLocale] = useState(profile?.locale || "vi");
 const [saving, setSaving] = useState(false);
 const [saved, setSaved] = useState(false);
 const [saveError, setSaveError] = useState(false);
 const [photo, setPhoto] = useState<File | null>(null);
 const [preview, setPreview] = useState<string | null>(null);
 const [photoError, setPhotoError] = useState<string | null>(null);
 useEffect(() => () => { if(preview) URL.revokeObjectURL(preview); }, [preview]);
 const selectPhoto=(file:File|null)=>{ setPhoto(file);setPreview(file?URL.createObjectURL(file):null); };
 const pickPhoto=(file?:File)=>{
  setPhotoError(null);if(!file)return;
  if(file.size>MAX_AVATAR_BYTES){setPhotoError("Ảnh tối đa 5 MB.");return;}
  if(!["image/jpeg","image/png","image/webp"].includes(file.type)){setPhotoError("Chọn ảnh JPG, PNG hoặc WebP.");return;}
  selectPhoto(file);setSaved(false);
 };


 const handleSave = async () => {
 if (!profile?.id) return;
 setSaving(true);
 setSaveError(false);
 setPhotoError(null);
 let uploaded:string|null=null;
 try {
 if(photo){
  const form=new FormData();form.append("file",photo);
  const response=await fetch("/api/profile/avatar",{method:"POST",body:form});const data=await response.json();
  if(!response.ok||!data.avatarUrl)throw new Error(data.error||"Chưa tải được ảnh.");uploaded=data.avatarUrl;
 }
 const supabase = createClient();
 const update = buildProfileUpdate({ displayName, familyName, avatarEmoji: "", avatarUrl: uploaded ?? selectedAvatar, childAge, locale });
 // `.select` so an update that matched no row (RLS) is not reported as saved.
 const { data, error } = await supabase.from("profiles").update(update).eq("id", profile.id).select("id");
 if (error || !data?.length) throw error ?? new Error("profile not updated");
 // UI-13: the kid screens follow the new age band right away.
 if (update.child_age) updateSettings({ childAge: ageUiFor(update.child_age).band });
 await refreshProfile();
 const previousId=avatarIdFromUrl(profile.avatar_url);
 if(previousId && profile.avatar_url!==update.avatar_url)fetch(`/api/profile/avatar/${previousId}`,{method:"DELETE"}).catch(()=>{});
 if(uploaded){setSelectedAvatar(uploaded);selectPhoto(null);}
 setSaved(true);
 setTimeout(() => setSaved(false), 2000);
 } catch (err) {
 if(uploaded)await fetch(uploaded,{method:"DELETE"}).catch(()=>{});
 if(photo)setPhotoError(err instanceof Error?err.message:"Chưa tải được ảnh.");
 setSaveError(true);
 }
 setSaving(false);
 };

 return (
 <div className="min-h-screen bg-parent-bg font-parent pb-24">
 <div className="px-5 pt-14">
 {/* Header */}
 <div className="flex items-center gap-3 mb-6">
 <button onClick={onBack} aria-label="Quay lại" className="w-11 h-11 rounded-xl bg-white dark:bg-white/[0.04] flex items-center justify-center shadow-sm">
 <ChevronLeft size={18} />
 </button>
 <h1 className="text-[22px] font-black tracking-tight flex-1">Hồ sơ gia đình</h1>
 <button
 onClick={handleSave}
 disabled={saving}
 className={`min-h-11 px-4 py-2 rounded-xl text-[14px] font-bold flex items-center gap-1.5 transition-all ${
 saved ? "bg-success text-white" : "bg-brand text-white"
 }`}
 >
 {saving ? <Loader2 size={14} className="animate-spin" /> : saved ? <Check size={14} /> : null}
 {saved ? "Đã lưu" : "Lưu"}
 </button>
 </div>

 {saveError && (
 <p role="alert" data-testid="profile-save-error" className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-[13px] font-bold text-red-600 dark:bg-red-500/10 dark:text-red-300">
 Chưa lưu được hồ sơ — kiểm tra mạng rồi bấm Lưu lại nhé.
 </p>
 )}

 {/* One shared portrait appears here, on Home, and beside the family settings row. */}
 <section className={`bg-white dark:bg-white/[0.04] rounded-[24px] p-5 shadow-sm mb-4`} aria-label="Ảnh đại diện gia đình">
 <div className="mb-5 flex flex-col items-center text-center">
 <FamilyAvatar avatarUrl={selectedAvatar} previewUrl={preview} size={104} />
 <h2 className="mt-3 text-[18px] font-bold text-ink dark:text-white">{familyName.trim() || "Gia đình mình"}</h2>
 <p className="mt-1 text-[14px] leading-relaxed text-ink-2 dark:text-white/65">Dùng ảnh của cả nhà hoặc chọn một bạn Đóm.</p>
 </div>
 <label className="mb-4 flex min-h-11 cursor-pointer items-center justify-center rounded-xl bg-brand-soft px-4 py-3 text-[14px] font-semibold text-brand-ink focus-within:outline-2 focus-within:outline-brand">
 {photo ? "Chọn ảnh khác" : "Tải ảnh gia đình"}
 <input aria-label="Tải ảnh gia đình" type="file" accept="image/jpeg,image/png,image/webp" disabled={saving} className="sr-only" onChange={e=>{pickPhoto(e.target.files?.[0]);e.target.value="";}} />
 </label>
 <p className="mb-4 text-[14px] leading-relaxed text-ink-2 dark:text-white/65">JPG, PNG, WebP · tối đa 5 MB. Ảnh chỉ đổi khi bấm Lưu; được cắt vuông và bỏ dữ liệu vị trí.</p>
 {photoError && <p role="alert" data-testid="photo-error" className="mb-4 text-[14px] text-red-700 dark:text-red-300">{photoError}</p>}
 <div className="grid grid-cols-3 gap-3" role="group" aria-label="Chọn ảnh đại diện Đóm">
 {FAMILY_AVATARS.map((avatar) => (
 <button
 key={avatar.id}
 disabled={saving}
 type="button"
 onClick={() => { setSelectedAvatar(avatar.src); selectPhoto(null); setPhotoError(null); setSaved(false); }}
 aria-label={avatar.label}
 aria-pressed={!photo && selectedAvatar === avatar.src}
 className={`relative flex min-h-[112px] flex-col items-center gap-2 rounded-[20px] border-2 px-1 py-3 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${!photo && selectedAvatar === avatar.src ? "border-brand bg-brand-soft" : "border-transparent bg-surface dark:bg-white/[0.04]"}`}
 >
 <FamilyAvatar avatarUrl={avatar.src} size={60} label={null} />
 <span className="text-[14px] font-semibold leading-tight text-ink dark:text-white">{avatar.label}</span>
 {!photo && selectedAvatar === avatar.src && <span aria-hidden className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-brand text-white"><Check size={12} weight="bold" /></span>}
 </button>
 ))}
 </div>
 {customAvatarUrl(profile?.avatar_url) && <button type="button" aria-pressed={!photo && selectedAvatar === profile?.avatar_url} disabled={saving} onClick={() => { selectPhoto(null); setPhotoError(null); setSelectedAvatar(profile!.avatar_url!); setSaved(false); }} className="mt-3 flex min-h-11 items-center gap-2 rounded-xl px-3 text-[14px] text-brand-ink"><FamilyAvatar avatarUrl={profile?.avatar_url} size={32} label={null} /> Giữ ảnh hiện tại</button>}
 </section>

 {/* Display Name */}
 <div className="bg-white dark:bg-white/[0.04] rounded-2xl p-5 shadow-sm mb-4">
 <label htmlFor="profile-display-name" className="text-[13px] font-bold text-txt dark:text-white mb-2.5 flex items-center gap-2">
 <Users size={14} /> Tên hiển thị
 </label>
 <input
 type="text"
 id="profile-display-name"
 value={displayName}
 onChange={(e) => setDisplayName(e.target.value)}
 placeholder="VD: Ba Minh, Mẹ Hà..."
 className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-white/10 bg-surface dark:bg-white/[0.04] text-[14px] font-semibold outline-none focus:border-accent transition-colors"
 />
 </div>

 {/* Family Name */}
 <div className="bg-white dark:bg-white/[0.04] rounded-2xl p-5 shadow-sm mb-4">
 <label htmlFor="profile-family-name" className="text-[13px] font-bold text-txt dark:text-white mb-2.5 flex items-center gap-2">
 <Users size={14} /> Tên gia đình
 </label>
 <input
 type="text"
 id="profile-family-name"
 value={familyName}
 onChange={(e) => setFamilyName(e.target.value)}
 placeholder="VD: Gia đình Gấu, Nhà Mít..."
 className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-white/10 bg-surface dark:bg-white/[0.04] text-[14px] font-semibold outline-none focus:border-accent transition-colors"
 />
 <p className="text-[14px] text-txt-secondary dark:text-white/65 mt-2">Tên gọi chung của cả nhà trong hồ sơ.</p>
 </div>

 {/* Child Age */}
 <div className="bg-white dark:bg-white/[0.04] rounded-2xl p-5 shadow-sm mb-4">
 <label className="text-[13px] font-bold text-txt dark:text-white mb-2.5 flex items-center gap-2">
 <Baby size={14} /> Tuổi của bé
 </label>
 <div className="flex gap-2 flex-wrap">
 {["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"].map((age) => (
 <button
 key={age}
 onClick={() => setChildAge(age)}
 aria-pressed={childAge === age}
 className={`w-10 h-10 rounded-xl text-[13px] font-bold flex items-center justify-center transition-all ${
 childAge === age
 ? "bg-brand text-white"
 : "bg-gray-50 dark:bg-white/[0.04] text-txt dark:text-white border border-gray-200 dark:border-white/10"
 }`}
 >
 {age}
 </button>
 ))}
 </div>
 {childAge && (() => {
   const ui = ageUiFor(parseInt(childAge));
   return (
     <p data-testid="age-band-summary" data-band={ui.band} className="mt-3 rounded-xl bg-accent/10 px-3 py-2.5 text-[12px] font-semibold leading-snug text-txt dark:text-white">
       Nhóm <b>{ui.short} · {ui.label}</b>: {ui.summary}.
     </p>
   );
 })()}
 </div>

 {/* Language */}
 <div className="bg-white dark:bg-white/[0.04] rounded-2xl p-5 shadow-sm mb-4">
 <label className="text-[13px] font-bold text-txt dark:text-white mb-2.5 flex items-center gap-2">
 <Globe size={14} /> Ngôn ngữ
 </label>
 <div className="flex gap-2">
 {[
 { id: "vi", label: "🇻🇳 Tiếng Việt" },
 { id: "en", label: "🇺🇸 English" },
 { id: "ja", label: "🇯🇵 日本語" },
 ].map((lang) => (
 <button
 key={lang.id}
 onClick={() => setLocale(lang.id)}
 className={`flex-1 py-3 rounded-xl text-[13px] font-bold transition-all ${
 locale === lang.id
 ? "bg-brand text-white"
 : "bg-gray-50 dark:bg-white/[0.04] text-txt dark:text-white border border-gray-200 dark:border-white/10"
 }`}
 >
 {lang.label}
 </button>
 ))}
 </div>
 </div>

 {/* Email (read-only) */}
 <div className="bg-white dark:bg-white/[0.04] rounded-2xl p-5 shadow-sm mb-4">
 <label className="text-[13px] font-bold text-txt dark:text-white mb-2.5 flex items-center gap-2">
 <Calendar size={14} /> Email
 </label>
 <p className="text-[14px] text-txt-secondary dark:text-white/65">{profile?.email || "—"}</p>
 </div>
 </div>
 </div>
 );
}
