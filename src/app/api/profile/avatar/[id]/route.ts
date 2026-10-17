import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AVATAR_BUCKET, AVATAR_ID, avatarUrl } from "@/lib/avatar-path";
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: NextRequest, context: Context) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  if (!AVATAR_ID.test(id))
    return Response.json({ error: "Not found" }, { status: 404 });
  const { data, error } = await supabase.storage
    .from(AVATAR_BUCKET)
    .download(`${user.id}/${id}.webp`);
  if (error || !data)
    return Response.json({ error: "Not found" }, { status: 404 });
  return new Response(data, {
    headers: {
      "Content-Type": "image/webp",
      "Cache-Control": "private, no-store",
      Vary: "Cookie",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
export async function DELETE(request: NextRequest, context: Context) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (request.headers.get("sec-fetch-site") === "cross-site")
    return Response.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await context.params;
  if (!AVATAR_ID.test(id))
    return Response.json({ error: "Not found" }, { status: 404 });
  const profile = await supabase
    .from("profiles")
    .select("avatar_url")
    .eq("id", user.id)
    .single();
  if (profile.error)
    return Response.json(
      { error: "Không kiểm tra được hồ sơ." },
      { status: 503 },
    );
  if (profile.data.avatar_url === avatarUrl(id))
    return Response.json(
      { error: "Ảnh vẫn đang được sử dụng." },
      { status: 409 },
    );
  const { error } = await supabase.storage
    .from(AVATAR_BUCKET)
    .remove([`${user.id}/${id}.webp`]);
  return error
    ? Response.json({ error: "Chưa xoá được ảnh." }, { status: 503 })
    : Response.json({ ok: true });
}
