import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/voice/defaults?language=vi
 * Returns active default voices for a language (or all).
 *
 * POST /api/voice/defaults  (admin only)
 * Body: { voice_id, name, language, description?, preview_url?, gender? }
 *
 * DELETE /api/voice/defaults?id=uuid  (admin only)
 */

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const language = request.nextUrl.searchParams.get("language");

  let query = supabase
    .from("default_voices")
    .select("*")
    .eq("is_active", true)
    .order("language")
    .order("sort_order", { ascending: true });

  if (language) {
    query = query.eq("language", language);
  }

  const { data, error } = await query;
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ voices: data ?? [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Admin check
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (!profile || !["admin", "super_admin"].includes(profile.role)) {
    return Response.json({ error: "Admin only" }, { status: 403 });
  }

  const body = await request.json();
  const { voice_id, name, language, description, preview_url, gender } = body;

  if (!voice_id || !name || !language) {
    return Response.json(
      { error: "voice_id, name, and language are required" },
      { status: 400 }
    );
  }

  // Get max sort_order for this language
  const { data: existing } = await supabase
    .from("default_voices")
    .select("sort_order")
    .eq("language", language)
    .order("sort_order", { ascending: false })
    .limit(1);

  const nextOrder = (existing?.[0]?.sort_order ?? -1) + 1;

  const { data, error } = await supabase
    .from("default_voices")
    .upsert(
      {
        voice_id,
        name,
        language,
        description: description || null,
        preview_url: preview_url || null,
        gender: gender || null,
        sort_order: nextOrder,
        is_active: true,
      },
      { onConflict: "voice_id,language" }
    )
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ voice: data });
}

export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Admin check
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (!profile || !["admin", "super_admin"].includes(profile.role)) {
    return Response.json({ error: "Admin only" }, { status: 403 });
  }

  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return Response.json({ error: "id required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("default_voices")
    .delete()
    .eq("id", id);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ ok: true });
}
