/**
 * Admin v2 · A-02 — phân quyền theo quyền hạn (RBAC).
 *
 * The database is the source of truth (migration 019: `admin_roles`,
 * `admin_permissions`, `admin_role_permissions`, `has_permission()`); this file
 * mirrors the catalog for the UI (labels, role picker) and typed checks in API
 * routes. `tests/db/admin-rbac.test.ts` fails if the two drift apart.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export const ADMIN_PERMISSIONS = [
  "dashboard.view",
  "stories.read",
  "stories.write",
  "categories.manage",
  "templates.manage",
  "users.read",
  "roles.manage",
  "analytics.view",
  "settings.read",
  "settings.write",
  "secrets.manage",
  "voices.manage",
  "moderation.manage",
  "notifications.send",
  "audit.read",
] as const;
export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

/** Staff roles, in display order. `admin` / `super_admin` are the legacy roles. */
export const STAFF_ROLES = ["super_admin", "admin", "ops", "editor", "moderator", "support", "analyst"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];
export type UserRole = "user" | StaffRole;

export const ROLE_LABELS: Record<UserRole, string> = {
  user: "Người dùng",
  super_admin: "Super admin",
  admin: "Admin (đầy đủ)",
  ops: "Vận hành",
  editor: "Biên tập",
  moderator: "Kiểm duyệt",
  support: "Hỗ trợ",
  analyst: "Phân tích",
};

const ALL = ADMIN_PERMISSIONS;
export const ROLE_PERMISSIONS: Record<StaffRole, readonly AdminPermission[]> = {
  super_admin: ALL,
  // Legacy admin keeps what it could do before A-02: everything but changing roles.
  admin: ALL.filter((p) => p !== "roles.manage"),
  ops: ["dashboard.view", "analytics.view", "settings.read", "settings.write", "voices.manage", "notifications.send"],
  editor: ["dashboard.view", "stories.read", "stories.write", "categories.manage", "templates.manage"],
  moderator: ["dashboard.view", "stories.read", "moderation.manage"],
  support: ["dashboard.view", "users.read"],
  analyst: ["dashboard.view", "analytics.view"],
};

export function isStaffRole(role: unknown): role is StaffRole {
  return typeof role === "string" && (STAFF_ROLES as readonly string[]).includes(role);
}

export function isAdminPermission(value: unknown): value is AdminPermission {
  return typeof value === "string" && (ADMIN_PERMISSIONS as readonly string[]).includes(value);
}

/** Server check through `has_permission()` (same function the RLS policies use). Fails closed. */
export async function hasPermission(supabase: SupabaseClient, permission: AdminPermission): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc("has_permission", { p_permission: permission });
    return !error && data === true;
  } catch {
    return false;
  }
}

/** The caller's permissions (`my_admin_permissions()`), unknown keys dropped. Fails closed → []. */
export async function myPermissions(supabase: SupabaseClient): Promise<AdminPermission[]> {
  try {
    const { data, error } = await supabase.rpc("my_admin_permissions");
    if (error || !Array.isArray(data)) return [];
    return data.filter(isAdminPermission);
  } catch {
    return [];
  }
}

/**
 * Guard for `/api/admin/*`-style handlers: 401 without a session, 403 without
 * the permission, otherwise `null` (continue).
 */
export async function requirePermission(
  supabase: SupabaseClient,
  permission: AdminPermission
): Promise<Response | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await hasPermission(supabase, permission))) {
    return Response.json({ error: "Forbidden", code: "missing_permission", permission }, { status: 403 });
  }
  return null;
}
