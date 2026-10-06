import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { ADMIN_SECTIONS, adminPath, canOpenSection, isAdminScreen, sectionFromSegments, sectionsFor } from "@/lib/admin-routes";
import { resolveAdminViewer } from "@/lib/admin-guard";
import { ADMIN_PERMISSIONS, ROLE_PERMISSIONS, STAFF_ROLES, isStaffRole, requirePermission } from "@/lib/admin-permissions";
import { exploreFor, AGE_UI } from "@/lib/age-ui";
import type { Screen } from "@/lib/types";

describe("admin routes (A-01)", () => {
  it("dashboard ở /admin, mỗi mục một URL riêng, không trùng", () => {
    expect(adminPath("admin")).toBe("/admin");
    expect(adminPath("admin-users")).toBe("/admin/users");
    expect(adminPath("admin-settings")).toBe("/admin/settings");
    const paths = ADMIN_SECTIONS.map((s) => adminPath(s.screen));
    expect(new Set(paths).size).toBe(ADMIN_SECTIONS.length);
  });

  it("slug hợp lệ ↔ section; còn lại là 404", () => {
    expect(sectionFromSegments(undefined)?.screen).toBe("admin");
    expect(sectionFromSegments([])?.screen).toBe("admin");
    for (const s of ADMIN_SECTIONS) {
      const segments = adminPath(s.screen).split("/").filter(Boolean).slice(1);
      expect(sectionFromSegments(segments)).toEqual(s);
    }
    for (const bad of [["xyz"], ["users", "1"], [""], ["Users"], ["__proto__"], ["constructor"]]) {
      expect(sectionFromSegments(bad)).toBeNull();
    }
  });

  it("nhận diện màn admin", () => {
    expect(isAdminScreen("admin-templates")).toBe(true);
    expect(isAdminScreen("settings")).toBe(false);
    expect(isAdminScreen("home")).toBe(false);
  });

  it("Trang chủ bé không còn giữ ô Quản trị (exploreFor không ưu tiên admin)", () => {
    const items = (["favorites", "upload", "admin"] as Screen[]).map((screen) => ({ screen }));
    expect(exploreFor(items, AGE_UI["3-5"]).map((i) => i.screen)).not.toContain("admin");
  });
});

function fakeSupabase({ user, role, authError, profileError, permissions = [], rpcError }: {
  user?: { id: string; email?: string } | null;
  role?: string | null;
  authError?: boolean;
  profileError?: boolean;
  permissions?: string[];
  rpcError?: boolean;
}) {
  const maybeSingle = vi.fn(async () => ({
    data: profileError || role == null ? null : { role },
    error: profileError ? { message: "boom" } : null,
  }));
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  const getUser = vi.fn(async () => ({
    data: { user: authError ? null : (user ?? null) },
    error: authError ? { message: "bad_jwt" } : null,
  }));
  const rpc = vi.fn(async (name: string, args?: { p_permission?: string }) => {
    if (rpcError) return { data: null, error: { message: "function does not exist" } };
    if (name === "my_admin_permissions") return { data: permissions, error: null };
    if (name === "has_permission") return { data: permissions.includes(args?.p_permission ?? ""), error: null };
    return { data: null, error: { message: "unknown rpc" } };
  });
  return { client: { auth: { getUser }, from, rpc } as unknown as SupabaseClient, from, eq, rpc };
}

const EDITOR = ROLE_PERMISSIONS.editor as unknown as string[];
const ADMIN = ROLE_PERMISSIONS.admin as unknown as string[];

