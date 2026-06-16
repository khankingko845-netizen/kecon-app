"use client";

import { useState } from "react";
import { ChevronLeft, Check, User, Users, Baby, Calendar, Globe, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { createClient } from "@/lib/supabase/client";
import type { Screen } from "@/lib/types";

interface ProfileEditProps {
 onNavigate: (screen: Screen, data?: Record<string, string>) => void;
 onBack: () => void;
}

const avatarEmojis = ["👨‍👩‍👧", "👨‍👩‍👦", "👩‍👧", "👨‍👦", "👨‍👩‍👧‍👦", "👪", "🐻", "🦁", "🐰", "🐼", "🦊", "🐯"];

export default function ProfileEdit({ onBack }: ProfileEditProps) {
 const { profile, refreshProfile } = useAuth();
 const [displayName, setDisplayName] = useState(profile?.display_name || "");
 const [familyName, setFamilyName] = useState(profile?.family_name || "");
 const [selectedAvatar, setSelectedAvatar] = useState(profile?.avatar_emoji || "👨‍👩‍👧");
 const [childAge, setChildAge] = useState(profile?.child_age?.toString() || "");
 const [locale, setLocale] = useState(profile?.locale || "vi");
 const [saving, setSaving] = useState(false);
 const [saved, setSaved] = useState(false);

 const handleSave = async () => {
 if (!profile?.id) return;
 setSaving(true);
 try {
 const supabase = createClient();
 await supabase.from("profiles").update({
 display_name: displayName.trim() || null,
 family_name: familyName.trim() || null,
 avatar_emoji: selectedAvatar,
 child_age: childAge ? parseInt(childAge) : null,
 locale,
 }).eq("id", profile.id);
 await refreshProfile();
 setSaved(true);
 setTimeout(() => setSaved(false), 2000);
 } catch { /* ignore */ }
 setSaving(false);
 };

 return (
 <div className="min-h-screen bg-surface dark:bg-[#0A0A0F] pb-24">
 <div className="px-5 pt-14">
 {/* Header */}
 <div className="flex items-center gap-3 mb-6">
 <button onClick={onBack} className="w-9 h-9 rounded-xl bg-white dark:bg-white/[0.04] flex items-center justify-center shadow-sm">
 <ChevronLeft size={18} />
 </button>
 <h2 className="text-[22px] font-black tracking-tight flex-1">Hồ Sơ</h2>
 <button
 onClick={handleSave}
 disabled={saving}
 className={`px-4 py-2 rounded-xl text-[13px] font-bold flex items-center gap-1.5 transition-all ${
 saved ? "bg-green-500 text-white" : "bg-accent text-white"
 }`}
 >
 {saving ? <Loader2 size={14} className="animate-spin" /> : saved ? <Check size={14} /> : null}
 {saved ? "Đã lưu" : "Lưu"}
 </button>
 </div>

 {/* Avatar */}
 <div className="bg-white dark:bg-white/[0.04] rounded-2xl p-5 shadow-sm mb-4">
 <p className="text-[13px] font-bold text-txt dark:text-white mb-3 flex items-center gap-2">
 <User size={14} /> Ảnh đại diện
 </p>
 <div className="flex flex-wrap gap-2.5">
 {avatarEmojis.map((emoji) => (
 <button
 key={emoji}
 onClick={() => setSelectedAvatar(emoji)}
 className={`w-14 h-14 rounded-2xl text-2xl flex items-center justify-center transition-all ${
 selectedAvatar === emoji
 ? "bg-accent/10 border-2 border-accent scale-110"
 : "bg-gray-50 dark:bg-white/[0.04] border-2 border-transparent"
 }`}
 >
 {emoji}
 </button>
 ))}
 </div>
 </div>

 {/* Display Name */}
 <div className="bg-white dark:bg-white/[0.04] rounded-2xl p-5 shadow-sm mb-4">
 <label className="text-[13px] font-bold text-txt dark:text-white mb-2.5 flex items-center gap-2">
 <Users size={14} /> Tên hiển thị
 </label>
 <input
 type="text"
 value={displayName}
 onChange={(e) => setDisplayName(e.target.value)}
 placeholder="VD: Ba Minh, Mẹ Hà..."
 className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-white/10 bg-surface dark:bg-white/[0.04] text-[14px] font-semibold outline-none focus:border-accent transition-colors"
 />
 </div>

 {/* Family Name */}
 <div className="bg-white dark:bg-white/[0.04] rounded-2xl p-5 shadow-sm mb-4">
 <label className="text-[13px] font-bold text-txt dark:text-white mb-2.5 flex items-center gap-2">
 <Users size={14} /> Tên gia đình
 </label>
 <input
 type="text"
 value={familyName}
 onChange={(e) => setFamilyName(e.target.value)}
 placeholder="VD: Gia đình Gấu, Nhà Mít..."
 className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-white/10 bg-surface dark:bg-white/[0.04] text-[14px] font-semibold outline-none focus:border-accent transition-colors"
 />
 <p className="text-[11px] text-txt-secondary dark:text-white/50 mt-2">Hiển thị trên trang chủ &quot;Gia đình ...&quot;</p>
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
 className={`w-10 h-10 rounded-xl text-[13px] font-bold flex items-center justify-center transition-all ${
 childAge === age
 ? "bg-accent text-white"
 : "bg-gray-50 dark:bg-white/[0.04] text-txt dark:text-white border border-gray-200 dark:border-white/10"
 }`}
 >
 {age}
 </button>
 ))}
 </div>
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
 ? "bg-accent text-white"
 : "bg-gray-50 dark:bg-white/[0.04] text-txt dark:text-white border border-gray-200 dark:border-white/10"
 }`}
 >
 {lang.label}
 </button>
 ))}
 </div>
 </div>

 {/* Email (read-only) */}
 <div className="bg-white dark:bg-white/[0.04] rounded-2xl p-5 shadow-sm mb-4 opacity-60">
 <label className="text-[13px] font-bold text-txt dark:text-white mb-2.5 flex items-center gap-2">
 <Calendar size={14} /> Email
 </label>
 <p className="text-[14px] text-txt-secondary dark:text-white/50">{profile?.email || "—"}</p>
 </div>
 </div>
 </div>
 );
}
