/**
 * Đóm's voice lines (UI v2, ticket UI-11).
 *
 * One short line per moment in the child's flow. Personality rules from
 * docs/design/ui-v2/README.md §3: curious, warm, praises specifically, a bit
 * clumsy; speaks as "tớ" to "bé"; ≤ 12 words. Đóm never scares the child,
 * makes them feel at fault, uses sadness to keep them in the app, or pushes
 * purchases (enforced by tests/unit/feedback.test.ts).
 *
 * Lines are shown in Đóm's speech bubble and, when the parent allows it and
 * it is not bedtime, read aloud with the device's Vietnamese voice.
 */
import type { MascotState } from "@/components/ui/Mascot";

export const DOM_MOMENTS = [
  "hello-morning",
  "hello-afternoon",
  "hello-evening",
  "poke",
  "streak",
  "story-end",
  "favorite",
  "thinking",
  "created",
  "listen",
  "oops",
  "empty",
  "parent-only",
  "time-up",
  "bedtime",
] as const;

export type DomMoment = (typeof DOM_MOMENTS)[number];

export interface DomLine {
  moment: DomMoment;
  mascot: MascotState;
  text: string;
  /** Read aloud? `false` when the mic is open (Đóm must not talk over the child). */
  speak: boolean;
}

const line = (moment: DomMoment, mascot: MascotState, text: string, speak = true): DomLine => ({ moment, mascot, text, speak });

export const DOM_LINES: Record<DomMoment, DomLine> = {
  "hello-morning": line("hello-morning", "hello", "Chào buổi sáng! Hôm nay bé muốn nghe truyện gì?"),
  "hello-afternoon": line("hello-afternoon", "happy", "Chào bé! Chiều nay mình cùng phiêu lưu nhé?"),
  "hello-evening": line("hello-evening", "story", "Tối rồi! Bé chọn truyện, tớ thắp đèn kể nhé."),
  poke: line("poke", "happy", "Hi hi, nhột quá! Tớ là Đóm, bạn của bé đây."),
  streak: line("streak", "celebrate", "Bé nghe truyện mấy đêm liền rồi, tuyệt vời quá!"),
  "story-end": line("story-end", "celebrate", "Bé nghe hết cả truyện rồi, giỏi ghê!"),
  favorite: line("favorite", "happy", "Tớ cũng thích truyện này! Đã cất vào Yêu thích."),
  thinking: line("thinking", "thinking", "Tớ đang nghĩ truyện cho bé, chờ tớ chút nhé!"),
  created: line("created", "celebrate", "Xong rồi! Truyện của bé đã sẵn sàng."),
  listen: line("listen", "listen", "Tớ đang lắng nghe đây, bé cứ nói nhé!", false),
  oops: line("oops", "oops", "Tớ vụng quá! Bé bấm thử lại cùng tớ nhé?"),
  empty: line("empty", "hello", "Chỗ này còn trống, mình cùng tìm truyện nhé!"),
  "parent-only": line("parent-only", "thinking", "Chỗ này dành cho bố mẹ, bé nhờ bố mẹ nhé!"),
  "time-up": line("time-up", "sleepy", "Mình nghỉ mắt chút nhé. Mai tớ kể tiếp cho bé!"),
  bedtime: line("bedtime", "sleepy", "Tớ cũng buồn ngủ rồi. Chúc bé ngủ thật ngon!"),
};

export function domLine(moment: DomMoment): DomLine {
  return DOM_LINES[moment];
}

/** Home greeting: praise a 3+ night streak, otherwise greet by local hour. */
export function greetingMoment(hour: number, streak = 0): DomMoment {
  if (streak >= 3) return "streak";
  if (hour >= 5 && hour < 11) return "hello-morning";
  if (hour >= 11 && hour < 18) return "hello-afternoon";
  return "hello-evening";
}

/** Words as a child hears them (punctuation ignored). */
export function wordCount(text: string): number {
  return text.split(/\s+/).filter((w) => /\p{L}/u.test(w)).length;
}
