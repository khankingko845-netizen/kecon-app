import { importLibraryVoice } from "@/lib/voice-import";
import { fetchVoiceById } from "@/lib/voice-catalog";
import { voiceKeyPool, keyPoolErrorResponse } from "@/lib/key-pool";
import { voiceMatchesLanguage } from "@/lib/voice-selection";
import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/admin-permissions";
import { auditAdmin } from "@/lib/admin-audit";
import { z } from "zod";
import {
  optionalText,
  parseJsonBody,
  requiredText,
  uuid,
} from "@/lib/api-validation";
import { normalizeVoiceLanguage } from "@/lib/voice-selection";
import { VOICE_ID_PATTERN } from "@/lib/provider-keys";

const DefaultVoiceBody = z.object({
  // ElevenLabs voice id, or `fish:<id>` for a Fish Audio voice (A-04b).
  voice_id: requiredText(120).regex(VOICE_ID_PATTERN, "voice_id không hợp lệ"),
  name: requiredText(100),
  language: requiredText(10).regex(
    /^[a-z]{2,3}(-[a-zA-Z0-9]{2,8})*$/,
    "Mã ngôn ngữ không hợp lệ",
  ),
  description: optionalText(500),
  preview_url: optionalText(2048).pipe(z.url().optional()),
  gender: optionalText(20),
  public_owner_id: optionalText(128).pipe(
    z
      .string()
      .regex(/^[A-Za-z0-9]+$/)
      .optional(),
  ),
  languageConfirmed: z.boolean().default(false),
});

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
  const includeInactive =
    request.nextUrl.searchParams.get("includeInactive") === "true";
  if (includeInactive) {
    const denied = await requirePermission(supabase, "voices.manage");
    if (denied) return denied;
    const failed = await auditAdmin(supabase, request, {
      action: "default_voice.list",
      targetType: "default_voice",
      targetId: language || "all",
    });
    if (failed) return failed;
  }

  let query = supabase
    .from("default_voices")
    .select("*")
    .order("language")
    .order("sort_order", { ascending: true })
    .order("id");
  if (!includeInactive) query = query.eq("is_active", true);

  if (language) {
    query = query.eq("language", normalizeVoiceLanguage(language) ?? language);
  }

  const { data, error } = await query;
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ voices: data ?? [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  // A-02: permission check shared with RLS (has_permission).
  const denied = await requirePermission(supabase, "voices.manage");
  if (denied) return denied;
  // audit: db-trigger default_voices (A-03 — the write below runs as the caller, trigger logs it)

  const parsed = await parseJsonBody(request, DefaultVoiceBody);
  if (!parsed.ok) return parsed.response;
  const {
    name,
    description,
    preview_url,
    gender,
    public_owner_id,
    languageConfirmed,
  } = parsed.data;
  let { voice_id } = parsed.data;
  const language =
    normalizeVoiceLanguage(parsed.data.language) ?? parsed.data.language;

  if (!voice_id.startsWith("fish:")) {
    try {
      if (public_owner_id) {
        const failed = await auditAdmin(supabase, request, {
          action: "voice.import",
          targetType: "voice",
          targetId: voice_id,
        });
        if (failed) return failed;
      }
      const meta = public_owner_id
        ? await importLibraryVoice(voice_id, public_owner_id, name)
        : await voiceKeyPool.run(
            "elevenlabs",
            (key) => fetchVoiceById(key, voice_id),
            { voiceRef: voice_id },
          );
      if (!voiceMatchesLanguage(meta, language) && !languageConfirmed)
        return Response.json(
          {
            error:
              "Giọng không có nhãn phù hợp ngôn ngữ này. Nghe thử và xác nhận ngôn ngữ trước khi thêm.",
          },
          { status: 400 },
        );
      voice_id = meta.voice_id;
    } catch (e) {
      return keyPoolErrorResponse(
        e,
        "ID chưa khả dụng. Thêm giọng vào My Voices của tài khoản có key, rồi thử lại.",
      );
    }
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
      { onConflict: "voice_id,language" },
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
  // A-02: permission check shared with RLS (has_permission).
  const denied = await requirePermission(supabase, "voices.manage");
  if (denied) return denied;
  // audit: db-trigger default_voices (A-03 — the write below runs as the caller, trigger logs it)

  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return Response.json({ error: "id required" }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const input = z
    .object({ reason: z.string().trim().min(10).max(500) })
    .safeParse(body);
  if (!z.uuid().safeParse(id).success || !input.success)
    return Response.json(
      { error: "ID hoặc lý do 10–500 ký tự không hợp lệ" },
      { status: 400 },
    );
  const { error } = await supabase.rpc("admin_confirmed_action", {
    p_action: "default_voice.delete",
    p_ids: [id],
    p_reason: input.data.reason,
    p_role: null,
  });

  if (error) {
    return Response.json(
      { error: "Không xoá được giọng; kiểm tra quyền, phiên và danh sách." },
      {
        status:
          error.code === "42501" ? 403 : error.code === "40001" ? 409 : 400,
      },
    );
  }

  return Response.json({ ok: true });
}

const OrderBody = z.object({
  language: z.enum(["vi", "en", "ja"]),
  ids: z.array(uuid).min(1).max(100),
});
const ActiveBody = z.object({ id: uuid, is_active: z.boolean() }).strict();
export async function PATCH(request: NextRequest) {
  // audit: db-trigger default_voices
  const supabase = await createClient();
  const denied = await requirePermission(supabase, "voices.manage");
  if (denied) return denied;
  const parsed = await parseJsonBody(
    request,
    z.union([ActiveBody, OrderBody.strict()]),
  );
  if (!parsed.ok) return parsed.response;
  if ("is_active" in parsed.data) {
    const { data, error } = await supabase
      .from("default_voices")
      .update({ is_active: parsed.data.is_active })
      .eq("id", parsed.data.id)
      .select("*")
      .maybeSingle();
    if (error)
      return Response.json(
        { error: "Chưa đổi được trạng thái giọng." },
        { status: 503 },
      );
    if (!data)
      return Response.json({ error: "Không tìm thấy giọng." }, { status: 404 });
    return Response.json({ voice: data });
  }
  // Audit is generated by audit_default_voices inside the atomic RPC.
  const { data, error } = await supabase.rpc("reorder_default_voices", {
    p_language: parsed.data.language,
    p_ids: parsed.data.ids,
  });
  if (error)
    return Response.json(
      {
        error:
          "Danh sách đã thay đổi hoặc chưa sắp xếp được. Tải lại rồi thử lại.",
      },
      { status: error.code === "22023" ? 409 : 503 },
    );
  return Response.json(data ?? { ok: true });
}
