import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { ADMIN_SECTIONS, adminPath, isAdminScreen, sectionFromSegments } from "@/lib/admin-routes";
import { isAdminRole, resolveAdminViewer } from "@/lib/admin-guard";
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

function fakeSupabase({ user, role, authError, profileError }: {
  user?: { id: string; email?: string } | null;
  role?: string | null;
  authError?: boolean;
  profileError?: boolean;
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
  return { client: { auth: { getUser }, from } as unknown as SupabaseClient, from, eq };
}

describe("resolveAdminViewer (A-01 server guard)", () => {
  it("chưa đăng nhập / token lỗi → null, không tra profiles", async () => {
    const anon = fakeSupabase({ user: null });
    expect(await resolveAdminViewer(anon.client)).toBeNull();
    expect(anon.from).not.toHaveBeenCalled();
    expect(await resolveAdminViewer(fakeSupabase({ authError: true }).client)).toBeNull();
  });

  it("user thường, chưa có hồ sơ, lỗi DB → null", async () => {
    const u = { id: "u1", email: "a@b.c" };
    expect(await resolveAdminViewer(fakeSupabase({ user: u, role: "user" }).client)).toBeNull();
    expect(await resolveAdminViewer(fakeSupabase({ user: u, role: null }).client)).toBeNull();
    expect(await resolveAdminViewer(fakeSupabase({ user: u, role: "admin", profileError: true }).client)).toBeNull();
  });

  it("admin / super_admin → viewer, tra đúng hồ sơ của chính user", async () => {
    const admin = fakeSupabase({ user: { id: "u2", email: "ad@kecon.vn" }, role: "admin" });
    expect(await resolveAdminViewer(admin.client)).toEqual({ id: "u2", email: "ad@kecon.vn", role: "admin" });
    expect(admin.from).toHaveBeenCalledWith("profiles");
    expect(admin.eq).toHaveBeenCalledWith("id", "u2");
    const superAdmin = fakeSupabase({ user: { id: "u3" }, role: "super_admin" });
    expect(await resolveAdminViewer(superAdmin.client)).toEqual({ id: "u3", email: null, role: "super_admin" });
  });

  it("chỉ admin / super_admin là vai trò quản trị", () => {
    expect(["admin", "super_admin"].every(isAdminRole)).toBe(true);
    expect(["user", "editor", "", null, undefined, 1].some(isAdminRole)).toBe(false);
  });
});
