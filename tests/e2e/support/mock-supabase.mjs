/**
 * Minimal fake Supabase for E2E (auth + PostgREST), so logged-in screens can
 * be tested without a real project. Only the token minted by `fixtures.ts`
 * is accepted — any other token gets 401, keeping the API-auth specs honest.
 *
 *   node tests/e2e/support/mock-supabase.mjs   # listens on :54321
 */
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_SUPABASE_PORT ?? 54321);
export const MOCK_USER_ID = "00000000-0000-4000-8000-00000000e2e1";
export const MOCK_ACCESS_TOKEN_SUB = MOCK_USER_ID;
/** Second family (T19): parent PIN 2468 + parental controls on, 30 phút/ngày, chặn Cổ tích. */
export const MOCK_PIN_USER_ID = "00000000-0000-4000-8000-00000000e2e2";
const MOCK_PIN = "2468";
/** Third family (UI-13): its profile is writable so specs can change the child's age. */
export const MOCK_AGE_USER_ID = "00000000-0000-4000-8000-00000000e2e3";
/** Writable avatar family, isolated from concurrent age-band tests. */
export const MOCK_PHOTO_USER_ID = "00000000-0000-4000-8000-00000000e2e7";
export const MOCK_VOICE_USER_ID = "00000000-0000-4000-8000-00000000e2e8";
export const MOCK_AVATAR_USER_ID = "00000000-0000-4000-8000-00000000e2e6";
/** Admin v2 · A-01: the only mock account whose profile role is "admin". */
export const MOCK_ADMIN_USER_ID = "00000000-0000-4000-8000-00000000e2e4";
/** Admin v2 · A-02: an "editor" (Biên tập) — narrow role, no settings / users / API keys. */
export const MOCK_EDITOR_USER_ID = "00000000-0000-4000-8000-00000000e2e5";

const MOCK_A15_ADMIN_ID="00000000-0000-4000-8000-00000000e2a0",MOCK_A15_TARGET_ID="00000000-0000-4000-8000-00000000e2a1";
const MOCK_MFA_USER_ID="00000000-0000-4000-8000-00000000e2e9";
/** T11: families that have not accepted the parent policy yet (no PIN / PIN {@link MOCK_PIN}). */
const MOCK_CONSENT_USER_ID="00000000-0000-4000-8000-00000000e2c1",MOCK_CONSENT_PIN_USER_ID="00000000-0000-4000-8000-00000000e2c2";
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

