"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { ArrowRight, MoonStars, Sparkles, Star } from "@/components/ui/icons";
import { Bubble, Button3D, TrustChips } from "@/components/ui/kit";
import Mascot, { type MascotState } from "@/components/ui/Mascot";
import { takeEarlyClick } from "@/lib/early-clicks";

interface OnboardingProps {
 onGetStarted: () => void;
 onLogin: () => void;
}

/**
 * Onboarding v2 (UI-07): Đóm dẫn đường qua 3 bước (concept board screen 1), nền kem ấm, chữ ink,
 * CTA cam. Tiêu đề h1 + nhãn nút được E2E smoke test sử dụng — giữ nguyên.
 */
const steps: {
 mascot: MascotState;
 /** Plain title (accessible name, dots). */
 title: string;
 /** Title split around the indigo emphasis (concept board `.onb h2 em`). */
 lead: string;
 em: string;
 tail: string;
 description: string;
 bubble?: string;
}[] = [
 {
 mascot: "hello",
 title: "Mỗi tối, Đóm thắp sáng một câu chuyện cho bé",
 lead: "Mỗi tối, Đóm thắp sáng ",
 em: "một câu chuyện",
 tail: " cho bé",
 description: "Cổ tích Việt Nam, truyện bé tự sáng tạo — và cả giọng kể của bố mẹ.",
 bubble: "Chào bé! Tớ là",
 },
 {
 mascot: "listen",
 title: "Nghe truyện bằng giọng bố mẹ",
 lead: "Nghe truyện bằng ",
 em: "giọng bố mẹ",
 tail: "",
 description: "Ghi âm khoảng một phút, Đóm học giọng — bé được nghe truyện bằng giọng người thân yêu nhất.",
 },
 {
 mascot: "celebrate",
 title: "An toàn, không quảng cáo",
 lead: "An toàn, ",
 em: "không quảng cáo",
 tail: "",
 description: "Bố mẹ đặt giờ ngủ, giới hạn thời gian và duyệt truyện. Dữ liệu của bé luôn được bảo vệ.",
 },
];

