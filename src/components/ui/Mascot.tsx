/**
 * Đóm — the KểCon mascot (UI v2, ticket UI-04).
 *
 * v1 renders one of 8 static poses (public/mascot/dom-*.webp, ~12–22 KB each)
 * with a light CSS animation and the firefly "glow". v2 (UI-05) will swap the
 * image for a Rive state machine behind the same props.
 * Animations stop under `prefers-reduced-motion` (see globals.css).
 */
import type { CSSProperties } from "react";

export const MASCOT_STATES = [
  "hello",
  "happy",
  "story",
  "sleepy",
  "listen",
  "celebrate",
  "oops",
  "thinking",
] as const;

export type MascotState = (typeof MASCOT_STATES)[number];

const ALT: Record<MascotState, string> = {
  hello: "Đóm vẫy tay chào bé",
  happy: "Đóm nhảy lên vui sướng",
  story: "Đóm đang đọc truyện",
  sleepy: "Đóm buồn ngủ, đội mũ ngủ",
  listen: "Đóm đang lắng nghe",
  celebrate: "Đóm ăn mừng với huy chương",
  oops: "Đóm bối rối gãi đầu",
  thinking: "Đóm đang suy nghĩ",
};

const ANIMATION: Record<MascotState, string> = {
  hello: "dom-anim-float",
  happy: "dom-anim-bounce",
  story: "dom-anim-float",
  sleepy: "dom-anim-breathe",
  listen: "dom-anim-breathe",
  celebrate: "dom-anim-bounce",
  oops: "dom-anim-wiggle",
  thinking: "dom-anim-float",
};

const GLOW: Record<MascotState, string> = {
  hello: "",
  happy: "",
  story: "",
  sleepy: "dom-glow-dim",
  listen: "dom-glow-fast",
  celebrate: "",
  oops: "dom-glow-dim",
  thinking: "dom-glow-fast",
};

export function mascotSrc(state: MascotState): string {
  return `/mascot/dom-${state}.webp`;
}

export function mascotAlt(state: MascotState): string {
  return ALT[state];
}

export interface MascotProps {
  state?: MascotState;
  /** Box size in px (the pose is fitted inside, bottom-aligned). */
  size?: number;
  /** Accessible description; pass `null` when the mascot is purely decorative. */
  label?: string | null;
  /** Show the firefly glow behind Đóm. */
  glow?: boolean;
  /** Disable the idle animation (e.g. in lists). */
  still?: boolean;
  /** Load eagerly (above-the-fold usage). */
  priority?: boolean;
  className?: string;
  style?: CSSProperties;
}

export default function Mascot({
  state = "hello",
  size = 160,
  label,
  glow = true,
  still = false,
  priority = false,
  className = "",
  style,
}: MascotProps) {
  const decorative = label === null;
  const alt = decorative ? "" : (label ?? ALT[state]);
  return (
    <span
      className={`relative inline-flex shrink-0 items-end justify-center ${className}`}
      style={{ width: size, height: size, ...style }}
      data-mascot={state}
      aria-hidden={decorative ? true : undefined}
    >
      {glow && <span aria-hidden className={`dom-glow ${GLOW[state]}`} />}
      {/* eslint-disable-next-line @next/next/no-img-element -- static asset, also used in the Capacitor build */}
      <img
        src={mascotSrc(state)}
        alt={alt}
        width={size}
        height={size}
        draggable={false}
        decoding="async"
        loading={priority ? "eager" : "lazy"}
        className={`relative h-full w-full select-none object-contain object-bottom ${still ? "" : ANIMATION[state]}`}
      />
    </span>
  );
}