const pinUser = {
  ...user,
  id: MOCK_PIN_USER_ID,
  email: "e2e-pin@kecon.test",
};
const ageUser = {
  ...user,
  id: MOCK_AGE_USER_ID,
  email: "e2e-age@kecon.test",
};
const avatarUser = { ...user, id: MOCK_AVATAR_USER_ID, email: "e2e-avatar@kecon.test" };
const adminUser = {
  ...user,
  id: MOCK_ADMIN_USER_ID,
  email: "e2e-admin@kecon.test",
};
const editorUser = {
  ...user,
  id: MOCK_EDITOR_USER_ID,
  email: "e2e-editor@kecon.test",
};
const USERS = {
  [MOCK_A15_ADMIN_ID]:{...adminUser,id:MOCK_A15_ADMIN_ID,email:"e2e-a15-admin@kecon.test"},
  [MOCK_A15_TARGET_ID]:{...user,id:MOCK_A15_TARGET_ID,email:"e2e-a15-target@kecon.test"},
  [MOCK_USER_ID]: user,
  [MOCK_PIN_USER_ID]: pinUser,
  [MOCK_AGE_USER_ID]: ageUser,
  [MOCK_AVATAR_USER_ID]: avatarUser,
  [MOCK_PHOTO_USER_ID]: {...user,id:MOCK_PHOTO_USER_ID,email:"e2e-photo@kecon.test"},
  [MOCK_VOICE_USER_ID]: {...user,id:MOCK_VOICE_USER_ID,email:"e2e-voice@kecon.test"},
  [MOCK_MFA_USER_ID]: {...adminUser,id:MOCK_MFA_USER_ID,email:"e2e-mfa@kecon.test"},
  [MOCK_ADMIN_USER_ID]: adminUser,
  [MOCK_EDITOR_USER_ID]: editorUser,
  [MOCK_CONSENT_USER_ID]: {...user,id:MOCK_CONSENT_USER_ID,email:"e2e-consent@kecon.test"},
  [MOCK_CONSENT_PIN_USER_ID]: {...user,id:MOCK_CONSENT_PIN_USER_ID,email:"e2e-consent-pin@kecon.test"},
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

// PR #49: the second story already has a scene thumbnail; the first one is
// thumbnailed by the Library warm-up (POST /api/story/thumbnails).
const stories = [
  story("00000000-0000-4000-8000-0000000051a1", "Sóc Nhỏ tìm hạt dẻ", "animal", "dongvat"),
  { ...story("00000000-0000-4000-8000-0000000051a2", "Chú Cuội và cây đa", "fairy_tale", "cotich"), thumbnail_source: "scene", thumbnail_scene: "village" },
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

const pinProfile = { ...profile, id: MOCK_PIN_USER_ID, email: pinUser.email, family_name: "Gia đình Thỏ", child_name: "Na" };
const parentalControls = [
  {
    id: "00000000-0000-4000-8000-0000000c0e01",
    user_id: MOCK_PIN_USER_ID,
    is_enabled: true,
    daily_limit_minutes: 30,
    bedtime_start: null,
    bedtime_end: null,
    blocked_categories: ["fairy_tale"],
    max_age_rating: 99,
    created_at: now,
    updated_at: now,
  },
];

const ageProfile = { ...profile, id: MOCK_AGE_USER_ID, email: ageUser.email, family_name: "Gia đình Mèo", child_name: "Mít" };

const adminProfile = { ...profile, id: MOCK_ADMIN_USER_ID, email: adminUser.email, family_name: "Đội KểCon", display_name: "Admin E2E", role: "admin" };

const editorProfile = { ...profile, id: MOCK_EDITOR_USER_ID, email: editorUser.email, family_name: "Đội KểCon", display_name: "Biên tập E2E", role: "editor" };

/** Mirror of migration 019 / src/lib/admin-permissions.ts for the mock roles. */
const ALL_PERMISSIONS = [
  "analytics.view", "audit.read", "backups.manage", "categories.manage", "dashboard.view", "moderation.manage", "notifications.send", "roles.manage", "secrets.manage",
  "settings.read", "settings.write", "stories.read", "stories.write", "templates.manage", "users.read", "voices.manage",
];
const ROLE_PERMISSIONS = {
  super_admin: ALL_PERMISSIONS,
  admin: ALL_PERMISSIONS.filter((p) => p !== "roles.manage"),
  editor: ["categories.manage", "dashboard.view", "stories.read", "stories.write", "templates.manage"],
};

/** A-03 · append-only admin log, newest first (the app orders by id desc). */
const adminAuditLog = [
  {
    id: 4, created_at: "2026-03-05T09:15:00+00:00", actor_id: MOCK_ADMIN_USER_ID, actor_email: adminUser.email, actor_role: "admin",
    action: "user.role_change", target_type: "user", target_id: MOCK_EDITOR_USER_ID, before: { role: "user" }, after: { role: "editor" },
    reason: null, ip: "203.0.113.7", source: "db",
  },
  {
    id: 3, created_at: "2026-03-02T08:00:00+00:00", actor_id: MOCK_EDITOR_USER_ID, actor_email: editorUser.email, actor_role: "editor",
    action: "story.update", target_type: "story", target_id: "story-1", before: { title: "Thỏ con" }, after: { title: "Thỏ con và Rùa" },
    reason: null, ip: null, source: "db",
  },
  {
    id: 2, created_at: "2026-01-20T10:00:00+00:00", actor_id: MOCK_ADMIN_USER_ID, actor_email: adminUser.email, actor_role: "admin",
    action: "secret.update", target_type: "setting", target_id: "elevenlabs_api_key", before: { value: "[đã ẩn]" }, after: { value: "[đã ẩn]" },
    reason: null, ip: "203.0.113.7", source: "db",
  },
  {
    id: 1, created_at: "2026-01-10T10:00:00+00:00", actor_id: null, actor_email: null, actor_role: null,
    action: "user.plan_change", target_type: "user", target_id: MOCK_USER_ID, before: { plan: "free" }, after: { plan: "premium" },
    reason: null, ip: null, source: "system",
  },
];

const TABLES = {
  profiles: [{...adminProfile,id:MOCK_A15_ADMIN_ID,email:"e2e-a15-admin@kecon.test",family_name:"Đội UI",role:"super_admin"},{...profile,id:MOCK_A15_TARGET_ID,family_name:"Gia đình Xác nhận",display_name:"QA Xác nhận"},profile, pinProfile, ageProfile, adminProfile, editorProfile, {...adminProfile,id:MOCK_MFA_USER_ID,email:"e2e-mfa@kecon.test"}, { ...profile, id: MOCK_AVATAR_USER_ID, email: avatarUser.email }, {...profile,id:MOCK_PHOTO_USER_ID}, {...profile,id:MOCK_VOICE_USER_ID}, {...profile,id:MOCK_CONSENT_USER_ID,email:"e2e-consent@kecon.test",family_name:"Gia đình Đồng ý"}, {...profile,id:MOCK_CONSENT_PIN_USER_ID,email:"e2e-consent-pin@kecon.test",family_name:"Gia đình PIN"}],
  voice_profiles: [{id:"00000000-0000-4000-8000-00000000cc01",user_id:MOCK_VOICE_USER_ID,name:"Bà của bé",relation:"grandma",elevenlabs_voice_id:"familyGrandma",is_active:true,created_at:now}],
  stories,
  story_pages: pages,
  parental_controls: parentalControls,
  admin_audit_log: adminAuditLog,
};

/**
 * A-04 · API keys "in Vault" (migration 021). The browser only gets statuses
 * (list_system_secrets) and writes keys (set_system_secret); the Next server
 * reads them with the service role (get_system_secret).
 * Outside scan mode the server reads nothing, so every other spec keeps the
 * "no system keys" state. Scan mode (POST /__e2e/secrets-scan, used by the
 * serial secrets-scan project) plants a key in every slot.
 */
export const MOCK_SERVICE_ROLE_KEY = "e2e-fake-service-role-key";
const SECRET_SETTINGS = [
  ["anthropic_api_key", "Anthropic Claude API Key", "ai"],
  ["custom_provider_key", "Custom Provider Key", "ai"],
  ["gemini_api_key", "Google Gemini API Key", "ai"],
  ["openai_api_key", "OpenAI API Key", "ai"],
  ["dalle_api_key", "DALL·E API Key", "image"],
];
const vault = new Map([
  ["anthropic_api_key", { value: "sk-ant-e2e-stored-claude-x9Qz", updated_at: "2026-03-01T08:00:00+00:00", updated_by_email: adminUser.email }],
]);
let secretsScan = false;
export const plantedSecret = (key) => `sk-e2e-PLANTED-${key}-Zq7w`;
const last4 = (v) => (v.length >= 12 ? v.slice(-4) : null);
const rpcError = (status, code, message) => ({ __rpcError: { status, body: { code, details: null, hint: null, message } } });

function secretStatuses() {
  return SECRET_SETTINGS.map(([key, label, category]) => {
    const stored = secretsScan ? { value: plantedSecret(key), updated_at: now, updated_by_email: null } : vault.get(key);
    return {
      key, label, category, is_set: Boolean(stored), last4: stored ? last4(stored.value) : null,
      updated_at: stored?.updated_at ?? null, updated_by_email: stored?.updated_by_email ?? null,
    };
  });
}

/**
 * A-04b · voice key pool (migration 022): many ElevenLabs / Fish Audio keys,
 * rotated by the Next server. The browser lists / adds / toggles / deletes
 * (RPCs below, secrets.manage); only the service role reads secrets.
 * Outside scan mode get_provider_key_pool returns [] so every other spec keeps
 * "no voice keys" — the admin screen still shows the preset rows and
 * "Kiểm tra" works (get_provider_key_secret → mock provider below).
 * Scan mode serves a planted pool instead (secrets-scan.spec.ts): ElevenLabs key 1
 * is out of quota at the provider, so TTS must fail over to key 2.
 */
const poolKey = (id, provider, label, secret, extra = {}) => ({
  id, provider, label, secret, last4: last4(secret), enabled: true, status: "active", cooldown_until: null, last_error: null,
  use_count: 0, char_count: 0, last_used_at: null, credit: null, credit_checked_at: null,
  created_at: "2026-03-01T08:00:00+00:00", created_by_email: adminUser.email, updated_at: "2026-03-01T08:00:00+00:00", ...extra,
});
const providerKeys = [
  poolKey("00000000-0000-4000-8000-0000000000e1", "elevenlabs", "Key chính (chuyển từ A-04)", "sk_e2e-stored-elevenlabs-x9Qz", {
    use_count: 12, char_count: 3400, last_used_at: "2026-03-04T08:00:00+00:00", credit_checked_at: "2026-03-04T08:00:00+00:00",
    credit: { unit: "characters", used: 1500, limit: 10000, remaining: 8500, reset_at: null },
  }),
  poolKey("00000000-0000-4000-8000-0000000000e2", "elevenlabs", "Tài khoản 2", "sk_e2e-pool-elevenlabs-quota-Ab12", {
    status: "exhausted", cooldown_until: "2099-01-15T12:00:00+00:00", last_error: "ElevenLabs TTS lỗi 401: This request exceeds your quota",
  }),
];
const scanPool = [
  poolKey("00000000-0000-4000-8000-00000000a5c1", "elevenlabs", "Quét 1", plantedSecret("elevenlabs-quota")),
  poolKey("00000000-0000-4000-8000-00000000a5c2", "elevenlabs", "Quét 2", plantedSecret("elevenlabs-2")),
  poolKey("00000000-0000-4000-8000-00000000a5c3", "fishaudio", "Quét Fish", plantedSecret("fishaudio-1")),
];
const activePool = () => (secretsScan ? scanPool : providerKeys);
const POOL_PROVIDERS = { elevenlabs: "ElevenLabs", fishaudio: "Fish Audio" };
const publicKeyRow = (row) => Object.fromEntries(Object.entries(row).filter(([k]) => k !== "secret"));

const SERVICE_RPCS = new Set([
  "get_system_secret", "get_provider_key_pool", "get_provider_key_secret", "report_provider_key",
  "record_provider_key_usage", "get_provider_voice_key", "bind_provider_voice",
]);

/** Service-role RPCs (the Next server). `undefined` = not a service-role function. */
function serviceRpc(name, body) {
  const pool = activePool();
  const find = () => pool.find((k) => k.id === body?.p_id);
  switch (name) {
    case "get_system_secret": {
      const key = body?.p_key;
      return secretsScan && SECRET_SETTINGS.some(([k]) => k === key) ? plantedSecret(key) : null;
    }
    case "get_provider_key_pool":
      if (!secretsScan) return [];
      return pool
        .filter((k) => k.provider === body?.p_provider && k.enabled && k.status !== "invalid")
        .map(({ id, label, last4: l4, secret, status, cooldown_until }) => ({ id, label, last4: l4, secret, status, cooldown_until }));
    case "get_provider_key_secret":
      return find()?.secret ?? null;
    case "report_provider_key": {
      const k = find();
      if (!k) return null;
      if (body.p_status) k.status = body.p_status;
      if (body.p_status === "active") k.cooldown_until = null;
      if (body.p_cooldown_until) k.cooldown_until = body.p_cooldown_until;
      if (body.p_error !== undefined) k.last_error = body.p_error;
      if (body.p_credit) Object.assign(k, { credit: body.p_credit, credit_checked_at: new Date().toISOString() });
      return { id: k.id, status: k.status, cooldown_until: k.cooldown_until };
    }
    case "record_provider_key_usage": {
      const k = find();
      if (k) Object.assign(k, { use_count: k.use_count + (body.p_uses ?? 0), char_count: k.char_count + (body.p_chars ?? 0), last_used_at: new Date().toISOString() });
      if (k?.status === "exhausted") Object.assign(k, { status: "active", cooldown_until: null });
      return null;
    }
    case "get_provider_voice_key":
    case "bind_provider_voice":
      return null;
    default:
      return undefined;
  }
}

/** Admin RPCs on the pool (secrets.manage). */
function poolRpc(name, sub, body, permissions) {
  if (!permissions.includes("secrets.manage")) return rpcError(400, "42501", "Chỉ Super admin / Admin quản lý được kho key giọng nói");
  const pool = activePool();
  switch (name) {
    case "list_provider_keys":
      return pool.map(publicKeyRow);
    case "add_provider_key": {
      const provider = body?.p_provider;
      if (!POOL_PROVIDERS[provider]) return rpcError(400, "22023", `Không có nhà cung cấp "${provider}"`);
      const value = String(body?.p_value ?? "").trim();
      if (value.length < 12 || /\s/.test(value)) return rpcError(400, "22023", "Key không hợp lệ (ít nhất 12 ký tự, không có khoảng trắng)");
      if (pool.some((k) => k.provider === provider && k.secret === value)) {
        return rpcError(400, "23505", `Key này đã có trong kho ${POOL_PROVIDERS[provider]} (…${last4(value)})`);
      }

const now = new Date().toISOString();
      const row = poolKey(randomUUID(), provider, String(body?.p_label ?? "").trim().slice(0, 60), value, {
        created_at: now, updated_at: now, created_by_email: USERS[sub]?.email ?? null,
      });
      pool.push(row);
      return { id: row.id, provider, label: row.label, last4: row.last4, enabled: true, status: row.status };
    }
    case "update_provider_key": {
      const k = pool.find((r) => r.id === body?.p_id);
      if (!k) return rpcError(400, "P0002", "Không tìm thấy key");
      if (typeof body.p_label === "string") k.label = body.p_label.trim().slice(0, 60);
      if (typeof body.p_enabled === "boolean") {
        k.enabled = body.p_enabled;
        if (body.p_enabled) Object.assign(k, { status: "active", cooldown_until: null, last_error: null });
      }
      k.updated_at = new Date().toISOString();
      return { id: k.id, label: k.label, enabled: k.enabled, status: k.status };
    }
    case "delete_provider_key": {
      const i = pool.findIndex((r) => r.id === body?.p_id);
      if (i < 0) return rpcError(400, "P0002", "Không tìm thấy key");
      pool.splice(i, 1);
      return { id: body.p_id, deleted: true };
    }
    default:
      return undefined;
  }
}

/**
 * Mock ElevenLabs / Fish Audio (ELEVENLABS_API_BASE / FISH_AUDIO_API_BASE in
 * playwright.config.ts) so no spec ever calls a real provider. The key decides:
 * "quota" → out of credit, "PLANTED" / known e2e keys → OK, anything else → invalid.
 */
const MOCK_AUDIO = Buffer.from("ID3-e2e-mock-mp3");
function providerMock(req, res, path) {
  const json = (status, body) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const audio = () => {
    res.writeHead(200, { "Content-Type": "audio/mpeg" });
    res.end(MOCK_AUDIO);
  };
  if (path.startsWith("/__provider/elevenlabs/")) {
    const key = String(req.headers["xi-api-key"] ?? "");
    const sub = path.slice("/__provider/elevenlabs".length);
    if (key.includes("quota")) return json(401, { detail: { status: "quota_exceeded", message: "This request exceeds your quota" } });
    if (!/PLANTED|x9Qz|e2e-eleven/.test(key)) return json(401, { detail: { status: "invalid_api_key", message: "Invalid API key" } });
    if (sub === "/v1/user/subscription") return json(200, { tier: "starter", character_count: 1500, character_limit: 10000, next_character_count_reset_unix: 4102444800 });
    if (sub === "/v1/voices") return json(200, { voices: [{ voice_id: "e2eVoice1", name: "Giọng mock", category: "premade", labels: {} }] });
    if (sub.startsWith("/v1/text-to-speech/")) return audio();
    return json(200, {});
  }
  if (path.startsWith("/__provider/fish/")) {
    const key = String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    const sub = path.slice("/__provider/fish".length);
    if (key.includes("quota")) return json(402, { message: "Insufficient credits", status: 402 });
    if (!/PLANTED|e2e-fish/.test(key)) return json(401, { message: "Invalid Token", status: 401 });
    if (sub === "/wallet/self/api-credit") return json(200, { credit: "5.5", has_free_credit: false });
    if (sub === "/v1/tts") return audio();
    if (sub.startsWith("/model/")) return json(200, { _id: decodeURIComponent(sub.slice(7)), title: "Giọng Fish mock", languages: ["vi"], visibility: "public" });
    return json(404, { message: "not found", status: 404 });
  }
  return json(404, { message: "not found (mock provider)" });
}

/** Tables whose RLS needs a staff permission (mirrors the SELECT policies). */
const TABLE_PERMISSION = { admin_audit_log: "audit.read" };

function permissionsOf(sub) {
  const role = TABLES.profiles.find((p) => p.id === sub)?.role ?? "user";
  return ROLE_PERMISSIONS[role] ?? [];
}

/** Parent-PIN RPCs (017/018) + RBAC RPCs (019), stateless so parallel specs can't interfere. */
const FEATURE_FLAGS = Object.fromEntries(['story_drawing', 'book_scan', 'expert_review', 'branching_stories', 'vocabulary_quiz', 'multilingual', 'advanced_authoring', 'ai_illustrations', 'child_push', 'ai_ambience', 'missions'].map(k=>[k,true]));
// G-03 missions (migration 034) — the real timing/eligibility rules are covered by tests/db/missions.test.ts;
// this stand-in records every completed session so UI flows can be exercised quickly.
const missionState=new Map();
const MISSIONS_ASSIGNED=["nghe-het-truyen","co-tich"];
const vnDate=(t=Date.now())=>new Date(t+7*3600e3).toISOString().slice(0,10);
function missionsOf(sub){if(!missionState.has(sub))missionState.set(sub,{sessions:new Map(),done:new Map(),stars:new Map(),nights:new Set(),stickers:[],milestones:[],counted:0,habits:new Map(),together:new Set(),constellations:new Set(),notify:{enabled:false,hour:19},devices:new Set()});return missionState.get(sub);}
const weekDays=()=>{const day=vnDate(),d=new Date(day+"T00:00:00Z"),start=new Date(d.getTime()-((d.getUTCDay()+6)%7)*864e5);return [...Array(7)].map((_,i)=>new Date(start.getTime()+i*864e5).toISOString().slice(0,10));};
// G-06/G-07 (migration 036) stand-in: the real proof/unlock/ledger rules are covered by tests/db/missions-parent.test.ts.
const MOCK_HABITS=[
  {id:"lam-dung-gio",kind:"habit",title:"Làm xong đúng giờ",label:"Hôm nay bé tự làm xong một việc đúng giờ (đánh răng, đi ngủ…)",praise:"Bé đã tự làm xong việc của mình đúng giờ, giống Su với chiếc đồng hồ cát!",prompt:"Hỏi bé: “Hôm nay việc gì con tự làm xong mà không cần nhắc?”",afterListen:true},
  {id:"giup-do",kind:"kindness",title:"Giúp đỡ người khác",label:"Hôm nay bé giúp đỡ một người trong nhà",praise:"Cảm ơn bé đã giúp đỡ mọi người.",prompt:"Hỏi bé: “Hôm nay con đã giúp ai? Người đó thấy sao?”",afterListen:false},
];
const MOCK_FAMILY={id:"ca-nha-doc-cung",title:"Cả nhà đọc cùng nhau",label:"Tuần này cả nhà đọc 3 truyện cùng nhau",target:3,praise:"Cả nhà mình đã cùng đọc đủ 3 truyện. Chòm sao của nhà mình sáng lên rồi!"};
const gateTokens=new Map();
const proofOk=(sub,token)=>{const g=gateTokens.get(token);return Boolean(g&&g.sub===sub&&g.exp>Date.now());};
// T11 parent consent (migration 042). Every account has accepted policy v1 except the
// two consent fixtures; POST /__e2e/consent-reset sets an account's state (current
// version, accepted version or none) and GET /__e2e/consent-state reads it back.
const consentDoc=(version)=>{const title="Chính sách quyền riêng tư cho bố mẹ",summary=version===1?"- KểCon lưu những gì bố mẹ nhập và tạo trong app.\n- Không quảng cáo, không bán dữ liệu.":"- Bản "+version+": KểCon cập nhật cách giữ dữ liệu.\n- Không quảng cáo, không bán dữ liệu.",body="## 1. Văn bản này là gì\nĐây là bản "+version+" của chính sách quyền riêng tư dành cho bố mẹ dùng KểCon.\n\n## 5. Nhà cung cấp dịch vụ nhận dữ liệu\n- Tạo chữ và tranh bằng AI: OpenAI, Anthropic, Google (Gemini).\n- Giọng đọc: ElevenLabs hoặc Fish Audio.";return {id:"00000000-0000-4000-8000-0000000c0"+String(version).padStart(3,"0"),version,locale:"vi",title,summary,body,body_sha256:createHash("sha256").update(title+"\n\n"+summary+"\n\n"+body).digest("hex"),published_at:"2026-10-16T00:00:00Z"};};
const CONSENT_FRESH=new Set([MOCK_CONSENT_USER_ID,MOCK_CONSENT_PIN_USER_ID]);
const consentState=new Map();
const consentOf=(sub)=>{if(!consentState.has(sub))consentState.set(sub,{current:1,records:CONSENT_FRESH.has(sub)?[]:[{version:1,accepted_at:now,method:"account_holder",withdrawn_at:null}],calls:[]});return consentState.get(sub);};
const consentActive=(sub)=>{const c=consentOf(sub);return c.records.some(r=>!r.withdrawn_at&&r.version===c.current);};
function consentRpc(name,sub,body,hasPin){
 const c=consentOf(sub),doc=consentDoc(c.current);c.calls.push({name,body});
 const rec=(r)=>r?{version:r.version,accepted_at:r.accepted_at,method:r.method}:null;
 switch(name){
  case "consent_check":return consentActive(sub);
  case "consent_status":{const acc=c.records.find(r=>!r.withdrawn_at&&r.version===c.current),required=!acc;const prev=required?c.records.filter(r=>!r.withdrawn_at&&r.version<c.current).sort((a,b)=>b.version-a.version)[0]:null;const wd=required?c.records.map(r=>r.withdrawn_at).filter(Boolean).sort().pop()??null:null;const {body:text,...meta}=doc;
   return {ok:true,kind:"parent_policy",required,has_pin:hasPin,document:required||body?.p_full?{...meta,body:text}:meta,accepted:required?null:rec(acc),previous:prev?{version:prev.version,accepted_at:prev.accepted_at}:null,withdrawn_at:wd,history:body?.p_full?[...c.records].reverse().map(r=>({...rec(r),withdrawn_at:r.withdrawn_at})):null};}
  case "consent_accept":{if(body?.p_document!==doc.id&&!/^00000000-0000-4000-8000-0000000c0/.test(String(body?.p_document)))return {ok:false,reason:"not_found"};if(body?.p_document!==doc.id||body?.p_body_sha256!==doc.body_sha256)return {ok:false,reason:"stale",current_version:c.current};
   if(hasPin&&!proofOk(sub,body?.p_proof))return {ok:false,reason:"parent_proof_required"};const open=c.records.find(r=>!r.withdrawn_at&&r.version===c.current);if(open)return {ok:true,already:true,version:open.version,accepted_at:open.accepted_at,method:open.method};
   const r={version:c.current,accepted_at:new Date().toISOString(),method:hasPin?"parent_pin":"account_holder",withdrawn_at:null};c.records.push(r);return {ok:true,already:false,version:r.version,accepted_at:r.accepted_at,method:r.method};}
  case "consent_withdraw":{if(body?.p_kind!=="parent_policy")return {ok:false,reason:"invalid_kind"};if(hasPin&&!proofOk(sub,body?.p_proof))return {ok:false,reason:"parent_proof_required"};let n=0;for(const r of c.records)if(!r.withdrawn_at){r.withdrawn_at=new Date().toISOString();r.withdraw_method=hasPin?"parent_pin":"account_holder";n++;}return {ok:true,withdrawn:n};}
 }
}
function familyOf(sub){const m=missionsOf(sub),days=weekDays();const keys=new Set([...m.sessions].filter(([id,x])=>m.together.has(id)&&days.includes(x.date)).map(([,x])=>x.story.id+":"+x.date));const progress=Math.min(MOCK_FAMILY.target,keys.size);return {id:MOCK_FAMILY.id,title:MOCK_FAMILY.title,target:MOCK_FAMILY.target,progress,done:m.constellations.has(days[0])};}
function missionsSummary(sub){
  const m=missionsOf(sub),day=vnDate(),days=weekDays();
  return {date:day,missions:MISSIONS_ASSIGNED.map(id=>({id,done:!!m.done.get(day)?.has(id)})),
    habits:[...(m.habits.get(day)??new Set())].map(id=>MOCK_HABITS.find(h=>h.id===id)).map(h=>({id:h.id,kind:h.kind,title:h.title,line:h.praise})),
    family:familyOf(sub),
    week:{start:days[0],goal:4,nights:days.filter(x=>m.nights.has(x)).length,days:days.map(x=>({date:x,stars:m.stars.get(x)??0,listened:m.nights.has(x)}))},
    totals:{stories:m.counted,stars:[...m.stars.values()].reduce((a,b)=>a+b,0),stickers:m.stickers.length}};
}
function parentRpc(name,sub,body){
  const m=missionsOf(sub),day=vnDate(),days=weekDays();
  if(name==="missions_parent_week")return {summary:missionsSummary(sub),
    stories:[...m.sessions].filter(([,x])=>x.completed&&days.includes(x.date)).reverse().map(([id,x])=>({session_id:id,story_id:x.story.id,title:x.story.title,category:x.story.category??null,date:x.date,together:m.together.has(id),prompt:null})),
    habits:MOCK_HABITS.filter(h=>!h.afterListen||m.counted>0).map(h=>({id:h.id,kind:h.kind,title:h.title,label:h.label,prompt:h.prompt,today:!!m.habits.get(day)?.has(h.id),week:days.filter(x=>m.habits.get(x)?.has(h.id)).length})),
    family:{...familyOf(sub),label:MOCK_FAMILY.label},notify:{...m.notify,devices:m.devices.size}};
  if(name==="parent_device_remove"){m.devices.delete(body.p_endpoint);return {devices:m.devices.size};}
  if(!proofOk(sub,body.p_proof))return rpcError(403,"28000","Parent proof required");
  if(name==="missions_confirm"){
    const h=MOCK_HABITS.find(x=>x.id===body.p_template);if(!h)return rpcError(400,"22023","Mission unavailable");
    if(h.afterListen&&m.counted===0)return rpcError(400,"22023","Mission not unlocked");
    const set=m.habits.get(day)??new Set();m.habits.set(day,set);if(set.has(h.id))return {confirmed:false,reason:"already_confirmed",kind:h.kind};
    set.add(h.id);if(h.kind==="habit")m.stars.set(day,(m.stars.get(day)??0)+1);
    return {confirmed:true,kind:h.kind,star:h.kind==="habit",line:h.praise};
  }
  if(name==="missions_mark_together"){
    const ses=m.sessions.get(body.p_session);if(!ses?.completed||!days.includes(ses.date))return rpcError(400,"22023","Session unavailable");
    m.together.add(body.p_session);const f=familyOf(sub);let fresh=false;
    if(f.progress>=MOCK_FAMILY.target&&!m.constellations.has(days[0])){m.constellations.add(days[0]);fresh=true;}
    return {marked:true,progress:f.progress,target:MOCK_FAMILY.target,done:f.progress>=MOCK_FAMILY.target,constellation:fresh,line:fresh?MOCK_FAMILY.praise:null};
  }
  if(name==="parent_notify_set"){if(typeof body.p_enabled!=="boolean"||!(body.p_hour>=6&&body.p_hour<=21))return rpcError(400,"22023","Invalid reminder");m.notify={enabled:body.p_enabled,hour:body.p_hour};return {...m.notify,devices:m.devices.size};}
  if(name==="parent_device_register"){m.devices.add(body.p_endpoint);return {devices:m.devices.size};}
  return null;
}
const MISSION_TPL=(id,kind,copy={})=>({id,kind,title:null,parent_label:null,praise:null,prompt:null,story_tag:null,story_title:null,target:null,active:true,version:1,updated_at:"2026-10-13T00:00:00Z",done_28d:0,...copy});
const MISSION_STICKER=(n,title,over={})=>({story_id:`00000000-0000-4000-8000-00000000c80${n}`,title,cover_image_url:null,thumbnail_path:null,thumbnail_scene:null,thumbnail_source:null,published:true,enabled:true,updated_at:null,awarded:0,...over});
const MISSIONS_ADMIN={audits:[],templates:[
  MISSION_TPL("nghe-het-truyen","base",{done_28d:12}),
  MISSION_TPL("con-vat","themed",{done_28d:3}),
  MISSION_TPL("tu-cat-do-choi","habit",{title:"Tự cất đồ chơi",parent_label:"Hôm nay bé tự cất đồ chơi về chỗ",praise:"Bé đã tự đưa đồ chơi về đúng chỗ. Đóm thấy bé cố gắng lắm!",prompt:"Hỏi bé: “Món đồ chơi nào thích ở đâu nhất?”",story_tag:"kc-lib:do-choi-muon-ve-nha",story_title:"Đồ chơi muốn về nhà",done_28d:5}),
  MISSION_TPL("chia-se","kindness",{title:"Chia sẻ, chờ đến lượt",parent_label:"Hôm nay bé chia sẻ hoặc chờ đến lượt với bạn",praise:"Cảm ơn bé đã chia sẻ với bạn.",story_tag:"kc-lib:chiec-xe-tai-do",story_title:"Chiếc xe tải đỏ",done_28d:2}),
  MISSION_TPL("ca-nha-doc-cung","family",{title:"Cả nhà đọc cùng nhau",parent_label:"Tuần này cả nhà đọc 3 truyện cùng nhau",praise:"Cả nhà mình đã cùng đọc đủ 3 truyện. Chòm sao của nhà mình sáng lên rồi!",target:3,done_28d:1}),
],stickers:[
  MISSION_STICKER(1,"Chiếc xe tải đỏ",{awarded:4}),
  MISSION_STICKER(2,"Đồ chơi muốn về nhà",{awarded:2}),
  MISSION_STICKER(3,"Sự tích dưa hấu",{published:false}),
]};
const platformLinks=new Map();
const publicLinkStory="00000000-0000-4000-8000-000000009a01";
// Admin › Sao lưu (migration 040 semantics). Times are relative to "now" so the page is healthy;
// POST /__e2e/backup-reset restores it. The worker never runs here: requests stay pending.
const BACKUP_TOKEN_FORMAT = /^(github_pat_|ghp_)[A-Za-z0-9_]{20,250}$/;
function freshBackupState() {
  const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();
  const stamp = (min) => ago(min).replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const summary = { stories: 40, family_stories: 2, media: { files: 683, copied: 0, bytes: 140579254 }, private_buckets: { recordings: 0, "family-avatars": 0 },
    db_snapshots: 7, restore_check: { ok: true, tables: 91, rows: { "public.stories": 40 }, pg_restore_errors: 0, vault: { secrets: 3, decrypted: 3, match: true } },
    main_pushed: true, main_commit: "e67f81f0048a9439a663ebb86b6410cf67b9b323", snapshots_pushed: true, snapshots_commit: "77a3ac87ecacdd21d80bb70ddaee9a4f738af36c",
    retention: { daily: 7, weekly: 4, monthly: 6 }, postgres: "17.6", duration_s: 74 };
  const snaps = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ file: `db-${stamp(90 + d * 1440)}.dump.gpg`, taken: stamp(90 + d * 1440), plain_bytes: 9_800_000, encrypted_bytes: 2_400_000 }));
  return {
    settings: { schedule_time: "03:15", keep_daily: 7, keep_weekly: 4, keep_monthly: 6, version: 1, updated_at: ago(3000), updated_by_email: null },
    token: { is_set: false, last4: null, kind: null, set_at: null, set_by_email: null },
    worker: { heartbeat_at: ago(1), release: "96787f9", repo: "khankingko845-netizen/kecon-backup", push_via: "file_token", passphrase_ok: true,
      token_check: { status: "ok", source: "file_token", kind: "fine_grained", last4: "Ab12", expires_at: new Date(Date.now() + 60 * 86_400_000).toISOString(), push: true, private: true, message: null, checked_at: ago(30) },
      snapshots: snaps },
    runs: [{ id: 1, kind: "cli", status: "ok", phase: null, started_at: ago(92), finished_at: ago(90), exit_code: 0, release: "96787f9", error: null, summary, reason: null, requested_by_email: null }],
    requests: [],
    audits: [],
  };
}
let backupState = freshBackupState();
function backupRpc(name, sub, body, permissions) {
  const B = backupState;
  if (!permissions.includes("backups.manage")) return rpcError(400, "42501", "Permission denied");
  const reasonOf = () => { const r = String(body?.p_reason ?? "").trim(); return r.length >= 10 && r.length <= 500 ? r : null; };
  const open = () => B.requests.find((q) => q.status === "pending" || q.status === "running");
  switch (name) {
    case "admin_backup_status": {
      const now = new Date().toISOString(), q = open();
      const ok = B.runs.filter((r) => r.status === "ok")[0];
      return { now, settings: { ...B.settings }, schedule: { timezone: "Asia/Ho_Chi_Minh", slot: now, slot_done: true, tries: 0, due: false, running: false, next_run_at: new Date(Date.now() + 20 * 3600_000).toISOString() },
        token: { ...B.token }, worker: structuredClone(B.worker), runs: structuredClone(B.runs),
        last_success: ok ? { id: ok.id, kind: ok.kind, started_at: ok.started_at, finished_at: ok.finished_at, summary: ok.summary } : null,
        request: q ? { id: q.id, status: q.status, requested_at: q.requested_at, reason: q.reason, requested_by_email: USERS[q.by]?.email ?? null } : null,
        requests_last_hour: B.requests.filter((r) => Date.parse(r.requested_at) > Date.now() - 3600_000).length,
        limits: { requests_per_hour: 3, keep_daily: [3, 30], keep_weekly: [0, 12], keep_monthly: [0, 24] }, can_set_token: permissions.includes("secrets.manage") };
    }
    case "admin_update_backup_settings": {
      const reason = reasonOf(); if (!reason) return rpcError(400, "22023", "Lý do cần 10–500 ký tự");
      const t = String(body?.p_schedule_time ?? ""), d = body?.p_keep_daily, w = body?.p_keep_weekly, m = body?.p_keep_monthly;
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) return rpcError(400, "22023", "Invalid time");
      if (!(d >= 3 && d <= 30 && w >= 0 && w <= 12 && m >= 0 && m <= 24)) return rpcError(400, "22023", "Invalid retention");
      if (body?.p_expected_version !== B.settings.version) return rpcError(409, "40001", "Settings changed; reload");
      const s = B.settings;
      if (s.schedule_time === t && s.keep_daily === d && s.keep_weekly === w && s.keep_monthly === m) return { changed: false, version: s.version };
      Object.assign(s, { schedule_time: t, keep_daily: d, keep_weekly: w, keep_monthly: m, version: s.version + 1, updated_at: new Date().toISOString(), updated_by_email: USERS[sub]?.email ?? null });
      B.audits.push({ action: "backup.settings_update", reason });
      return { changed: true, version: s.version };
    }
    case "admin_request_backup": {
      const reason = reasonOf(); if (!reason) return rpcError(400, "22023", "Lý do cần 10–500 ký tự");
      if (open() || B.runs.some((r) => r.status === "running")) return rpcError(400, "55006", "A backup is already queued or running");
      if (B.requests.filter((r) => Date.parse(r.requested_at) > Date.now() - 3600_000).length >= 3) return rpcError(400, "54000", "Too many backup requests this hour");
      const q = { id: B.requests.length + 1, status: "pending", requested_at: new Date().toISOString(), reason, by: sub };
      B.requests.push(q); B.audits.push({ action: "backup.run_request", reason });
      return { id: q.id, status: q.status, requested_at: q.requested_at };
    }
    case "admin_set_backup_token": {
      if (!permissions.includes("secrets.manage")) return rpcError(400, "42501", "Permission denied");
      const reason = reasonOf(); if (!reason) return rpcError(400, "22023", "Lý do cần 10–500 ký tự");
      const token = String(body?.p_token ?? "").trim(); if (!BACKUP_TOKEN_FORMAT.test(token)) return rpcError(400, "22023", "Invalid token format");
      const kind = token.startsWith("github_pat_") ? "fine_grained" : "classic", set_at = new Date().toISOString();
      B.token = { is_set: true, last4: token.slice(-4), kind, set_at, set_by_email: USERS[sub]?.email ?? null };
      B.audits.push({ action: "backup.token_set", reason });
      return { last4: token.slice(-4), kind, set_at };
    }
  }
  return undefined;
}

