"use client";

import { useState, type ReactNode } from "react";
import { CategoryIcon } from "@/components/ui/Icon3D";
import { storyThumbCandidates, type ThumbFields } from "@/lib/story-thumb";

/**
 * PR #49 — story card picture: small generated thumbnail → scene → cover →
 * the topic icon (or a custom fallback). Lazy, async-decoded, never blocks.
 */
export default function StoryThumb({
  story,
  category,
  className = "",
  tint = "bg-brand-soft",
  iconSize = 64,
  fallback,
  eager = false,
}: {
  story: ThumbFields;
  category?: string | null;
  className?: string;
  tint?: string;
  iconSize?: number;
  fallback?: ReactNode;
  eager?: boolean;
}) {
  const candidates = storyThumbCandidates(story);
  const key = candidates.join("|");
  const [failed, setFailed] = useState<{ key: string; count: number }>({ key, count: 0 });
  const skip = failed.key === key ? failed.count : 0;
  const src = candidates[skip];
  if (!src && fallback) return <>{fallback}</>;
  return (
    <span
      data-thumb={src ? "image" : "icon"}
      className={`relative flex shrink-0 items-center justify-center overflow-hidden ${src ? "bg-[#EEEAF8]" : tint} ${className}`}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={src}
          src={src}
          alt=""
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          draggable={false}
          onError={() => setFailed({ key, count: skip + 1 })}
          className="h-full w-full object-cover"
        />
      ) : (
        <CategoryIcon category={category} size={iconSize} />
      )}
    </span>
  );
}
