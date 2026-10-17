"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
 Mail,
 Lock,
 Users,
 Baby,
 User,
 Eye,
 EyeOff,
} from "@/components/ui/icons";

import Mascot from "@/components/ui/Mascot";
import type { Screen } from "@/lib/types";
import { MAX_CHILD_NAME_LENGTH, birthYearOptions, normalizeChildName, pendingChildKey } from "@/lib/child-profiles";

interface SignupProps {
 onNavigate: (screen: Screen) => void;
}

export default function Signup({ onNavigate }: SignupProps) {
 const [showPassword, setShowPassword] = useState(false);
 const [error, setError] = useState<string | null>(null);
 const [notice, setNotice] = useState<string | null>(null);
 const [pending, setPending] = useState(false);

 async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
 e.preventDefault();
 setError(null);
 setNotice(null);
 const form = new FormData(e.currentTarget);
 const email = String(form.get("email") || "").trim();
 const password = String(form.get("password") || "");
 const familyName = String(form.get("familyName") || "").trim();
 const childName = normalizeChildName(String(form.get("childName") || "")).slice(0, MAX_CHILD_NAME_LENGTH);
 const birthYear = Number.parseInt(String(form.get("childBirthYear") || ""), 10);

 if (!email || !password) {
 setError("Vui lòng nhập email và mật khẩu");
 return;
 }
 if (password.length < 8) {
 setError("Mật khẩu phải có ít nhất 8 ký tự");
 return;
 }

 setPending(true);
 const supabase = createClient();
 const { data, error } = await supabase.auth.signUp({
 email,
 password,
 options: {
 emailRedirectTo: `${window.location.origin}/auth/callback`,
 // T10: the child's name/year are not sent to the server here — they become the
 // first Hồ sơ bé on this device once the parent has consented (T11).
 data: {
 family_name: familyName,
 display_name: familyName || email.split("@")[0],
 },
 },
 });
 setPending(false);

 if (error) {
 setError(error.message);
 return;
 }
 if (childName && data.user?.id) {
 try {
 localStorage.setItem(
 pendingChildKey(data.user.id),
 JSON.stringify({ displayName: childName, birthYear: Number.isInteger(birthYear) ? birthYear : null }),
 );
 } catch {
 /* private mode: the parent adds the child in Hồ sơ bé */
 }
 }
 if (!data.session) {
 setNotice(
 "Tài khoản đã tạo! Vui lòng kiểm tra email để xác nhận trước khi đăng nhập."
 );
 return;
 }
 onNavigate("home");
 }

 return (
 <div className="min-h-screen bg-cream dark:bg-night flex flex-col">
 {/* Hero — Đóm (UI v2) */}
 <div className="relative bg-gradient-to-b from-glow-soft via-cream to-cream px-7 pt-12 pb-6 text-center rounded-b-[32px] overflow-hidden">
 <Mascot state="happy" size={120} priority className="mx-auto mb-2" />
 <h1 className="font-display text-[28px] font-extrabold text-ink tracking-tight mb-1">
 Tạo tài khoản
 </h1>
 <p className="text-[15px] text-ink-2">
 Bắt đầu kể chuyện cho con
 </p>
 </div>

 {/* Form */}
 <form onSubmit={handleSubmit} className="flex-1 px-6 pt-6 pb-10 overflow-y-auto">
 {error && (
 <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-4 text-red-600 text-sm font-medium">
 {error}
 </div>
 )}
 {notice && (
 <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 mb-4 text-emerald-700 text-sm font-medium">
 {notice}
 </div>
 )}

 <div className="mb-4">
 <label className="text-[13px] font-bold text-gray-900 dark:text-white/90 block mb-2">
 Tên gia đình
 </label>
 <div className="relative">
 <Users className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-white/30" />
 <input
 name="familyName"
 type="text"
 placeholder="Gia đình Minh"
 className="w-full pl-11 pr-4 py-3.5 rounded-[14px] border-[1.5px] border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/[0.04] text-[15px] font-medium text-gray-900 dark:text-white/90 placeholder:text-gray-400 dark:text-white/30 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition-colors"
 />
 </div>
 </div>

 <div className="mb-4">
 <label className="text-[13px] font-bold text-gray-900 dark:text-white/90 block mb-2">
 Email
 </label>
 <div className="relative">
 <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-white/30" />
 <input
 name="email"
 type="email"
 placeholder="name@email.com"
 required
 className="w-full pl-11 pr-4 py-3.5 rounded-[14px] border-[1.5px] border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/[0.04] text-[15px] font-medium text-gray-900 dark:text-white/90 placeholder:text-gray-400 dark:text-white/30 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition-colors"
 />
 </div>
 </div>

 <div className="mb-4">
 <label className="text-[13px] font-bold text-gray-900 dark:text-white/90 block mb-2">
 Mật khẩu
 </label>
 <div className="relative">
 <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-white/30" />
 <input
 name="password"
 type={showPassword ? "text" : "password"}
 placeholder="Tối thiểu 8 ký tự"
 required
 minLength={8}
 className="w-full pl-11 pr-11 py-3.5 rounded-[14px] border-[1.5px] border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/[0.04] text-[15px] font-medium text-gray-900 dark:text-white/90 placeholder:text-gray-400 dark:text-white/30 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition-colors"
 />
 <button
 type="button"
 onClick={() => setShowPassword(!showPassword)}
 aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
 aria-pressed={showPassword}
 className="absolute right-2 top-1/2 -translate-y-1/2 flex h-11 w-11 items-center justify-center text-ink-2 dark:text-white/60"
 >
 {showPassword ? (
 <EyeOff className="w-4 h-4" />
 ) : (
 <Eye className="w-4 h-4" />
 )}
 </button>
 </div>
 </div>

 <div className="grid grid-cols-2 gap-3 mb-4">
 <div>
 <label htmlFor="signup-child-name" className="text-[13px] font-bold text-gray-900 dark:text-white/90 block mb-2">
 Tên con
 </label>
 <div className="relative">
 <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-white/30" />
 <input
 id="signup-child-name"
 name="childName"
 type="text"
 maxLength={MAX_CHILD_NAME_LENGTH}
 autoComplete="off"
 placeholder="VD: Minh"
 className="w-full pl-11 pr-4 py-3.5 rounded-[14px] border-[1.5px] border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/[0.04] text-[15px] font-medium text-gray-900 dark:text-white/90 placeholder:text-gray-400 dark:text-white/30 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition-colors"
 />
 </div>
 </div>
 <div>
 <label htmlFor="signup-child-birth-year" className="text-[13px] font-bold text-gray-900 dark:text-white/90 block mb-2">
 Năm sinh của con
 </label>
 <div className="relative">
 <Baby className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-white/30" />
 <select
 id="signup-child-birth-year"
 name="childBirthYear"
 defaultValue=""
 className="w-full appearance-none pl-11 pr-3 py-3.5 rounded-[14px] border-[1.5px] border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/[0.04] text-[15px] font-medium text-gray-900 dark:text-white/90 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition-colors"
 >
 <option value="">Chọn năm</option>
 {birthYearOptions().map((o) => (
 <option key={o.year} value={o.year}>
 {o.year} · {o.age === 0 ? "dưới 1 tuổi" : `${o.age} tuổi`}
 </option>
 ))}
 </select>
 </div>
 </div>
 </div>
 <p className="-mt-2 mb-4 text-[13px] text-gray-600 dark:text-white/60">
 Chỉ lưu năm sinh. Hồ sơ bé được tạo sau khi bố mẹ đồng ý chính sách; thêm bé khác trong Bố mẹ → Hồ sơ bé.
 </p>

 <button
 type="submit"
 disabled={pending}
 className="w-full min-h-tap-kid rounded-btn bg-cta text-white text-[19px] font-extrabold shadow-[0_5px_0_var(--color-cta-press)] active:translate-y-0.5 active:shadow-none disabled:opacity-60 transition mt-2"
 >
 {pending ? "Đang tạo tài khoản…" : "Tạo tài khoản"}
 </button>

 <div className="text-center mt-5 text-sm text-gray-600 dark:text-white/70 font-medium">
 Đã có tài khoản?{" "}
 <button
 type="button"
 onClick={() => onNavigate("login")}
 className="inline-flex min-h-11 items-center px-1.5 text-brand-ink font-bold"
 >
 Đăng nhập
 </button>
 </div>
 </form>
 </div>
 );
}
