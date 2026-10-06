/**
 * 3D clay icons (UI v2, ticket UI-03) — replace category emoji.
 * Assets: public/icons/3d/<name>.webp (192×192, ~4–6 KB each, rounded tile baked in).
 */
export const ICON3D_NAMES = [
  "books",
  "book",
  "castle",
  "rocket",
  "moon",
  "paw",
  "blocks",
  "wand",
  "brush",
  "lotus",
  "lantern",
  "mic",
  "chest",
  "shield",
  "headphones",
  "gift",
] as const;

export type Icon3DName = (typeof ICON3D_NAMES)[number];

/** Story / filter category id → 3D icon. Covers both English and legacy Vietnamese ids. */
const CATEGORY_ICON: Record<string, Icon3DName> = {
  all: "books",
  fairy_tale: "castle",
  cotich: "castle",
  adventure: "rocket",
  phieuluu: "rocket",
  bedtime: "moon",
  ngungon: "moon",
  lullaby: "moon",
  animal: "paw",
  dongvat: "paw",
  educational: "blocks",
  ai: "wand",
  custom: "brush",
  folk: "lotus",
  festival: "lantern",
};

export function categoryIcon(category: string | null | undefined): Icon3DName {
  return (category && CATEGORY_ICON[category]) || "book";
}

export function icon3dSrc(name: Icon3DName): string {
  return `/icons/3d/${name}.webp`;
}

interface Icon3DProps {
  name: Icon3DName;
  size?: number;
  /** Accessible name; omit for decorative icons next to a text label. */
  label?: string;
  className?: string;
}

export function Icon3D({ name, size = 40, label, className = "" }: Icon3DProps) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- tiny static asset
    <img
      src={icon3dSrc(name)}
      alt={label ?? ""}
      aria-hidden={label ? undefined : true}
      width={size}
      height={size}
      draggable={false}
      decoding="async"
      loading="lazy"
      className={`inline-block shrink-0 select-none ${className}`}
      data-icon3d={name}
    />
  );
}

export function CategoryIcon({
  category,
  ...rest
}: Omit<Icon3DProps, "name"> & { category: string | null | undefined }) {
  return <Icon3D name={categoryIcon(category)} {...rest} />;
}
