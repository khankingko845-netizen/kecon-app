"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
 Mail,
 Lock,
 Eye,
 EyeOff,
 Mic,
 Globe,
} from "@/components/ui/icons";

import Mascot from "@/components/ui/Mascot";
import type { Screen } from "@/lib/types";

interface LoginProps {
 onNavigate: (screen: Screen) => void;
}

export default function Login({ onNavigate }: LoginProps) {
 const [showPassword, setShowPassword] = useState(false);
 const [error, setError] = useState<string | null>(null);
 const [pending, setPending] = useState(false);

 async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
 e.preventDefault();
 setError(null);
 const form = new FormData(e.currentTarget);
 const email = String(form.get("email") || "").trim();
 const password = String(form.get("password") || "");
 if (!email || !password) {
 setError("Vui lòng nhập email và mật khẩu");
 return;
 }
 setPending(true);
 const supabase = createClient();
 const { error } = await supabase.auth.signInWithPassword({
 email,
 password,
 });
 setPending(false);
 if (error) {
 if (error.message === "Invalid login credentials") {
 setError("Email hoặc mật khẩu không đúng");
 } else if (error.message === "Email not confirmed") {
 setError("Email chưa được xác nhận. Vui lòng kiểm tra hộp thư.");
 } else {
 setError(error.message);
 }
 return;
 }
 onNavigate("home");
 }

 async function handleGoogleLogin() {
 const supabase = createClient();
 await supabase.auth.signInWithOAuth({
 provider: "google",
 options: {
 redirectTo: `${window.location.origin}/auth/callback`,
 },
 });
 }

 return (
 <div className="min-h-screen bg-cream dark:bg-night flex flex-col">
 {/* Hero — Đóm (UI v2) */}
 <div className="relative bg-gradient-to-b from-glow-soft via-cream to-cream px-7 pt-12 pb-6 text-center rounded-b-[32px] overflow-hidden">
 <Mascot state="hello" size={120} priority className="mx-auto mb-2" />
 <h1 className="font-display text-[28px] font-extrabold text-ink tracking-tight mb-1">
 Chào mừng trở lại
 </h1>
 <p className="text-[15px] text-ink-2">
 Đăng nhập để tiếp tục kể chuyện
 </p>
 </div>

 {/* Form */}
 <form onSubmit={handleSubmit} className="flex-1 px-6 pt-6 pb-10">
 {error && (
 <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-4 text-red-600 text-sm font-medium">
 {error}
 </div>
 )}

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
 placeholder="••••••••"
 required
 className="w-full pl-11 pr-11 py-3.5 rounded-[14px] border-[1.5px] border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/[0.04] text-[15px] font-medium text-gray-900 dark:text-white/90 placeholder:text-gray-400 dark:text-white/30 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition-colors"
 />
 <button
 type="button"
 onClick={() => setShowPassword(!showPassword)}
 className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 dark:text-white/30"
 >
 {showPassword ? (
 <EyeOff className="w-4 h-4" />
 ) : (
 <Eye className="w-4 h-4" />
 )}
 </button>
 </div>
 </div>

 <button
 type="submit"
 disabled={pending}
 className="w-full min-h-tap-kid rounded-btn bg-cta text-white text-[17px] font-extrabold shadow-[0_5px_0_var(--color-cta-press)] active:translate-y-0.5 active:shadow-none disabled:opacity-60 transition mt-2"
 >
 {pending ? "Đang đăng nhập…" : "Đăng nhập"}
 </button>

 <div className="flex items-center gap-3 my-5">
 <div className="flex-1 h-px bg-gray-200 dark:bg-white/[0.08]" />
 <span className="text-[13px] font-medium text-gray-400 dark:text-white/30">hoặc</span>
 <div className="flex-1 h-px bg-gray-200 dark:bg-white/[0.08]" />
 </div>

 <button
 type="button"
 onClick={handleGoogleLogin}
 className="w-full py-3.5 rounded-[14px] border-[1.5px] border-gray-200 dark:border-white/10 bg-white dark:bg-white/[0.04] flex items-center justify-center gap-2.5 text-sm font-semibold text-gray-900 dark:text-white/90 mb-3"
 >
 <Globe className="w-[18px] h-[18px]" />
 Đăng nhập với Google
 </button>

 <div className="text-center mt-5 text-sm text-gray-500 dark:text-white/40 font-medium">
 Chưa có tài khoản?{" "}
 <button
 type="button"
 onClick={() => onNavigate("signup")}
 className="text-brand font-bold"
 >
 Đăng ký
 </button>
 </div>
 </form>

 {/* Bottom branding */}
 <div className="flex items-center justify-center gap-2 pb-8 text-gray-300">
 <Mic className="w-4 h-4" />
 <span className="text-xs font-semibold tracking-wide">KểCon</span>
 </div>
 </div>
 );
}