describe("resolveAdminViewer (A-01 guard + A-02 quyền hạn)", () => {
  it("chưa đăng nhập / token lỗi → null, không tra profiles", async () => {
    const anon = fakeSupabase({ user: null });
    expect(await resolveAdminViewer(anon.client)).toBeNull();
    expect(anon.from).not.toHaveBeenCalled();
    expect(await resolveAdminViewer(fakeSupabase({ authError: true }).client)).toBeNull();
  });

  it("user thường, chưa có hồ sơ, lỗi DB → null (không hỏi quyền)", async () => {
    const u = { id: "u1", email: "a@b.c" };
    const plain = fakeSupabase({ user: u, role: "user", permissions: ADMIN });
    expect(await resolveAdminViewer(plain.client)).toBeNull();
    expect(plain.rpc).not.toHaveBeenCalled();
    expect(await resolveAdminViewer(fakeSupabase({ user: u, role: null }).client)).toBeNull();
    expect(await resolveAdminViewer(fakeSupabase({ user: u, role: "admin", profileError: true, permissions: ADMIN }).client)).toBeNull();
  });

  it("vai trò nhân sự + quyền từ DB → viewer; tra đúng hồ sơ của chính user", async () => {
    const admin = fakeSupabase({ user: { id: "u2", email: "ad@kecon.vn" }, role: "admin", permissions: ADMIN });
    expect(await resolveAdminViewer(admin.client)).toEqual({ id: "u2", email: "ad@kecon.vn", role: "admin", permissions: ADMIN });
    expect(admin.from).toHaveBeenCalledWith("profiles");
    expect(admin.eq).toHaveBeenCalledWith("id", "u2");
    const editor = fakeSupabase({ user: { id: "u3" }, role: "editor", permissions: [...EDITOR, "không-có-thật"] });
    expect(await resolveAdminViewer(editor.client)).toEqual({ id: "u3", email: null, role: "editor", permissions: EDITOR });
  });

  it("đóng khi lỗi: RPC quyền lỗi / rỗng → null", async () => {
    const u = { id: "u4" };
    expect(await resolveAdminViewer(fakeSupabase({ user: u, role: "super_admin", rpcError: true }).client)).toBeNull();
    expect(await resolveAdminViewer(fakeSupabase({ user: u, role: "editor", permissions: [] }).client)).toBeNull();
  });

  it("vai trò nhân sự: 7 vai trò, user không phải", () => {
    expect(STAFF_ROLES.every(isStaffRole)).toBe(true);
    expect(["user", "", null, undefined, 1, "root"].some(isStaffRole)).toBe(false);
  });
});

describe("quyền theo mục (A-02)", () => {
  it("biên tập chỉ thấy Tổng quan, Truyện, Danh mục, Mẫu truyện", () => {
    expect(sectionsFor(EDITOR).map((s) => s.label)).toEqual(["Tổng quan", "Truyện", "Danh mục", "Mẫu truyện"]);
    expect(canOpenSection("admin-settings", EDITOR)).toBe(false);
    expect(canOpenSection("admin-users", EDITOR)).toBe(false);
    expect(canOpenSection("admin-templates", EDITOR)).toBe(true);
  });

  it("admin cũ + super admin thấy đủ 8 mục (kể cả Nhật ký); phân tích chỉ Tổng quan + Thống kê", () => {
    expect(ADMIN_SECTIONS).toHaveLength(8);
    expect(sectionsFor(ADMIN)).toHaveLength(ADMIN_SECTIONS.length);
    expect(adminPath("admin-audit")).toBe("/admin/audit");
    expect(sectionsFor(ROLE_PERMISSIONS.super_admin)).toHaveLength(ADMIN_SECTIONS.length);
    expect(sectionsFor(ROLE_PERMISSIONS.analyst).map((s) => s.screen)).toEqual(["admin", "admin-analytics"]);
  });

  it("mỗi vai trò mới đều có dashboard.view; chỉ super admin đổi được vai trò; không vai trò hẹp nào có secrets.manage", () => {
    for (const role of STAFF_ROLES) expect(ROLE_PERMISSIONS[role]).toContain("dashboard.view");
    expect(STAFF_ROLES.filter((r) => ROLE_PERMISSIONS[r].includes("roles.manage"))).toEqual(["super_admin"]);
    expect(STAFF_ROLES.filter((r) => ROLE_PERMISSIONS[r].includes("secrets.manage"))).toEqual(["super_admin", "admin"]);
    // A-03: chỉ super admin + admin đọc được nhật ký thao tác.
    expect(STAFF_ROLES.filter((r) => ROLE_PERMISSIONS[r].includes("audit.read"))).toEqual(["super_admin", "admin"]);
    expect(canOpenSection("admin-audit", EDITOR)).toBe(false);
    expect([...ROLE_PERMISSIONS.super_admin].sort()).toEqual([...ADMIN_PERMISSIONS].sort());
  });
});

describe("requirePermission (API)", () => {
  it("401 khi chưa đăng nhập, 403 khi thiếu quyền, null khi đủ", async () => {
    expect((await requirePermission(fakeSupabase({ user: null }).client, "voices.manage"))?.status).toBe(401);
    const editor = fakeSupabase({ user: { id: "e" }, role: "editor", permissions: EDITOR });
    const res = await requirePermission(editor.client, "secrets.manage");
    expect(res?.status).toBe(403);
    expect(await res!.json()).toMatchObject({ code: "missing_permission", permission: "secrets.manage" });
    expect(await requirePermission(editor.client, "stories.write")).toBeNull();
    expect(editor.rpc).toHaveBeenCalledWith("has_permission", { p_permission: "stories.write" });
    expect((await requirePermission(fakeSupabase({ user: { id: "x" }, rpcError: true }).client, "voices.manage"))?.status).toBe(403);
  });
});
