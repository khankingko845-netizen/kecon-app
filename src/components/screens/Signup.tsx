"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  Mic,
  Mail,
  Lock,
  Users,
  Baby,
  User,
  Eye,
  EyeOff,
} from "lucide-react";

import type { Screen } from "@/lib/types";

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
    const childName = String(form.get("childName") || "").trim();
    const childAge = String(form.get("childAge") || "").trim();

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
        data: {
          family_name: familyName,
          display_name: familyName || email.split("@")[0],
          child_name: childName,
          child_age: childAge ? parseInt(childAge) : null,
        },
      },
    });
    setPending(false);

    if (error) {
      setError(error.message);
      return;
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
    <div className="min-h-screen bg-white flex flex-col">
      {/* Hero gradient */}
      <div className="bg-gradient-to-br from-[#FF6B3D] via-[#FF3D77] to-[#7B61FF] px-7 pt-16 pb-8 text-white text-center rounded-b-[32px]">
        <div className="w-16 h-16 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center mx-auto mb-4">
          <Mic className="w-7 h-7" />
        </div>
        <h1 className="text-[26px] font-extrabold tracking-tight mb-1">
          Tạo tài khoản
        </h1>
        <p className="text-sm opacity-80">
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
          <label className="text-[13px] font-bold text-gray-900 block mb-2">
            Tên gia đình
          </label>
          <div className="relative">
            <Users className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              name="familyName"
              type="text"
              placeholder="Gia đình Minh"
              className="w-full pl-11 pr-4 py-3.5 rounded-[14px] border-[1.5px] border-gray-200 bg-gray-50 text-[15px] font-medium text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-[#FF6B3D] focus:ring-1 focus:ring-[#FF6B3D]/20 transition-colors"
            />
          </div>
        </div>

        <div className="mb-4">
          <label className="text-[13px] font-bold text-gray-900 block mb-2">
            Email
          </label>
          <div className="relative">
            <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              name="email"
              type="email"
              placeholder="name@email.com"
              required
              className="w-full pl-11 pr-4 py-3.5 rounded-[14px] border-[1.5px] border-gray-200 bg-gray-50 text-[15px] font-medium text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-[#FF6B3D] focus:ring-1 focus:ring-[#FF6B3D]/20 transition-colors"
            />
          </div>
        </div>

        <div className="mb-4">
          <label className="text-[13px] font-bold text-gray-900 block mb-2">
            Mật khẩu
          </label>
          <div className="relative">
            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              name="password"
              type={showPassword ? "text" : "password"}
              placeholder="Tối thiểu 8 ký tự"
              required
              minLength={8}
              className="w-full pl-11 pr-11 py-3.5 rounded-[14px] border-[1.5px] border-gray-200 bg-gray-50 text-[15px] font-medium text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-[#FF6B3D] focus:ring-1 focus:ring-[#FF6B3D]/20 transition-colors"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400"
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
            <label className="text-[13px] font-bold text-gray-900 block mb-2">
              Tên con
            </label>
            <div className="relative">
              <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                name="childName"
                type="text"
                placeholder="VD: Minh"
                className="w-full pl-11 pr-4 py-3.5 rounded-[14px] border-[1.5px] border-gray-200 bg-gray-50 text-[15px] font-medium text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-[#FF6B3D] focus:ring-1 focus:ring-[#FF6B3D]/20 transition-colors"
              />
            </div>
          </div>
          <div>
            <label className="text-[13px] font-bold text-gray-900 block mb-2">
              Tuổi con
            </label>
            <div className="relative">
              <Baby className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                name="childAge"
                type="number"
                min="0"
                max="18"
                placeholder="4"
                className="w-full pl-11 pr-4 py-3.5 rounded-[14px] border-[1.5px] border-gray-200 bg-gray-50 text-[15px] font-medium text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-[#FF6B3D] focus:ring-1 focus:ring-[#FF6B3D]/20 transition-colors"
              />
            </div>
          </div>
        </div>

        <button
          type="submit"
          disabled={pending}
          className="w-full py-4 rounded-[14px] bg-gradient-to-r from-[#FF6B3D] to-[#FF3D77] text-white text-base font-bold disabled:opacity-60 transition-opacity mt-2"
        >
          {pending ? "Đang tạo tài khoản..." : "Tạo Tài Khoản"}
        </button>

        <div className="text-center mt-5 text-sm text-gray-500 font-medium">
          Đã có tài khoản?{" "}
          <button
            type="button"
            onClick={() => onNavigate("login")}
            className="text-[#FF6B3D] font-bold"
          >
            Đăng nhập
          </button>
        </div>
      </form>
    </div>
  );
}
