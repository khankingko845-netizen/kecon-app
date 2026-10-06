/**
 * Minimal fake Supabase for E2E (auth + PostgREST), so logged-in screens can
 * be tested without a real project. Only the token minted by `fixtures.ts`
 * is accepted — any other token gets 401, keeping the API-auth specs honest.
 *
 *   node tests/e2e/support/mock-supabase.mjs   # listens on :54321
 */
import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_SUPABASE_PORT ?? 54321);
export const MOCK_USER_ID = "00000000-0000-4000-8000-00000000e2e1";
export const MOCK_ACCESS_TOKEN_SUB = MOCK_USER_ID;

const now = new Date("2025-01-01T12:00:00Z").toISOString();
const user = {
  id: MOCK_USER_ID,
  aud: "authenticated",
  role: "authenticated",
  email: "e2e@kecon.test",
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: {},
  created_at: now,
  updated_at: now,
};

const profile = {
  id: MOCK_USER_ID,
  family_name: "Gia đình Gấu",
  display_name: "Mẹ Gấu",
  avatar_url: null,
  avatar_emoji: null,
  child_age: 4,
  child_name: "Bin",
  role: "user",
  locale: "vi",
  email: user.email,
  onboarding_done: true,
  created_at: now,
};

const story = (id, title, category, theme) => ({
  id,
  user_id: MOCK_USER_ID,
  title,
  description: "Truyện mẫu cho E2E",
  category,
  theme,
  target_age_min: 3,
  target_age_max: 5,
  voice_id: null,
  cover_image_url: null,
  total_duration: 180,
  page_count: 2,
  is_published: true,
  is_template: false,
  is_branching: false,
  source: "manual",
  tags: [],
  moral_lesson: "Biết chia sẻ",
  play_count: 3,
  like_count: 1,
  completion_rate: 0.8,
  status: "published",
  is_platform_content: false,
  deleted_at: null,
  avg_rating: 0,
  rating_count: 0,
  share_count: 0,
  locale: "vi",
  narrator_voice_id: null,
  narrator_voice_name: null,
  last_voice_id: null,
  last_voice_name: null,
  created_at: now,
  updated_at: now,
});

const stories = [
  story("00000000-0000-4000-8000-0000000051a1", "Sóc Nhỏ tìm hạt dẻ", "animal", "dongvat"),
  story("00000000-0000-4000-8000-0000000051a2", "Chú Cuội và cây đa", "fairy_tale", "cotich"),
];
const pages = stories.flatMap((s) =>
  [1, 2].map((n) => ({
    id: `${s.id.slice(0, -2)}${n}${n}`,
    story_id: s.id,
    page_number: n,
    content: `[narrator]Trang ${n}: ngày xưa có một chú sóc nhỏ rất thích nghe truyện.[/narrator]`,
    scene_description: null,
    illustration_url: null,
    audio_url: null,
    audio_duration: 0,
    transition_effect: "fade",
    particle_effect: null,
    ambient_sound: null,
    sfx_sounds: [],
    choices: [],
    voice_segments: null,
  }))
);

const TABLES = { profiles: [profile], stories, story_pages: pages };

function tokenSub(auth) {
  const token = (auth ?? "").replace(/^Bearer\s+/i, "");
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString());
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

/** Apply the simple `col=eq.value` filters PostgREST receives. */
function filterRows(rows, params) {
  let out = rows;
  for (const [key, raw] of params) {
    if (["select", "order", "limit", "offset", "or", "and"].includes(key)) continue;
    const m = /^(eq|is|in)\.(.*)$/.exec(raw);
    if (!m) continue;
    const [, op, val] = m;
    out = out.filter((r) => {
      const v = r[key];
      if (op === "eq") return String(v) === val;
      if (op === "is") return val === "null" ? v == null : String(v) === val;
      if (op === "in") return val.replace(/^\(|\)$/g, "").split(",").map((x) => x.replace(/"/g, "")).includes(String(v));
      return true;
    });
  }
  const limit = Number(params.get("limit"));
  return Number.isFinite(limit) && limit > 0 ? out.slice(0, limit) : out;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,PUT,DELETE,HEAD,OPTIONS",
  "Access-Control-Expose-Headers": "Content-Range, X-Supabase-Api-Version",
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json", ...CORS, ...headers });
  res.end(body === undefined ? "" : JSON.stringify(body));
}

createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  const path = url.pathname;
  if (req.method === "OPTIONS") return send(res, 204);
  if (path === "/health") return send(res, 200, { ok: true });

  // ── Auth ──
  if (path === "/auth/v1/user") {
    return tokenSub(req.headers.authorization) === MOCK_USER_ID
      ? send(res, 200, user)
      : send(res, 401, { code: 401, error_code: "bad_jwt", msg: "invalid JWT" });
  }
  if (path.startsWith("/auth/v1/logout")) return send(res, 204);
  if (path.startsWith("/auth/v1/")) return send(res, 400, { error: "invalid_grant", error_description: "mock" });

  // ── PostgREST ──
  if (path.startsWith("/rest/v1/")) {
    const authed = tokenSub(req.headers.authorization) === MOCK_USER_ID;
    if (path.startsWith("/rest/v1/rpc/")) return send(res, 200, null);
    const table = path.slice("/rest/v1/".length);
    if (req.method !== "GET" && req.method !== "HEAD") {
      return send(res, req.method === "DELETE" ? 204 : 201, req.method === "DELETE" ? undefined : []);
    }
    const rows = authed ? filterRows(TABLES[table] ?? [], url.searchParams) : [];
    const range = { "Content-Range": rows.length ? `0-${rows.length - 1}/${rows.length}` : "*/0" };
    if (req.method === "HEAD") return send(res, 200, undefined, range);
    if ((req.headers.accept ?? "").includes("vnd.pgrst.object")) {
      return rows.length === 1
        ? send(res, 200, rows[0], range)
        : send(res, 406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" });
    }
    return send(res, 200, rows, range);
  }

  // Storage / functions / realtime: not needed by the smoke specs.
  return send(res, 404, { message: "not found (mock)" });
}).listen(PORT, "127.0.0.1", () => {
  console.log(`mock supabase on :${PORT}`);
});
