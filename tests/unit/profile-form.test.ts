/**
 * Hồ sơ gia đình: payload gửi lên `profiles` không được có null ở cột NOT NULL
 * (lỗi thật trên staging: tên gia đình trống → 23502 → tuổi bé không được lưu).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildProfileUpdate } from "@/lib/profile-form";

const base = { displayName: "Mẹ Gấu", familyName: "Gia đình Gấu", avatarEmoji: "🐻", childAge: "4", locale: "vi" };

describe("buildProfileUpdate", () => {
  it("trims names and parses the age", () => {
    expect(buildProfileUpdate({ ...base, displayName: "  Mẹ Gấu ", familyName: " Nhà Mít  ", childAge: "10" })).toEqual({
      display_name: "Mẹ Gấu",
      family_name: "Nhà Mít",
      avatar_emoji: "🐻",
      child_age: 10,
      locale: "vi",
    });
  });

  it("empty names stay empty strings (NOT NULL columns), never null", () => {
    const u = buildProfileUpdate({ ...base, displayName: "  ", familyName: "" });
    expect(u.display_name).toBe("");
    expect(u.family_name).toBe("");
  });

  it("no / invalid age → null; locale falls back to vi", () => {
    expect(buildProfileUpdate({ ...base, childAge: "" }).child_age).toBeNull();
    expect(buildProfileUpdate({ ...base, childAge: "abc" }).child_age).toBeNull();
    expect(buildProfileUpdate({ ...base, childAge: "0" }).child_age).toBeNull();
    expect(buildProfileUpdate({ ...base, childAge: "13" }).child_age).toBeNull();
    expect(buildProfileUpdate({ ...base, locale: "" }).locale).toBe("vi");
  });

  it("every NOT NULL text column of profiles is a string in the payload", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/001_initial_schema.sql"), "utf8");
    const table = /CREATE TABLE[^(]*profiles\s*\(([\s\S]*?)\n\);/i.exec(sql)?.[1] ?? "";
    const notNullText = [...table.matchAll(/^\s*(\w+)\s+TEXT\s+NOT NULL/gim)].map((m) => m[1]);
    expect(notNullText).toEqual(expect.arrayContaining(["family_name", "display_name"]));
    const payload = buildProfileUpdate({ displayName: "", familyName: "", avatarEmoji: "", childAge: "", locale: "" }) as unknown as Record<string, unknown>;
    for (const col of notNullText) if (col in payload) expect(typeof payload[col]).toBe("string");
  });
});
