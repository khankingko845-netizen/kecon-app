"use client";

import { useState } from "react";
import { Star } from "lucide-react";

interface RatingStarsProps {
  value: number; // 0-5, can be fractional for display
  onChange?: (value: number) => void;
  size?: number;
  readonly?: boolean;
  showValue?: boolean;
  dark?: boolean;
}

export default function RatingStars({
  value,
  onChange,
  size = 24,
  readonly = false,
  showValue = false,
  dark = false,
}: RatingStarsProps) {
  const [hovered, setHovered] = useState(0);
  const displayValue = hovered || value;

  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((star) => {
        const filled = displayValue >= star;
        const halfFilled = !filled && displayValue >= star - 0.5;
        return (
          <button
            key={star}
            type="button"
            disabled={readonly}
            onClick={() => onChange?.(star)}
            onMouseEnter={() => !readonly && setHovered(star)}
            onMouseLeave={() => !readonly && setHovered(0)}
            className={`shrink-0 transition-transform ${
              readonly ? "cursor-default" : "cursor-pointer active:scale-90"
            }`}
          >
            <Star
              size={size}
              className={
                filled
                  ? "text-amber-400"
                  : halfFilled
                  ? "text-amber-400/50"
                  : dark
                  ? "text-white/20"
                  : "text-gray-300"
              }
              fill={filled ? "currentColor" : halfFilled ? "currentColor" : "none"}
            />
          </button>
        );
      })}
      {showValue && value > 0 && (
        <span
          className={`ml-1.5 text-sm font-bold ${
            dark ? "text-white/60" : "text-txt-secondary dark:text-white/50"
          }`}
        >
          {value.toFixed(1)}
        </span>
      )}
    </div>
  );
}