function rpc(name, sub, body, claims={}) {
  const hasPin = sub === MOCK_PIN_USER_ID || sub === MOCK_CONSENT_PIN_USER_ID;
  const rawPermissions = permissionsOf(sub);
  const access=mockAdminAccess(sub,claims);
  const permissions=access.state==="ready"?rawPermissions:[];
  switch (name) {
    case "issue_platform_story_link": {
      if(body.p_story!==publicLinkStory)return rpcError(400,"42501","Only public platform text");
      const token=randomUUID().replaceAll("-","")+randomUUID().replaceAll("-","");const l={id:randomUUID(),story_id:body.p_story,share_token:token,expires_at:new Date(Date.now()+body.p_hours*3600000).toISOString(),is_active:true,view_count:0,owner:sub};platformLinks.set(token,l);const {owner,...out}=l;void owner;return out;
    }
    case "list_platform_story_links":return [...platformLinks.values()].filter(l=>l.owner===sub&&l.story_id===body.p_story).map(l=>({id:l.id,expires_at:l.expires_at,is_active:l.is_active,view_count:l.view_count}));
    case "revoke_platform_story_link": {const l=[...platformLinks.values()].find(l=>l.id===body.p_id&&l.owner===sub);if(!l)return false;l.is_active=false;return true;}
    case "resolve_platform_story_link": {const l=platformLinks.get(body.p_token);if(!l||!l.is_active||Date.parse(l.expires_at)<=Date.now())return null;l.view_count++;return {story:{id:l.story_id,title:"Truyện công khai QA",description:null},pages:[{page_number:1,content:"Chú sóc cùng thỏ đọc truyện."}]};}
    case "missions_today": case "missions_album": case "missions_start_listen": case "missions_complete_listen": {
      if(!FEATURE_FLAGS.missions)return rpcError(400,"42501","Action unavailable");
      const m=missionsOf(sub);
      if(name==="missions_today")return missionsSummary(sub);
      if(name==="missions_album")return {stickers:[...m.stickers].reverse(),milestones:[...m.milestones],constellations:[...m.constellations].map(w=>({week_start:w,earned_on:w}))};
      if(name==="missions_start_listen"){const st=(TABLES.stories??[]).find(x=>x.id===body.p_story);if(!st)return rpcError(400,"22023","Story unavailable");const id=randomUUID();m.sessions.set(id,{story:st,completed:false});return {session_id:id,min_seconds:15};}
      const ses=m.sessions.get(body.p_session);if(!ses)return rpcError(400,"22023","Session unavailable");
      if(ses.completed)return {counted:false,reason:"already_completed"};
      const day=vnDate();ses.completed=true;ses.date=day;m.counted++;m.nights.add(day);
      const done=m.done.get(day)??new Set();m.done.set(day,done);const completed=MISSIONS_ASSIGNED.filter(id=>!done.has(id));completed.forEach(id=>done.add(id));
      m.stars.set(day,(m.stars.get(day)??0)+completed.length);
      let sticker=null;if(ses.story.is_platform_content&&!m.stickers.some(x=>x.story_id===ses.story.id)){sticker={story_id:ses.story.id,title:ses.story.title,cover_image_url:ses.story.cover_image_url??null};m.stickers.push({...sticker,earned_on:day});}
      let milestone=null;for(const n of [1,5,10,25,50,100])if(m.counted>=n&&!m.milestones.includes(n)){m.milestones.push(n);milestone=n;}
      return {counted:true,completed,sticker,milestone,today:missionsSummary(sub)};
    }
    case "missions_parent_week": case "missions_confirm": case "missions_mark_together": case "parent_notify_set": case "parent_device_register": case "parent_device_remove":
      if(!FEATURE_FLAGS.missions)return rpcError(400,"42501","Action unavailable");
      return parentRpc(name,sub,body);
    case "unsubscribe_push": return null;
    case "public_feature_flags": return {...FEATURE_FLAGS};
    case "set_feature_flag": {
      if(!permissions.includes("settings.write"))return rpcError(400,"42501","Forbidden");
      if(!Object.hasOwn(FEATURE_FLAGS,body.p_name)||typeof body.p_enabled!=="boolean"||typeof body.p_expected!=="boolean"||String(body.p_reason??"").trim().length<10)return rpcError(400,"22023","Invalid flag");
      if(FEATURE_FLAGS[body.p_name]!==body.p_expected)return rpcError(400,"40001","Stale flag");
      const changed=FEATURE_FLAGS[body.p_name]!==body.p_enabled;FEATURE_FLAGS[body.p_name]=body.p_enabled;return changed;
    }
    case "admin_confirmed_action":{
      const map={"role.change":"roles.manage","story.trash":"stories.write","story.unpublish":"stories.write","category.delete":"categories.manage","template.delete":"templates.manage","default_voice.delete":"voices.manage"};
      if(!map[body.p_action]||!permissions.includes(map[body.p_action]))return rpcError(400,"42501","Forbidden");
      if(String(body.p_reason??"").trim().length<10)return rpcError(400,"22023","Reason required");
      const table={"role.change":"profiles","story.trash":"stories","story.unpublish":"stories","category.delete":"story_categories","template.delete":"story_templates","default_voice.delete":"default_voices"}[body.p_action];
      const ids=body.p_ids??[],rows=(TABLES[table]??[]).filter(r=>ids.includes(r.id));if(rows.length!==ids.length)return rpcError(400,"40001","Stale targets");
      if(body.p_action==="role.change")rows[0].role=body.p_role;
      else if(body.p_action==="story.trash")rows.forEach(r=>Object.assign(r,{deleted_at:new Date().toISOString(),is_published:false}));
      else if(body.p_action==="story.unpublish")rows.forEach(r=>Object.assign(r,{status:"draft",is_published:false}));
      else TABLES[table]=(TABLES[table]??[]).filter(r=>!ids.includes(r.id));
      return ids.length;
    }
    case "record_measurement_event":return true;
    case "allowed_catalog_voice_ids":return (body.p_voice_ids??[]).filter(id=>!(TABLES.voice_profiles??[]).some(v=>v.elevenlabs_voice_id===id&&v.user_id!==sub));
    case "authorize_tts_voice": {
      const owned=(TABLES.voice_profiles??[]).filter(v=>v.elevenlabs_voice_id===body.p_voice_id&&v.user_id===sub);
      if(owned.some(v=>v.is_active!==false))return "allowed";
      if((TABLES.voice_profiles??[]).some(v=>v.elevenlabs_voice_id===body.p_voice_id&&v.user_id!==sub))return "unavailable";
      const defs=(TABLES.default_voices??[]).filter(v=>v.voice_id===body.p_voice_id&&v.language===body.p_locale);
      if(defs.some(v=>v.is_active!==false)||permissions.includes("voices.manage"))return "allowed";
      return owned.length||defs.length?"disabled":"unavailable";
    }
    case "my_household_context":return {household_id:sub,role:"owner"};
    case "admin_thumbnail_stats":{if(!permissions.includes("stories.read"))return rpcError(400,"42501","Forbidden");const st=TABLES.stories??[];const plat=st.filter(x=>x.is_platform_content&&!x.deleted_at),fam=st.filter(x=>!x.is_platform_content&&!x.deleted_at);const by=k=>plat.filter(x=>x.thumbnail_source===k).length;return {platform:{total:plat.length,with_cover:plat.filter(x=>x.cover_image_url).length,missing:plat.filter(x=>!x.thumbnail_source).length,cover:by("cover"),page:by("page"),upload:by("upload"),scene:by("scene"),icon:by("icon")},family:{total:fam.length,missing:fam.filter(x=>!x.thumbnail_source).length}};}
    // G-08 · admin mission templates + character cards (migration 039 semantics).
    case "admin_missions_catalog":{if(!permissions.includes("templates.manage"))return rpcError(400,"42501","Permission denied");return {templates:MISSIONS_ADMIN.templates.map(t=>({...t})),stickers:MISSIONS_ADMIN.stickers.map(x=>({...x})),since:"2026-09-17"};}
    case "admin_update_mission_template":{
      if(!permissions.includes("templates.manage"))return rpcError(400,"42501","Permission denied");
      const reason=String(body.p_reason??"").trim();if(reason.length<10||reason.length>500)return rpcError(400,"22023","Lý do cần 10–500 ký tự");
      const patch=body.p_patch&&typeof body.p_patch==="object"?body.p_patch:{};if(!Object.keys(patch).length)return rpcError(400,"22023","Nothing to change");
      const t=MISSIONS_ADMIN.templates.find(x=>x.id===body.p_id);if(!t)return rpcError(400,"P0002","Unknown template");
      if(t.version!==body.p_expected_version)return rpcError(409,"40001","Template changed; reload");
      const allowed={base:[],themed:["active"],family:["title","parent_label","praise","target"]}[t.kind]??["title","parent_label","praise","prompt","active"];
      if(Object.keys(patch).some(k=>!allowed.includes(k)))return rpcError(400,"22023","Field not editable");
      const n={...t,...patch};
      if(/(giỏi|thông minh|xuất sắc|thiên tài|liền|liên tục|liên tiếp|thua|phạt)/iu.test([n.title,n.parent_label,n.praise,n.prompt].filter(Boolean).join(" ")))return rpcError(400,"23514",'new row for relation "mission_templates" violates check constraint "mission_templates_process_praise"');
      if(t.kind==="kindness"&&!String(n.praise??"").startsWith("Cảm ơn"))return rpcError(400,"22023","Kindness praise must thank");
      Object.assign(t,patch,{version:t.version+1,updated_at:new Date().toISOString()});MISSIONS_ADMIN.audits.push({action:"mission_template.update",target_id:t.id,reason});
      return {changed:true,version:t.version};
    }
    case "admin_set_mission_sticker":{
      if(!permissions.includes("templates.manage"))return rpcError(400,"42501","Permission denied");
      const reason=String(body.p_reason??"").trim();if(reason.length<10||reason.length>500)return rpcError(400,"22023","Lý do cần 10–500 ký tự");
      const x=MISSIONS_ADMIN.stickers.find(v=>v.story_id===body.p_story);if(!x)return rpcError(400,"P0002","Unknown story");
      if(x.enabled!==body.p_expected)return rpcError(409,"40001","Card changed; reload");
      if(x.enabled===body.p_enabled)return false;
      x.enabled=body.p_enabled;x.updated_at=new Date().toISOString();MISSIONS_ADMIN.audits.push({action:"mission_sticker.update",target_id:x.story_id,reason});
      return true;
    }
    case "missions_weekly_summary":{if(!permissions.includes("analytics.view"))return rpcError(400,"42501","Forbidden");const n=Number(body.p_weeks);if(!(n>=1&&n<=12))return rpcError(400,"22023","Invalid period");const all=[{week_start:"2026-10-12",week_end:"2026-10-18",partial:true,families_listening:3,small_sample:true,avg_nights:1.3,nights_histogram:null,listening:{started:7,finished:4,expired:0,too_fast:1,finish_rate:57,exact:true},missions_done:4,habits:{confirmed:2,families:1},kindness:{thanked:1,families:1},family_reads:{reads:1,families:1,reached_target:0},guardrails:{bedtime_sessions:0,nights_3plus:0,family_nights:4,avg_minutes_per_night:9.5},reminders:{sent:2,failed:0,skipped:1,turned_off:0}},{week_start:"2026-10-05",week_end:"2026-10-11",partial:false,families_listening:6,small_sample:false,avg_nights:2.5,nights_histogram:{"1":2,"2":1,"3":1,"4":1,"5":0,"6":1,"7":0},listening:{started:20,finished:15,expired:1,too_fast:2,finish_rate:75,exact:true},missions_done:15,habits:{confirmed:6,families:3},kindness:{thanked:2,families:2},family_reads:{reads:4,families:2,reached_target:1},guardrails:{bedtime_sessions:1,nights_3plus:1,family_nights:15,avg_minutes_per_night:11.2},reminders:{sent:9,failed:1,skipped:2,turned_off:1}},{week_start:"2026-09-28",week_end:"2026-10-04",partial:false,families_listening:4,small_sample:true,avg_nights:2,nights_histogram:null,listening:{started:9,finished:8,expired:0,too_fast:null,finish_rate:89,exact:false},missions_done:8,habits:{confirmed:0,families:0},kindness:{thanked:0,families:0},family_reads:{reads:0,families:0,reached_target:0},guardrails:{bedtime_sessions:0,nights_3plus:0,family_nights:8,avg_minutes_per_night:10},reminders:{sent:0,failed:0,skipped:0,turned_off:0}}];return {weeks:all.slice(0,Math.min(n,3)),week_count:n,timezone:"Asia/Ho_Chi_Minh",week_starts:"monday",generated_at:"2026-10-14T08:00:00Z",min_families:5,families_total:9,reminders_on:3,funnel_since:"2026-10-05"};}
    case "measurement_summary":if(!permissions.includes("analytics.view"))return rpcError(400,"42501","Forbidden");return {days:body.p_days,since:"2026-10-01T00:00:00Z",timezone:"UTC",costs:[{day:"2026-10-07",provider:"openai",feature:"story.generate",attempts:3,succeeded:1,failed:1,pending:1,estimated_usd:0.00014,unknown_cost:2,byo_attempts:0,input_tokens:100,output_tokens:20}],totals:{attempts:3,estimated_usd:0.00014,unknown_cost:2,pending:1,byo_attempts:0},funnel:{signup:10,home_view:6,first_listen:3,story_created:2}};
    case "set_ai_price_v2":case "set_ai_price": {
      if(!permissions.includes("settings.write"))return rpcError(400,"42501","Forbidden");
      const fish=body.p_provider==="fishaudio";
      if(fish&&(name!=="set_ai_price_v2"||body.p_kind!=="tts"||body.p_billing_unit!=="utf8_bytes"))return rpcError(400,"22023","Byte unit required");
      TABLES.ai_price_rates??=[];
      const row={provider:body.p_provider,model:body.p_model,kind:body.p_kind,input_per_million:body.p_input,output_per_million:body.p_output,unit_usd:body.p_unit,source:body.p_source,updated_at:new Date().toISOString(),billing_unit:fish?"utf8_bytes":null,price_version:fish?2:1};
      const n=TABLES.ai_price_rates.findIndex(r=>r.provider===row.provider&&r.model===row.model&&r.kind===row.kind);
      if(n<0)TABLES.ai_price_rates.push(row);else TABLES.ai_price_rates[n]=row;
      return null;
    }
    case "admin_backup_status": case "admin_update_backup_settings": case "admin_request_backup": case "admin_set_backup_token":
      return backupRpc(name, sub, body, permissions);
    case "admin_access_status":return access;
    case "open_admin_session": {
      if(!rawPermissions.length)return access;
      if(access.requires_mfa&&claims.aal!=="aal2")return {...access,state:"mfa_required"};
      const old=adminSessions.get(claims.session_id),proof=Math.max(...(claims.amr??[]).map(a=>a.timestamp),0);
      if(old&&(old.closed||old.last<Date.now()-1800000)&&proof<=old.proof)return {...access,state:"mfa_required"};
      adminSessions.set(claims.session_id,{sub,last:Date.now(),proof,closed:false});return mockAdminAccess(sub,claims);
    }
    case "touch_admin_session":if(access.state==="ready")adminSessions.get(claims.session_id).last=Date.now();return mockAdminAccess(sub,claims);
    case "close_admin_session":if(adminSessions.has(claims.session_id))adminSessions.get(claims.session_id).closed=true;return mockAdminAccess(sub,claims);
    case "my_admin_permissions":
      return rawPermissions;
    case "has_permission":
      return permissions.includes(body?.p_permission);
    case "parent_pin_status":
      return { ok: true, has_pin: hasPin, reset_required: false, locked_until: null };
    case "verify_parent_pin":
      if (!hasPin) return { ok: false, reason: "no_pin" };
      return body?.p_pin === MOCK_PIN ? { ok: true } : { ok: false, reason: "invalid", attempts_left: 4 };
    case "open_parent_gate": {
      if (!hasPin) return { ok: false, reason: "no_pin" };
      if (body?.p_pin !== MOCK_PIN) return { ok: false, reason: "invalid", attempts_left: 4 };
      const token = randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", "");
      const exp = Date.now() + 15 * 60_000;
      gateTokens.set(token, { sub, exp });
      return { ok: true, gate_token: token, gate_expires_at: new Date(exp).toISOString() };
    }
    case "close_parent_gate":
      gateTokens.delete(body?.p_token);
      return null;
    case "reset_parent_pin":
      // Mock tokens carry no fresh `amr` → the app must ask for the password.
      return { ok: false, reason: "reauth_required" };
    case "list_system_secrets":
      if (!permissions.includes("secrets.manage")) return rpcError(400, "42501", "Chỉ Super admin / Admin xem được trạng thái API key");
      return secretStatuses();
    case "set_system_secret": {
      if (!permissions.includes("secrets.manage")) return rpcError(400, "42501", "Chỉ Super admin / Admin đặt được API key");
      const key = body?.p_key;
      if (!SECRET_SETTINGS.some(([k]) => k === key)) return rpcError(400, "22023", `Không có API key "${key}"`);
      const value = String(body?.p_value ?? "").trim();
      if (!value) {
        vault.delete(key);
        return { key, is_set: false, last4: null, updated_at: null };
      }
      const entry = { value, updated_at: new Date().toISOString(), updated_by_email: USERS[sub]?.email ?? null };
      vault.set(key, entry);
      return { key, is_set: true, last4: last4(value), updated_at: entry.updated_at };
    }
    case "consume_usage":
      return consentActive(sub) ? { allowed: true } : { allowed: false, reason: "consent_required" };
    case "consent_check": case "consent_status": case "consent_accept": case "consent_withdraw":
      return consentRpc(name, sub, body, hasPin);
    case "list_provider_keys":
    case "add_provider_key":
    case "update_provider_key":
    case "delete_provider_key":
      return poolRpc(name, sub, body, permissions);
    default:
      // Service-role-only functions (get_system_secret, get_provider_key_pool, …): EXECUTE is never granted to a signed-in user.
      if (SERVICE_RPCS.has(name)) return rpcError(401, "42501", `permission denied for function ${name}`);
      return null;
  }
}

