"use client";

import { useState } from "react";
import { customAvatarUrl, familyAvatarFor } from "@/lib/family-avatar";

/** Static portrait badge, deliberately unaffected by the child's mascot scale or animation. */
export default function FamilyAvatar({
  avatarUrl, emoji, size = 56, label, className = "",
}: {
  avatarUrl?: string | null;
  emoji?: string | null;
  size?: number;
  label?: string | null;
  className?: string;
}) {
  const preset = familyAvatarFor(avatarUrl, emoji);
  const custom = customAvatarUrl(avatarUrl);
  const src = custom ?? preset.src;
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const isPhoto = Boolean(custom && failedSrc !== src);
  const decorative = label === null;
  return (
    <span
      data-family-avatar={isPhoto ? "custom" : preset.id}
      aria-hidden={decorative ? true : undefined}
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border-2 ${className}`}
      style={{ width: size, height: size, backgroundColor: preset.tint, borderColor: preset.rim }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- bundled portraits also work in Capacitor */}
      <img
        src={failedSrc === src ? preset.src : src}
        alt={decorative ? "" : label ?? (isPhoto ? "Ảnh đại diện gia đình" : preset.label)}
        width={size}
        height={size}
        draggable={false}
        decoding="async"
        onError={() => setFailedSrc(src)}
        className={isPhoto ? "h-full w-full object-cover" : "h-[88%] w-[88%] object-contain"}
      />
    </span>
  );
}
