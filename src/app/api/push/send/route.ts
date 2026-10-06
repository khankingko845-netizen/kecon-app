import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/admin-permissions";
import { z } from "zod";
import { optionalText, parseJsonBody, requiredText, uuid } from "@/lib/api-validation";

const PushSendBody = z.object({
  title: requiredText(120),
  body: requiredText(500),
  // Only same-origin paths — never send users to external sites from a push
  url: optionalText(500).pipe(z.string().regex(/^\/(?!\/)/, "url phải là đường dẫn nội bộ bắt đầu bằng /").optional()),
  storyId: uuid.nullish(),
  userIds: z.array(uuid).max(1000).nullish(),
});


/**
 * POST /api/push/send — Admin-only: send push notification to all subscribers or specific users.
 *
 * Body: { title, body, url?, storyId?, userIds?: string[] }
 *
 * Requires VAPID_PRIVATE_KEY and NEXT_PUBLIC_VAPID_PUBLIC_KEY env vars.
 * Uses the Web Push protocol via the `web-push` package.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  // A-02: permission check shared with RLS (has_permission).
  const denied = await requirePermission(supabase, "notifications.send");
  if (denied) return denied;

  const parsed = await parseJsonBody(request, PushSendBody);
  if (!parsed.ok) return parsed.response;
  const { title, body, url, storyId, userIds } = parsed.data;

  // Fetch subscriptions
  let query = supabase.from("push_subscriptions").select("subscription_json");
  if (userIds && userIds.length > 0) {
    query = query.in("user_id", userIds);
  }
  const { data: subs } = await query;

  if (!subs || subs.length === 0) {
    return Response.json({ sent: 0, message: "No subscribers" });
  }

  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
  const vapidSubject = process.env.VAPID_SUBJECT || "mailto:admin@kecon.app";

  if (!vapidPublicKey || !vapidPrivateKey) {
    return Response.json(
      { error: "VAPID keys not configured" },
      { status: 500 }
    );
  }

  // Dynamic import web-push (server-side only)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let webpush: any;
  try {
    webpush = await import("web-push");
  } catch {
    return Response.json(
      {
        error:
          "web-push package not installed. Run: npm install web-push",
      },
      { status: 500 }
    );
  }

  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

  const payload = JSON.stringify({ title, body, url, storyId });

  let sent = 0;
  let failed = 0;

  await Promise.allSettled(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(sub.subscription_json, payload);
        sent++;
      } catch {
        failed++;
      }
    })
  );

  return Response.json({ sent, failed, total: subs.length });
}