function readJson(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : null);
      } catch {
        resolve(null);
      }
    });
  });
}

const adminSessions=new Map(),mfaFactors=new Map();
function tokenClaims(auth){try{return JSON.parse(Buffer.from(String(auth??'').replace(/^Bearer\s+/i,'').split('.')[1]??'','base64url').toString())}catch{return {}}}
function mockAdminAccess(sub,claims){
 const permissions=permissionsOf(sub),required=permissions.some(p=>/write|manage|send/.test(p));
 if(!permissions.length)return {state:'forbidden',requires_mfa:false,expires_at:null};
 if(claims.e2e_admin_ready&&!adminSessions.has(claims.session_id))adminSessions.set(claims.session_id,{sub,last:Date.now(),proof:claims.amr?.[0]?.timestamp??0,closed:false});
 const s=adminSessions.get(claims.session_id);let state=required&&claims.aal!=='aal2'?'mfa_required':!s?'session_required':s.closed||s.last<Date.now()-1800000?'session_expired':'ready';
 return {state,requires_mfa:required,expires_at:state==='ready'?new Date(s.last+1800000).toISOString():null};
}
function mockSession(sub,claims){const payload={...claims,aal:'aal2',amr:[...(claims.amr??[]).filter(a=>a.method!=='totp'),{method:'totp',timestamp:Math.floor(Date.now()/1000)}]};return {access_token:[Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),Buffer.from(JSON.stringify(payload)).toString('base64url'),'mock-signature'].join('.'),token_type:'bearer',expires_in:86400,refresh_token:'mock-refresh-token',user:{...USERS[sub],factors:mfaFactors.get(sub)??[]}};}

