/**
 * Admin v2 · A-01 — the admin console lives on its own route (`/admin/<slug>`),
 * outside the kid SPA. This module maps the legacy `Screen` ids used by the
 * existing admin screens to URLs, so both the server guard (validates the slug)
 * and the client shell (sidebar, in-app links) share one source of truth.
 */
import type { Screen } from "@/lib/types";

export type AdminScreen =
  | "admin"
  | "admin-stories"
  | "admin-users"
  | "admin-analytics"
  | "admin-categories"
  | "admin-templates"
  | "admin-settings";

export interface AdminSection {
  /** URL segment after `/admin` ("" = dashboard). */
  slug: string;
  screen: AdminScreen;
  label: string;
}

export const ADMIN_BASE_PATH = "/admin";

export const ADMIN_SECTIONS: readonly AdminSection[] = [
  { slug: "", screen: "admin", label: "Tổng quan" },
  { slug: "stories", screen: "admin-stories", label: "Truyện" },
  { slug: "users", screen: "admin-users", label: "Người dùng" },
  { slug: "analytics", screen: "admin-analytics", label: "Thống kê" },
  { slug: "categories", screen: "admin-categories", label: "Danh mục" },
  { slug: "templates", screen: "admin-templates", label: "Mẫu truyện" },
  { slug: "settings", screen: "admin-settings", label: "Cài đặt hệ thống" },
];

const BY_SCREEN = new Map<string, AdminSection>(ADMIN_SECTIONS.map((s) => [s.screen, s]));
const BY_SLUG = new Map<string, AdminSection>(ADMIN_SECTIONS.map((s) => [s.slug, s]));

export function isAdminScreen(screen: Screen | string): screen is AdminScreen {
  return BY_SCREEN.has(screen);
}

/** `/admin` for the dashboard, `/admin/<slug>` for a section. */
export function adminPath(screen: AdminScreen): string {
  const slug = BY_SCREEN.get(screen)?.slug ?? "";
  return slug ? `${ADMIN_BASE_PATH}/${slug}` : ADMIN_BASE_PATH;
}

/**
 * Resolve the optional catch-all `[[...section]]` segments. Only a known single
 * segment (or none) is valid — anything else is a 404, like a missing page.
 */
export function sectionFromSegments(segments: readonly string[] | undefined): AdminSection | null {
  if (!segments || segments.length === 0) return BY_SLUG.get("") ?? null;
  if (segments.length !== 1 || !segments[0]) return null;
  return BY_SLUG.get(segments[0]) ?? null;
}
