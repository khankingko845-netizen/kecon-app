#!/usr/bin/env node
/**
 * G-07 parent reminders (docs/missions-parent.md). Run every 15 minutes by
 * kecon-parent-notify.timer:
 *   claim (parent_notify_claim, service role) → Web Push to the parent devices
 *   → finish (parent_notify_finish: status, count, endpoints that are gone).
 * The database decides who is due (opted in, chosen hour, ≤ 1 a day, only
 * devices registered behind the PIN, never child-push endpoints). Without a
 * VAPID key pair nothing is claimed, so no day is used up unsent.
 * Logs carry counts only — no user ids, endpoints or message text.
 */
import { pathToFileURL } from "node:url";

/** Pure run, injectable for tests. */
export async function runOnce({ rpc, send, now = new Date(), log = console.log }) {
  const { data, error } = await rpc("parent_notify_claim", { p_now: now.toISOString(), p_limit: 200 });
  if (error) throw new Error(`claim failed: ${error.code ?? error.message ?? "unknown"}`);
  const batch = Array.isArray(data) ? data : [];
  const totals = { claimed: batch.length, sent: 0, failed: 0, gone: 0 };
  for (const item of batch) {
    const devices = Array.isArray(item.devices) ? item.devices : [];
    const payload = JSON.stringify({ kind: "parent", title: item.title, body: item.body });
    let sent = 0;
    const gone = [];
    for (const d of devices) {
      try {
        await send({ endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } }, payload);
        sent += 1;
      } catch (e) {
        const code = e?.statusCode;
        if (code === 404 || code === 410) gone.push(d.endpoint);
        else totals.failed += 1;
      }
    }
    totals.sent += sent;
    totals.gone += gone.length;
    const status = sent > 0 ? "sent" : devices.length > gone.length ? "failed" : "skipped";
    const fin = await rpc("parent_notify_finish", { p_user: item.user_id, p_date: item.date, p_status: status, p_sent: sent, p_gone: gone });
    if (fin.error) throw new Error(`finish failed: ${fin.error.code ?? fin.error.message ?? "unknown"}`);
  }
  log(JSON.stringify({ job: "parent-notify", ...totals }));
  return totals;
}

async function main() {
  const env = process.env;
  const publicKey = env.VAPID_PUBLIC_KEY || env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = env.VAPID_PRIVATE_KEY;
  const url = env.SUPABASE_INTERNAL_URL || env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!publicKey || !privateKey) {
    console.log(JSON.stringify({ job: "parent-notify", skipped: "vapid_missing" }));
    return;
  }
  if (!url || !serviceKey) throw new Error("SUPABASE_INTERNAL_URL/NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  const [{ createClient }, webpushModule] = await Promise.all([import("@supabase/supabase-js"), import("web-push")]);
  const webpush = webpushModule.default ?? webpushModule;
  webpush.setVapidDetails(env.VAPID_SUBJECT || "mailto:admin@kecon.app", publicKey, privateKey);
  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  await runOnce({
    rpc: (fn, args) => db.rpc(fn, args),
    send: (sub, payload) => webpush.sendNotification(sub, payload, { TTL: 3600, urgency: "normal", topic: "parent-week" }),
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(JSON.stringify({ job: "parent-notify", error: String(e?.message ?? e).slice(0, 200) }));
    process.exit(1);
  });
}
