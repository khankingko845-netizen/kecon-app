import sharp from "sharp";
import { MAX_AVATAR_BYTES } from "@/lib/avatar-path";
export { MAX_AVATAR_BYTES, avatarIdFromUrl } from "@/lib/avatar-path";
/** Decode actual raster bytes (not MIME/extension); rotate, square crop, strip metadata. */
export async function normalizeAvatarImage(bytes: Buffer): Promise<Buffer> {
  if (!bytes.length || bytes.length > MAX_AVATAR_BYTES)
    throw new Error("Ảnh cần nhỏ hơn hoặc bằng 5 MB.");
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes
    .subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const webp =
    bytes.subarray(0, 4).toString() === "RIFF" &&
    bytes.subarray(8, 12).toString() === "WEBP";
  if (!jpeg && !png && !webp)
    throw new Error(
      "Chọn ảnh JPG, PNG hoặc WebP. Không nhận SVG hay tệp khác.",
    );
  try {
    const image = sharp(bytes, {
      limitInputPixels: 25_000_000,
      animated: false,
    });
    const meta = await image.metadata();
    if (!meta.width || !meta.height || (meta.pages ?? 1) > 1)
      throw new Error("invalid image");
    return await image
      .rotate()
      .resize(512, 512, { fit: "cover" })
      .webp({ quality: 85 })
      .toBuffer();
  } catch {
    throw new Error(
      "Ảnh không đọc được hoặc quá lớn về độ phân giải. Hãy chọn ảnh khác.",
    );
  }
}