function tokenSub(auth) {
  const token = (auth ?? "").replace(/^Bearer\s+/i, "");
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString());
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

function compare(a, b) {
  const na = Number(a);
  const nb = Number(b);
  if (a !== "" && b !== "" && Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  const da = Date.parse(a);
  const db = Date.parse(b);
  if (!Number.isNaN(da) && !Number.isNaN(db)) return da - db;
  return String(a).localeCompare(String(b));
}

/** Apply the simple `col=op.value` filters PostgREST receives (eq/is/in/gt/gte/lt/lte/ilike). */
function filterRows(rows, params) {
  let out = rows;
  for (const [key, raw] of params) {
    if (["select", "order", "limit", "offset", "or", "and"].includes(key)) continue;
    const m = /^(eq|is|in|gte|gt|lte|lt|ilike)\.(.*)$/.exec(raw);
    if (!m) continue;
    const [, op, val] = m;
    out = out.filter((r) => {
      const v = r[key];
      if (op === "eq") return String(v) === val;
      if (["gt", "gte", "lt", "lte"].includes(op)) {
        if (v == null) return false;
        const c = compare(String(v), val);
        return op === "gt" ? c > 0 : op === "gte" ? c >= 0 : op === "lt" ? c < 0 : c <= 0;
      }
      if (op === "ilike") {
        if (v == null) return false;
        const re = new RegExp(`^${val.split(/[%*]/).map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`, "i");
        return re.test(String(v));
      }
      if (op === "is") return val === "null" ? v == null : String(v) === val;
      if (op === "in") return val.replace(/^\(|\)$/g, "").split(",").map((x) => x.replace(/"/g, "")).includes(String(v));
      return true;
    });
  }
  const orders=(params.get("order")??"").split(",").filter(Boolean);
  if(orders.length)out=[...out].sort((a,b)=>{for(const order of orders){const [key,dir]=order.split(".");const c=compare(String(a[key]??""),String(b[key]??""));if(c)return dir==="desc"?-c:c;}return 0;});
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

// Household identity fixtures mirror migration 030; this fake is not evidence of RLS.
for (const table of ["profiles","voice_profiles","stories","story_pages","family_members"]) for(const row of TABLES[table]??[]) {
 row.household_id = table==="profiles" ? row.id : table==="story_pages" ? (TABLES.stories.find(s=>s.id===row.story_id)?.household_id??null) : row.is_platform_content ? null : row.user_id;
}
const photos=new Map();
createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  const path = url.pathname;
  if (req.method === "OPTIONS") return send(res, 204);
  if (path === "/health") return send(res, 200, { ok: true });
  if (path.startsWith("/__provider/")) return providerMock(req, res, path);
  if (path === "/__e2e/missions-reset" && req.method === "POST") {
    readJson(req).then((body) => {
      missionState.delete(String(body?.sub ?? ""));
      send(res, 200, { ok: true });
    });
    return;
  }
  if (path === "/__e2e/consent-reset" && req.method === "POST") {
    readJson(req).then((b) => {
      const sub = String(b?.sub ?? "");
      const current = Number.isInteger(b?.current) && b.current >= 1 ? b.current : 1;
      const accepted = Number.isInteger(b?.accepted) ? b.accepted : null;
      consentState.set(sub, { current, records: accepted ? [{ version: accepted, accepted_at: now, method: "account_holder", withdrawn_at: null }] : [], calls: [] });
      send(res, 200, { ok: true });
    });
    return;
  }
  if (path === "/__e2e/consent-state" && req.method === "GET") return send(res, 200, consentOf(String(url.searchParams.get("sub") ?? "")));
  if (path === "/__e2e/backup-reset" && req.method === "POST") {
    backupState = freshBackupState();
    return send(res, 200, { ok: true });
  }
  if (path === "/__e2e/backup-state" && req.method === "GET") return send(res, 200, { requests: backupState.requests, audits: backupState.audits, settings: backupState.settings, token: backupState.token });
  if (path === "/__e2e/secrets-scan" && req.method === "POST") {
    readJson(req).then((body) => {
      secretsScan = Boolean(body?.on);
      send(res, 200, { secretsScan });
    });
    return;
  }

  if(path.startsWith("/storage/v1/object/")){
    const sub=tokenSub(req.headers.authorization);if(!USERS[sub])return send(res,401,{message:"Unauthorized"});
    const relative=path.slice("/storage/v1/object/".length).replace(/^authenticated\//,"");
    if(req.method==="DELETE"&&relative==="family-avatars"){
      readJson(req).then(body=>{for(const p of body?.prefixes??[])if(p.startsWith(`${sub}/`))photos.delete(`family-avatars/${p}`);send(res,200,[]);});return;
    }
    if(!relative.startsWith(`family-avatars/${sub}/`))return send(res,404,{message:"Not found"});
    if(req.method==="POST"){
      const chunks=[];req.on("data",c=>chunks.push(c));req.on("end",()=>{photos.set(relative,Buffer.concat(chunks));send(res,200,{Key:relative,Id:randomUUID()});});return;
    }
    if(req.method==="GET"&&photos.has(relative)){res.writeHead(200,{...CORS,"Content-Type":"image/webp"});res.end(photos.get(relative));return;}
    return send(res,404,{message:"Not found"});
  }

  // ── Auth ──
  if (path === "/auth/v1/user") {
    const sub=tokenSub(req.headers.authorization);const known = USERS[sub]?{...USERS[sub],factors:mfaFactors.get(sub)??[]}:null;
    return known ? send(res, 200, known) : send(res, 401, { code: 401, error_code: "bad_jwt", msg: "invalid JWT" });
  }
  if(path==='/__e2e/mfa-expire'&&req.method==='POST'){readJson(req).then(b=>{const s=adminSessions.get(b.session_id);if(s)s.last=Date.now()-1860000;send(res,200,{ok:Boolean(s)});});return;}
  if(path.startsWith('/auth/v1/factors')){
   const claims=tokenClaims(req.headers.authorization),sub=claims.sub;if(!USERS[sub])return send(res,401,{message:'Unauthorized'});
   const factors=mfaFactors.get(sub)??[];
   if(path==='/auth/v1/factors'&&req.method==='POST'){readJson(req).then(b=>{const f={id:randomUUID(),friendly_name:b.friendly_name,factor_type:'totp',status:'unverified',created_at:new Date().toISOString(),updated_at:new Date().toISOString()};factors.push(f);mfaFactors.set(sub,factors);send(res,200,{id:f.id,type:'totp',totp:{secret:'JBSWY3DPEHPK3PXP',uri:'otpauth://totp/KeCon?secret=JBSWY3DPEHPK3PXP',qr_code:'<svg xmlns="http://www.w3.org/2000/svg" width="220" height="220"><rect width="220" height="220" fill="white"/></svg>'}});});return;}
   const id=path.split('/')[4],f=factors.find(f=>f.id===id);if(!f)return send(res,404,{message:'Unknown factor'});
   if(req.method==='DELETE'){mfaFactors.set(sub,factors.filter(f=>f.id!==id));return send(res,200,{id});}
   if(path.endsWith('/challenge'))return send(res,200,{id:randomUUID(),type:'totp',expires_at:Math.floor(Date.now()/1000)+300});
   if(path.endsWith('/verify')){readJson(req).then(b=>{if(b.code!=='123456')return send(res,422,{code:'mfa_verification_failed',msg:'Invalid code'});f.status='verified';send(res,200,mockSession(sub,claims));});return;}
  }
  if (path.startsWith("/auth/v1/logout")) return send(res, 204);
  if (path.startsWith("/auth/v1/")) return send(res, 400, { error: "invalid_grant", error_description: "mock" });

  // ── PostgREST ──
  if (path.startsWith("/rest/v1/")) {
    const sub = tokenSub(req.headers.authorization);
    const authed = Boolean(USERS[sub]);
    if (path.startsWith("/rest/v1/rpc/")) {
      const name = path.slice("/rest/v1/rpc/".length);
      const isServiceRole = (req.headers.authorization ?? "") === `Bearer ${MOCK_SERVICE_ROLE_KEY}`;
      readJson(req).then((body) => {
        const served = isServiceRole ? serviceRpc(name, body) : undefined;
        if (served !== undefined) return send(res, 200, served);
        const out = name === "public_feature_flags" ? {...FEATURE_FLAGS} : (authed || name === "resolve_platform_story_link") ? rpc(name, sub, body,tokenClaims(req.headers.authorization)) : null;
        if (out && typeof out === "object" && "__rpcError" in out) return send(res, out.__rpcError.status, out.__rpcError.body);
        send(res, 200, out);
      });
      return;
    }
    const table = path.slice("/rest/v1/".length);
    if(["ai_cost_ledger","ai_price_rates"].includes(table)){
      const service=(req.headers.authorization??"")===`Bearer ${MOCK_SERVICE_ROLE_KEY}`;
      if(!service)return send(res,403,{code:"42501",message:"Forbidden"});
      TABLES[table]??=[];
      if(req.method==="GET")return send(res,200,filterRows(TABLES[table],url.searchParams));
      if(req.method==="POST")return readJson(req).then(body=>{TABLES[table].push({...body,status:"pending"});send(res,201,null)});
      if(req.method==="PATCH")return readJson(req).then(body=>{const id=url.searchParams.get("id")?.replace(/^eq\./,"");const r=TABLES[table].find(r=>r.id===id);if(r)Object.assign(r,body);send(res,200,null)});
    }

    if (req.method === "PATCH" && table === "stories" && authed) {
      // PR #49: owners may set the thumbnail columns of their own family stories (RLS mirror).
      readJson(req).then((body) => {
        const keys = ["thumbnail_source", "thumbnail_path", "thumbnail_scene", "thumbnail_updated_at"];
        const patch = Object.fromEntries(Object.entries(body ?? {}).filter(([k]) => keys.includes(k)));
        // Any other story edit keeps the previous generic mock answer.
        if (!Object.keys(patch).length || Object.keys(patch).length !== Object.keys(body ?? {}).length) return send(res, 201, []);
        const rows = filterRows(TABLES.stories, url.searchParams).filter((r) => r.user_id === sub && !r.is_platform_content);
        for (const r of rows) Object.assign(r, patch);
        if ((req.headers.prefer ?? "").includes("return=representation")) return send(res, 200, rows);
        send(res, 204);
      });
      return;
    }
    if (req.method === "PATCH" && table === "profiles" && [MOCK_AGE_USER_ID, MOCK_AVATAR_USER_ID,MOCK_PHOTO_USER_ID].includes(sub)) {
      // Only the isolated age/avatar families may edit their own rows.
      readJson(req).then((body) => {
        // Mirror the schema: family_name / display_name are NOT NULL (001_initial_schema.sql).
        const nulled = ["family_name", "display_name"].find((c) => body && c in body && body[c] === null);
        if (nulled) {
          return send(res, 400, { code: "23502", details: null, hint: null, message: `null value in column "${nulled}" of relation "profiles" violates not-null constraint` });
        }
        const rows = filterRows(TABLES.profiles, url.searchParams).filter((r) => r.id === sub);
        for (const r of rows) Object.assign(r, body ?? {}, { id: r.id });
        if ((req.headers.prefer ?? "").includes("return=representation")) return send(res, 200, rows);
        send(res, 204);
      });
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      return send(res, req.method === "DELETE" ? 204 : 201, req.method === "DELETE" ? undefined : []);
    }
    const allowed = authed && (!TABLE_PERMISSION[table] || permissionsOf(sub).includes(TABLE_PERMISSION[table]));
    const rows = allowed ? filterRows((TABLES[table] ?? []).filter(r=>table!=="voice_profiles"||r.user_id===sub), url.searchParams) : [];
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
