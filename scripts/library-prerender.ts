/**
 * Pre-render page narration for an imported library pack, so families play a
 * saved file instead of paying TTS on every listen (docs/library-v1.md).
 *
 *   KC_SITE_URL=https://… KC_SUPABASE_URL=https://… KC_SUPABASE_ANON_KEY=… KC_SESSION_FILE=staff-session.json \
 *   node --import ./scripts/ts-paths.mjs scripts/library-prerender.ts --pack v1 [--slug tich-chu] [--dry-run] [--max-chars 30000]
 *
 * The session (Supabase session JSON) must belong to staff with stories.write
 * and an open MFA admin session. TTS goes through the app's /api/voice/tts
 * (same key pool, metering and pacing as the player); multi-voice pages are
 * joined with ffmpeg using the player's gap. Pages whose audio_key already
 * matches are skipped, so re-running only renders what changed.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import { createClient, type Session } from "@supabase/supabase-js";
import { LIBRARY_TAG_PREFIX, LibraryStorySchema } from "@/lib/library-pack";
import { planStoryAudio, type PagePlan, type PrerenderStory } from "@/lib/library-audio";
import { segmentGap } from "@/lib/narration-pacing";
import type { NarrationPace } from "@/lib/story-brief";

const { values } = parseArgs({
  options: {
    pack: { type: "string", default: "v1" },
    slug: { type: "string", multiple: true },
    "dry-run": { type: "boolean", default: false },
    "max-chars": { type: "string", default: "30000" },
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
const maxChars = Number(values["max-chars"]);
const version = values.pack ?? "v1";
if (!/^v\d+$/.test(version)) throw new Error("--pack must look like v1");

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

async function tts(voiceId: string, text: string, language: string, pace: NarrationPace): Promise<Buffer> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${site}/api/voice/tts`, { method: "POST", headers: await headers(), body: JSON.stringify({ voiceId, text, language, pace }) });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    const body = await res.text();
    if (attempt >= 3 || (res.status < 500 && res.status !== 429)) throw new Error(`TTS ${res.status}: ${body.slice(0, 200)}`);
    await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
}

/** One page file: a single segment as-is, several joined with the player's silence gap (mp3, 44.1 kHz mono). */
function joinSegments(parts: Buffer[], gap: number): { audio: Buffer; seconds: number } {
  const work = mkdtempSync(path.join(tmpdir(), "kc-prerender-"));
  try {
    const inputs: string[] = [];
    parts.forEach((b, i) => {
      const f = path.join(work, `s${i}.mp3`);
      writeFileSync(f, b);
      inputs.push(f);
    });
    const out = path.join(work, "page.mp3");
    if (parts.length === 1) writeFileSync(out, parts[0]);
    else {
      const args = ["-v", "error", "-y"];
      for (const f of inputs) args.push("-i", f);
      args.push("-f", "lavfi", "-t", String(gap), "-i", "anullsrc=r=44100:cl=mono");
      const silence = inputs.length;
      const chain = inputs.map((_, i) => `[${i}:a]aresample=44100,aformat=channel_layouts=mono[a${i}]`).join(";");
      const order = inputs.map((_, i) => (i < inputs.length - 1 ? `[a${i}][g${i}]` : `[a${i}]`)).join("");
      const gaps = inputs.slice(0, -1).map((_, i) => `[g${i}]`).join("");
      const filter = `${chain};[${silence}:a]asplit=${Math.max(1, inputs.length - 1)}${gaps};${order}concat=n=${inputs.length * 2 - 1}:v=0:a=1[out]`;
      args.push("-filter_complex", filter, "-map", "[out]", "-c:a", "libmp3lame", "-b:a", "128k", out);
      execFileSync("ffmpeg", args);
    }
    const seconds = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", out], { encoding: "utf8" }).trim());
    return { audio: readFileSync(out), seconds };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

async function renderPage(p: PagePlan, locale: string, pace: NarrationPace): Promise<number> {
  const parts: Buffer[] = [];
  for (const seg of p.segments) parts.push(await tts(seg.voiceId, seg.text, locale, pace));
  const { audio, seconds } = joinSegments(parts, segmentGap(pace));
  const file = `${p.pageId}-${randomUUID()}.mp3`;
  const up = await sb.storage.from("tts-cache").upload(file, audio, { contentType: "audio/mpeg", upsert: false });
  if (up.error) throw new Error(`upload: ${up.error.message}`);
  const url = sb.storage.from("tts-cache").getPublicUrl(file).data.publicUrl;
  const { data, error } = await sb
    .from("story_pages")
    .update({ audio_url: url, audio_duration: Math.round(seconds), audio_key: p.key })
    .eq("id", p.pageId)
    .select("id");
  if (error || data?.length !== 1) throw new Error(`save page ${p.pageNumber}: ${error?.message ?? "no row updated"}`);
  return seconds;
}

async function main() {
  const session = JSON.parse(readFileSync(env("KC_SESSION_FILE"), "utf8")) as Session;
  const set = await sb.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
  if (set.error) throw new Error(`session: ${set.error.message}`);
  const lease = await sb.rpc("open_admin_session");
  if (lease.error || lease.data?.state !== "ready") throw new Error("staff admin session (MFA) is not open");

  const status = await (await fetch(`${site}/api/system/status`, { headers: await headers() })).json();
  const { data: defaults, error: dErr } = await sb.from("default_voices").select("id, voice_id, name, language, sort_order, is_active").eq("is_active", true);
  if (dErr) throw new Error(dErr.message);

  const plans: { slug: string; title: string; story: PrerenderStory; plan: Awaited<ReturnType<typeof planStoryAudio>> }[] = [];
  for (const slug of slugs) {
    const { data: story, error } = await sb
      .from("stories")
      .select("id, title, locale, narrator_voice_id, narration_pace, cast_voices")
      .contains("tags", [`${LIBRARY_TAG_PREFIX}${slug}`])
      .eq("is_platform_content", true)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw new Error(`${slug}: ${error.message}`);
    if (!story) {
      console.error(`${slug}: not imported, skipped`);
      continue;
    }
    const [pages, chars] = await Promise.all([
      sb.from("story_pages").select("id, page_number, content, audio_url, audio_key").eq("story_id", story.id),
      sb.from("story_characters").select("name, voice_id, voice_name").eq("story_id", story.id),
    ]);
    if (pages.error || chars.error) throw new Error(`${slug}: ${(pages.error ?? chars.error)?.message}`);
    const plan = await planStoryAudio(story, pages.data ?? [], chars.data ?? [], defaults ?? [], status.elevenLabsModel ?? "");
    plans.push({ slug, title: story.title, story, plan });
  }

  const todo = plans.flatMap((s) => s.plan.pages.filter((p) => !p.upToDate));
  const totalChars = todo.reduce((n, p) => n + p.chars, 0);
  console.log(
    JSON.stringify({
      stories: plans.length,
      pages: plans.reduce((n, s) => n + s.plan.pages.length, 0),
      toRender: todo.length,
      ttsCalls: todo.reduce((n, p) => n + p.segments.length, 0),
      chars: totalChars,
      model: plans[0]?.plan.model,
      narrator: plans[0]?.plan.narrator,
    }),
  );
  if (values["dry-run"]) {
    for (const s of plans) console.log(`${s.slug}: ${s.plan.pages.filter((p) => !p.upToDate).length}/${s.plan.pages.length} pages to render, ${s.plan.pages.reduce((n, p) => n + (p.upToDate ? 0 : p.chars), 0)} chars`);
    return;
  }
  if (totalChars > maxChars) throw new Error(`would send ${totalChars} chars to TTS (> --max-chars ${maxChars})`);

  for (const s of plans) {
    const pending = s.plan.pages.filter((p) => !p.upToDate);
    if (!pending.length) continue;
    await sb.rpc("open_admin_session"); // keep the 30-minute admin lease alive
    let seconds = 0;
    for (const p of pending) seconds += await renderPage(p, s.story.locale || "vi", s.plan.pace);
    console.log(JSON.stringify({ slug: s.slug, rendered: pending.length, chars: pending.reduce((n, p) => n + p.chars, 0), seconds: Math.round(seconds) }));
  }
}

main().catch((e) => {
  console.error(`prerender failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
