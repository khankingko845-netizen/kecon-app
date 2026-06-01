"use client";

import { Mic } from "lucide-react";

interface OnboardingProps {
  onGetStarted: () => void;
  onLogin: () => void;
}

export default function Onboarding({ onGetStarted, onLogin }: OnboardingProps) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-accent via-pink-500 to-accent-2 flex flex-col items-center justify-end px-7 pb-10 relative overflow-hidden">
      {/* Decorative circles */}
      <div className="absolute top-20 -left-20 w-72 h-72 rounded-full border border-white/15" />
      <div className="absolute top-28 -right-14 w-48 h-48 rounded-full border border-white/15" />
      <div className="absolute top-48 left-1/2 -translate-x-1/2 w-96 h-96 rounded-full border border-white/8" />

      {/* Icon */}
      <div className="w-20 h-20 rounded-3xl bg-white/20 backdrop-blur-xl flex items-center justify-center text-white mb-auto mt-32 z-10">
        <Mic size={38} />
      </div>

      {/* Text */}
      <div className="text-center mb-8 z-10">
        <h1 className="text-[32px] font-extrabold text-white tracking-tight leading-tight mb-3">
          Kể chuyện bằng
          <br />
          giọng của bạn
        </h1>
        <p className="text-white/70 text-[15px] leading-relaxed">
          Tạo giọng đọc AI, AI tạo truyện, và kể cho con nghe mỗi tối — dù
          bạn ở đâu.
        </p>
      </div>

      {/* Buttons */}
      <button
        onClick={onGetStarted}
        className="w-full py-[18px] rounded-2xl bg-white text-accent font-bold text-base z-10 active:scale-[0.98] transition-transform"
      >
        Bắt Đầu Ngay
      </button>
      <button
        onClick={onLogin}
        className="w-full py-[18px] rounded-2xl border-[1.5px] border-white/30 text-white font-semibold text-base mt-3 z-10 active:scale-[0.98] transition-transform"
      >
        Đã Có Tài Khoản
      </button>

      {/* Dots */}
      <div className="flex gap-1.5 mt-5 z-10">
        <div className="w-6 h-1.5 rounded-full bg-white" />
        <div className="w-1.5 h-1.5 rounded-full bg-white/30" />
        <div className="w-1.5 h-1.5 rounded-full bg-white/30" />
      </div>
    </div>
  );
}
