import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { normalizeAvatarImage } from "@/lib/avatar-upload";
import { AVATAR_BUCKET, MAX_AVATAR_BYTES, avatarUrl } from "@/lib/avatar-path";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (request.headers.get("sec-fetch-site") === "cross-site")
    return Response.json({ error: "Forbidden" }, { status: 403 });
  const type = request.headers.get("content-type") ?? "";
  if (!type.startsWith("multipart/form-data"))
    return Response.json(
      { error: "Gửi ảnh dạng multipart/form-data." },
      { status: 415 },
    );
  // Bound the entire multipart stream before parsing, even without Content-Length.
  const limit = MAX_AVATAR_BYTES + 128 * 1024;
  const reader = request.body?.getReader();
  if (!reader) return Response.json({ error: "Chưa có ảnh." }, { status: 400 });
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        await reader.cancel();
        return Response.json({ error: "Ảnh tối đa 5 MB." }, { status: 413 });
      }
      parts.push(value);
    }
    const bytes = Buffer.concat(parts);
    const form = await new Request("http://local/upload", {
      method: "POST",
      headers: { "content-type": type },
      body: bytes,
    }).formData();
    const file = form.get("file");
    if (!(file instanceof File))
      return Response.json({ error: "Chưa có ảnh." }, { status: 400 });
    if (file.size > MAX_AVATAR_BYTES)
      return Response.json({ error: "Ảnh tối đa 5 MB." }, { status: 413 });
    let photo: Buffer;
    try {
      photo = await normalizeAvatarImage(Buffer.from(await file.arrayBuffer()));
    } catch (err) {
      return Response.json(
        { error: err instanceof Error ? err.message : "Ảnh không hợp lệ." },
        { status: 400 },
      );
    }
    const id = randomUUID();
    const { error } = await supabase.storage
      .from(AVATAR_BUCKET)
      .upload(`${user.id}/${id}.webp`, photo, {
        contentType: "image/webp",
        upsert: false,
      });
    if (error)
      return Response.json(
        { error: "Chưa tải được ảnh. Hãy thử lại." },
        { status: 503 },
      );
    return Response.json({ avatarUrl: avatarUrl(id) }, { status: 201 });
  } catch {
    return Response.json(
      { error: "Không đọc hoặc tải được ảnh. Hãy chọn ảnh khác rồi thử lại." },
      { status: 400 },
    );
  }
}
