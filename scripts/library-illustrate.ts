/**
 * Draw page pictures for an imported library pack (docs/library-v1.md → "Tranh
 * minh hoạ"), so every family sees the same reviewed-once artwork instead of
 * paying for pictures per reader.
 *
 *   KC_SITE_URL=https://… KC_SUPABASE_URL=https://… KC_SUPABASE_ANON_KEY=… KC_SESSION_FILE=staff-session.json \
 *   node --import ./scripts/ts-paths.mjs scripts/library-illustrate.ts --pack v1 [--slug tich-chu] [--dry-run] [--max-images 120]
 *   … --slug tich-chu --redraw 3,5      # replace the pictures of pages 3 and 5
 *
 * The session must belong to staff with stories.write and an open MFA admin
 * session. Pictures go through the app's /api/story/illustrate-batch (same
 * provider settings, usage guard, cost ledger and staff audit as the editor),
 * using the story's illustration_style, page illustration_prompt and the
 * character bible stored by the import. Pages that already have a picture are
 * skipped, so re-running only draws what is missing; page 1 becomes the cover.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { createClient, type Session } from "@supabase/supabase-js";
import { LIBRARY_TAG_PREFIX, LibraryStorySchema } from "@/lib/library-pack";

const { values } = parseArgs({
  options: {
    pack: { type: "string", default: "v1" },
    slug: { type: "string", multiple: true },
    "dry-run": { type: "boolean", default: false },
    "max-images": { type: "string", default: "120" },
    redraw: { type: "string" },
    chunk: { type: "string", default: "4" },
  },
});
const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is required`);
  return v;
};
const site = env("KC_SITE_URL").replace(/\/$/, "");
const supabaseUrl = env("KC_SUPABASE_URL");
const anonKey = env("KC_SUPABASE_ANON_KEY");
const maxImages = Number(values["max-images"]);
const chunkSize = Math.min(Math.max(Number(values.chunk) || 4, 1), 8);
const version = values.pack ?? "v1";
if (!/^v\d+$/.test(version)) throw new Error("--pack must look like v1");
const redraw = values.redraw ? values.redraw.split(",").map((n) => Number(n.trim())) : null;
if (redraw && (redraw.some((n) => !Number.isInteger(n) || n < 1) || values.slug?.length !== 1))
  throw new Error("--redraw needs page numbers like 3,5 and exactly one --slug");

const dir = path.join(process.cwd(), "content/library", version);
const slugs = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((f) => LibraryStorySchema.parse(JSON.parse(readFileSync(path.join(dir, f), "utf8"))).slug)
  .filter((s) => !values.slug?.length || values.slug.includes(s));

const sb = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: true } });
const cookieName = `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`;
/** @supabase/ssr cookie format (base64-, chunked) so the app's route handlers see the staff session. */
function cookie(s: Session): string {
  const parts = ("base64-" + Buffer.from(JSON.stringify(s)).toString("base64url")).match(/.{1,3180}/g) ?? [];
  return parts.map((v, i) => `${parts.length === 1 ? cookieName : `${cookieName}.${i}`}=${v}`).join("; ");
}
async function headers(): Promise<Record<string, string>> {
  const { data } = await sb.auth.getSession();
  if (!data.session) throw new Error("staff session expired");
  return { "Content-Type": "application/json", Cookie: cookie(data.session), Origin: site };
}

type Result = { pageNumber: number; url?: string; error?: string };
async function illustrate(storyId: string, pageNumbers: number[]): Promise<Result[]> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${site}/api/story/illustrate-batch`, {
      method: "POST",
      headers: await headers(),
      body: JSON.stringify({ storyId, pageNumbers }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) return (body.results ?? []) as Result[];
    if (attempt >= 3 || (res.status < 500 && res.status !== 429)) throw new Error(`illustrate ${res.status}: ${String(body.error ?? "").slice(0, 200)}`);
    await new Promise((r) => setTimeout(r, (res.status === 429 ? 30_000 : 5_000) * attempt));
  }
}

async function main() {
  const session = JSON.parse(readFileSync(env("KC_SESSION_FILE"), "utf8")) as Session;
  const set = await sb.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
  if (set.error) throw new Error(`session: ${set.error.message}`);
  const lease = await sb.rpc("open_admin_session");
  if (lease.error || lease.data?.state !== "ready") throw new Error("staff admin session (MFA) is not open");

  const plans: { slug: string; storyId: string; style: string | null; pages: number[]; total: number }[] = [];
  for (const slug of slugs) {
    const { data: story, error } = await sb
      .from("stories")
      .select("id, illustration_style")
      .contains("tags", [`${LIBRARY_TAG_PREFIX}${slug}`])
      .eq("is_platform_content", true)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw new Error(`${slug}: ${error.message}`);
    if (!story) {
      console.error(`${slug}: not imported, skipped`);
      continue;
    }
    const { data: pages, error: pErr } = await sb.from("story_pages").select("page_number, illustration_url").eq("story_id", story.id).order("page_number");
    if (pErr) throw new Error(`${slug}: ${pErr.message}`);
    const todo = redraw ? (pages ?? []).filter((p) => redraw.includes(p.page_number)) : (pages ?? []).filter((p) => !p.illustration_url);
    plans.push({ slug, storyId: story.id, style: story.illustration_style, pages: todo.map((p) => p.page_number), total: pages?.length ?? 0 });
  }

  const images = plans.reduce((n, s) => n + s.pages.length, 0);
  console.log(JSON.stringify({ stories: plans.length, pages: plans.reduce((n, s) => n + s.total, 0), toDraw: images, styles: [...new Set(plans.map((s) => s.style))] }));
  if (values["dry-run"]) {
    for (const s of plans) console.log(`${s.slug}: ${s.pages.length}/${s.total} pages to draw (${s.style ?? "default style"})`);
    return;
  }
  if (images > maxImages) throw new Error(`would draw ${images} pictures (> --max-images ${maxImages})`);

  let drawn = 0;
  const failed: string[] = [];
  for (const s of plans) {
    if (!s.pages.length) continue;
    await sb.rpc("open_admin_session"); // keep the 30-minute admin lease alive
    const started = Date.now();
    const results: Result[] = [];
    for (let i = 0; i < s.pages.length; i += chunkSize) results.push(...(await illustrate(s.storyId, s.pages.slice(i, i + chunkSize))));
    const ok = results.filter((r) => r.url).length;
    drawn += ok;
    for (const r of results) if (r.error) failed.push(`${s.slug} p${r.pageNumber}: ${r.error.slice(0, 120)}`);
    console.log(JSON.stringify({ slug: s.slug, drawn: ok, failed: results.length - ok, seconds: Math.round((Date.now() - started) / 1000) }));
  }
  console.log(JSON.stringify({ drawn, failed: failed.length }));
  for (const f of failed) console.error(f);
  if (failed.length) process.exit(2);
}

main().catch((e) => {
  console.error(`illustrate failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
