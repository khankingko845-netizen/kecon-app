import type { SupabaseClient } from "@supabase/supabase-js";
/** Both provider catalog paths filter known private household IDs before response.
 * Missing provenance for orphan provider clones remains a T12 reconciliation gate. */
export async function authorizedVoiceCatalog<T extends { voice_id: string }>(
  db: SupabaseClient,
  voices: T[],
): Promise<{ voices: T[] } | { response: Response }> {
  const unavailable = () => ({
    response: Response.json(
      { error: "Chưa kiểm tra được quyền danh sách giọng." },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    ),
  });
  if (
    voices.length > 1000 ||
    voices.some(
      (v) =>
        typeof v.voice_id !== "string" ||
        !v.voice_id ||
        v.voice_id.length > 120,
    )
  )
    return unavailable();
  if (!voices.length) return { voices: [] };
  const ids = voices.map((v) => v.voice_id);
  const { data, error } = await db.rpc("allowed_catalog_voice_ids", {
    p_voice_ids: ids,
  });
  if (
    error ||
    !Array.isArray(data) ||
    data.some((id) => typeof id !== "string" || !ids.includes(id))
  )
    return unavailable();
  const allowed = new Set<string>(data);
  return { voices: voices.filter((v) => allowed.has(v.voice_id)) };
}
