"use client";

import { useState } from "react";
import { ChevronRight, Sparkles, Mic, BookOpen, Shield, Star } from "lucide-react";
import type { Screen } from "@/lib/types";

interface OnboardingProps {
  onGetStarted: () => void;
  onLogin: () => void;
}

const steps = [
  {
    icon: <Sparkles size={48} className="text-amber-400" />,
    title: "Chào mừng đến KểCon! 🎉",
    subtitle: "Nền tảng kể chuyện AI cho gia đình Việt",
    description: "Tạo câu chuyện cá nhân hóa cho bé yêu với giọng đọc của chính bạn",
    gradient: "from-amber-100 to-orange-100",
  },
  {
    icon: <Mic size={48} className="text-blue-500" />,
    title: "Clone giọng nói 🎤",
    subtitle: "Giọng đọc của ba mẹ, ông bà",
    description: "Ghi âm 30 giây → AI clone giọng nói. Bé được nghe truyện bằng giọng người thân yêu nhất",
    gradient: "from-blue-100 to-cyan-100",
  },
  {
    icon: <BookOpen size={48} className="text-green-500" />,
    title: "Tạo truyện bằng AI ✍️",
    subtitle: "Vô vàn câu chuyện sáng tạo",
    description: "Nhập mô tả → AI viết truyện + minh họa + đọc bằng giọng bạn chọn. Có chuyên gia trẻ em hỗ trợ",
    gradient: "from-green-100 to-emerald-100",
  },
  {
    icon: <Shield size={48} className="text-purple-500" />,
    title: "An toàn cho bé 🛡️",
    subtitle: "Kiểm soát hoàn toàn",
    description: "Giới hạn thời gian, giờ ngủ, chặn nội dung. COPPA/GDPR compliant — dữ liệu bé luôn an toàn",
    gradient: "from-purple-100 to-pink-100",
  },
  {
    icon: <Star size={48} className="text-yellow-500" />,
    title: "Sẵn sàng rồi! ⭐",
    subtitle: "Hãy bắt đầu hành trình",
    description: "Clone giọng đọc đầu tiên hoặc tạo ngay câu chuyện AI cho bé nào!",
    gradient: "from-yellow-100 to-amber-100",
  },
];

export default function Onboarding({ onGetStarted, onLogin }: OnboardingProps) {
  const [step, setStep] = useState(0);
  const current = steps[step];
  const isLast = step === steps.length - 1;

  const handleNext = () => {
    if (isLast) {
      onGetStarted();
    } else {
      setStep((s) => s + 1);
    }
  };

  const handleSkip = () => {
    onGetStarted();
  };

  return (
    <div className="min-h-screen bg-surface flex flex-col">
      {/* Skip button */}
      <div className="px-5 pt-14 flex justify-end">
        <button onClick={handleSkip} className="text-[13px] text-txt-secondary font-semibold px-3 py-1.5">
          Bỏ qua
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col items-center justify-center px-8 -mt-10">
        {/* Icon */}
        <div className={`w-28 h-28 rounded-[32px] bg-gradient-to-br ${current.gradient} flex items-center justify-center mb-8 shadow-lg`}>
          {current.icon}
        </div>

        <h1 className="text-[24px] font-black text-center tracking-tight mb-2">
          {current.title}
        </h1>
        <p className="text-[15px] font-bold text-accent text-center mb-3">
          {current.subtitle}
        </p>
        <p className="text-[14px] text-txt-secondary text-center leading-relaxed max-w-xs">
          {current.description}
        </p>
      </div>

      {/* Bottom */}
      <div className="px-8 pb-12">
        {/* Dots */}
        <div className="flex justify-center gap-2 mb-6">
          {steps.map((_, i) => (
            <div
              key={i}
              className={`h-2 rounded-full transition-all ${
                i === step ? "w-8 bg-accent" : "w-2 bg-gray-300"
              }`}
            />
          ))}
        </div>

        {/* Actions */}
        {isLast ? (
          <div className="space-y-2.5">
            <button
              onClick={onGetStarted}
              className="w-full py-4 rounded-2xl bg-gradient-to-r from-accent to-pink-500 text-white text-[15px] font-bold flex items-center justify-center gap-2 active:scale-[0.98] transition-transform shadow-lg"
            >
              <Sparkles size={18} /> Bắt Đầu Ngay
            </button>
            <button
              onClick={onLogin}
              className="w-full py-4 rounded-2xl bg-white text-txt text-[15px] font-bold flex items-center justify-center gap-2 active:scale-[0.98] transition-transform border border-gray-200"
            >
              Đã có tài khoản? Đăng nhập
            </button>
          </div>
        ) : (
          <button
            onClick={handleNext}
            className="w-full py-4 rounded-2xl bg-gradient-to-r from-accent to-pink-500 text-white text-[15px] font-bold flex items-center justify-center gap-2 active:scale-[0.98] transition-transform shadow-lg"
          >
            Tiếp tục <ChevronRight size={18} />
          </button>
        )}
      </div>
    </div>
  );
}
