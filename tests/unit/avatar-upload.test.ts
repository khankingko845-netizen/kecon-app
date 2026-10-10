import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  normalizeAvatarImage,
  MAX_AVATAR_BYTES,
  avatarIdFromUrl,
} from "@/lib/avatar-upload";
describe("private family photos", () => {
  it("normalizes to bounded WebP and strips EXIF", async () => {
    const image = await sharp({
      create: { width: 80, height: 60, channels: 3, background: "#eee" },
    })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    const out = await normalizeAvatarImage(image);
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.width).toBe(512);
    expect(meta.height).toBe(512);
    expect(meta.exif).toBeUndefined();
  });
  it("rejects oversized, corrupt, SVG and non-image bytes", async () => {
    for (const b of [
      Buffer.alloc(MAX_AVATAR_BYTES + 1),
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
      Buffer.from("not a photo"),
    ])
      await expect(normalizeAvatarImage(b)).rejects.toThrow();
  });
  it("extracts only a safe same-origin object id", () => {
    expect(
      avatarIdFromUrl(
        "/api/profile/avatar/11111111-1111-4111-8111-111111111111",
      ),
    ).toBe("11111111-1111-4111-8111-111111111111");
    for (const v of [
      "https://evil.test/api/profile/avatar/x",
      "/api/profile/avatar/../x",
      "blob:test",
      null,
    ])
      expect(avatarIdFromUrl(v)).toBeNull();
  });
});