export default function Onboarding({ onGetStarted, onLogin }: OnboardingProps) {
 const [step, setStep] = useState(0);
 const [direction, setDirection] = useState<"next" | "prev">("next");
 const [animating, setAnimating] = useState(false);
 const contentRef = useRef<HTMLDivElement>(null);
 const current = steps[step];
 const isLast = step === steps.length - 1;

 const transition = useCallback((newStep: number) => {
 if (animating) return;
 setDirection(newStep > step ? "next" : "prev");
 setAnimating(true);
 setTimeout(() => {
 setStep(newStep);
 setAnimating(false);
 }, 250);
 }, [step, animating]);

 const handleNext = () => {
 if (isLast) onGetStarted();
 else transition(step + 1);
 };

 // Replay a tap made on the server-rendered markup before hydration, as if it
 // happened now (next task). That markup is always step 0, so "next" means
 // step 1; every action is idempotent. No cleanup: the tap is consumed once.
 useEffect(() => {
 const early = takeEarlyClick();
 if (!early) return;
 window.setTimeout(() => {
 if (early === "skip") onGetStarted();
 else if (early === "login") onLogin();
 else if (early === "next") setStep(1);
 else if (early.startsWith("dot-")) {
 const i = Number(early.slice(4));
 if (Number.isInteger(i) && i >= 0 && i < steps.length) setStep(i);
 }
 }, 0);
 // Mount only: the SSR snapshot is gone after the first replay.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, []);

 // Swipe support
 const touchRef = useRef({ x: 0, y: 0 });
 const onTouchStart = (e: React.TouchEvent) => {
 touchRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
 };
 const onTouchEnd = (e: React.TouchEvent) => {
 const dx = e.changedTouches[0].clientX - touchRef.current.x;
 const dy = e.changedTouches[0].clientY - touchRef.current.y;
 if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 50) {
 if (dx < 0 && step < steps.length - 1) transition(step + 1);
 if (dx > 0 && step > 0) transition(step - 1);
 }
 };

 return (
 <div
 className="relative flex min-h-screen flex-col overflow-hidden bg-cream px-[26px] pb-10 pt-12 text-ink"
 onTouchStart={onTouchStart}
 onTouchEnd={onTouchEnd}
 >
 {/* Decorations (board `.deco`) */}
 <Star aria-hidden size={26} weight="fill" className="absolute left-[30px] top-[130px] text-brand-ink opacity-[0.16]" />
 <MoonStars aria-hidden size={34} weight="fill" className="absolute left-[60px] top-[280px] text-brand-ink opacity-[0.16]" />
 <Sparkles aria-hidden size={28} weight="fill" className="absolute right-[40px] top-[340px] text-brand-ink opacity-[0.16]" />

 <div className="relative z-20 flex justify-end">
 <button type="button" onClick={onGetStarted} data-early-click="skip" className="min-h-tap-min px-1 text-[16px] font-extrabold text-ink-2 active:scale-95">
 Bỏ qua
 </button>
 </div>

 <div
 ref={contentRef}
 className={`relative z-10 flex flex-1 flex-col items-center transition-all duration-250 ${
 animating ? (direction === "next" ? "translate-x-8 opacity-0" : "-translate-x-8 opacity-0") : "translate-x-0 opacity-100"
 }`}
 >
 {/* Đóm in the firefly halo (board `.halo`) */}
 <div className="relative mt-3 flex h-[270px] w-[270px] items-center justify-center rounded-full bg-[radial-gradient(circle,#FFE7A6_0%,#FFF1CF_45%,rgba(255,248,238,0)_72%)]">
 <Mascot key={current.mascot} state={current.mascot} size={210} priority />
 {current.bubble && (
 <Bubble tail="bottom" className="absolute -right-6 top-6 rotate-3 whitespace-nowrap text-[18px]">
 {current.bubble} <b className="text-brand-ink">Đóm</b>
 </Bubble>
 )}
 </div>

 <h1 className="mt-4 text-center font-display text-[31px] font-extrabold leading-[1.15] text-ink">
 {current.lead}
 <em className="not-italic text-brand-ink">{current.em}</em>
 {current.tail}
 </h1>
 <p className="mt-3 max-w-[330px] text-center text-[17px] font-bold leading-normal text-ink-2">{current.description}</p>
 </div>

 <div className="relative z-10">
 {/* Dots (board `.dots`) */}
 {/* UI-12: 44px hit areas (WCAG 2.5.8), same visual spacing as the board. */}
 <div className="mb-3 mt-3.5 flex justify-center">
 {steps.map((st, i) => (
 <button
 key={i}
 type="button"
 onClick={() => transition(i)}
 data-early-click={`dot-${i}`}
 aria-label={`Bước ${i + 1}: ${st.title}`}
 aria-current={i === step ? "step" : undefined}
 className="flex h-11 min-w-11 items-center justify-center px-1"
 >
 <span className={`block h-2.5 rounded-md transition-all duration-300 ${i === step ? "w-[30px] bg-brand" : "w-2.5 bg-[#DCD5F5]"}`} />
 </button>
 ))}
 </div>

 <Button3D block onClick={handleNext} data-early-click="next">
 {step === 0 ? "Bắt đầu nào!" : isLast ? "Tạo tài khoản cho bé" : "Tiếp tục"} <ArrowRight size={22} />
 </Button3D>
 <p className="mt-[18px] text-center text-[16px] font-bold text-ink-2">
 Bố mẹ đã có tài khoản?{" "}
 <button type="button" onClick={onLogin} data-early-click="login" className="min-h-[40px] font-extrabold text-brand-ink">
 Đăng nhập
 </button>
 </p>
 <TrustChips className="mt-4" />
 </div>
 </div>
 );
}
