import type { MascotState } from "@/components/ui/Mascot";

export interface HomeHero {
  title: string;
  mascot: MascotState;
  cta: string;
  /** After midnight the hero CTA opens Ru ngủ instead of a story. */
  lullaby: boolean;
}

/** Home hero card copy + Đóm pose by local hour (concept board "Home bé"). */
export function heroFor(hour: number): HomeHero {
  if (hour < 6) return { title: "Khuya rồi, mình nghe nhạc ru nhé?", mascot: "sleepy", cta: "Nghe nhạc ru", lullaby: true };
  if (hour < 11) return { title: "Sáng nay bé muốn nghe truyện gì?", mascot: "hello", cta: "Đóm gợi ý cho bé", lullaby: false };
  if (hour < 18) return { title: "Chiều nay cùng Đóm phiêu lưu nhé?", mascot: "happy", cta: "Đóm gợi ý cho bé", lullaby: false };
  return { title: "Tối nay mình nghe truyện gì nhỉ?", mascot: "story", cta: "Đóm gợi ý cho bé", lullaby: false };
}
