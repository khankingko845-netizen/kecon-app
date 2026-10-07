import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
export async function POST(request: Request) {
  if (request.headers.get("sec-fetch-site") === "cross-site")
    return Response.json({ error: "Forbidden" }, { status: 403 });
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = z
    .strictObject({ event: z.enum(["home_view", "first_listen"]) })
    .safeParse(await request.json().catch(() => null));
  if (!body.success)
    return Response.json({ error: "Invalid event" }, { status: 400 });
  const { error } = await db.rpc("record_measurement_event", {
    p_event: body.data.event,
  });
  return Response.json(
    error ? { error: "Không ghi được sự kiện" } : { ok: true },
    {
      status: error ? 503 : 200,
      headers: { "Cache-Control": "private, no-store" },
    },
  );
}
