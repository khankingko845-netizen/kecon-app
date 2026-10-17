import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FAMILY_AVATARS, familyAvatarFor, customAvatarUrl } from "@/lib/family-avatar";

describe("family mascot avatars", () => {
  it("has six distinct labelled, locally bundled portraits", () => {
    expect(FAMILY_AVATARS).toHaveLength(6);
    expect(new Set(FAMILY_AVATARS.map((a) => a.id)).size).toBe(6);
    for (const avatar of FAMILY_AVATARS) {
      expect(avatar.label).toMatch(/Đóm/);
      expect(existsSync(join(process.cwd(), "public", avatar.src))).toBe(true);
      expect(familyAvatarFor(avatar.src).id).toBe(avatar.id);
    }
  });
  it("has a branded default for empty/invalid values, maps old emoji without changing the record", () => {
    for (const url of [null, undefined, "", "/missing.webp", "javascript:alert(1)"]) {
      expect(familyAvatarFor(url).id).toBe("hello");
    }
    expect(familyAvatarFor(null, "🐰").id).toBe("happy");
    expect(familyAvatarFor(null, "👨‍👩‍👧").id).toBe("hello");
    expect(familyAvatarFor("/mascot/dom-story.webp", "🐰").id).toBe("story");
  });
  it("preserves existing https photos, rejects unsafe URLs and doesn't treat presets as custom", () => {
    expect(customAvatarUrl("https://example.com/photo.jpg")).toBe("https://example.com/photo.jpg");
    for (const url of [null, "/mascot/dom-hello.webp", "javascript:alert(1)", "//evil.test/a", "data:text/html,hi", "https:"]) {
      expect(customAvatarUrl(url)).toBeNull();
    }
  });
});
