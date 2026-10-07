/**
 * Minimal fake Supabase for E2E (auth + PostgREST), so logged-in screens can
 * be tested without a real project. Only the token minted by `fixtures.ts`
 * is accepted — any other token gets 401, keeping the API-auth specs honest.
 *
 *   node tests/e2e/support/mock-supabase.mjs   # listens on :54321
 */
import { randomUUID } from "node:crypto";
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
  "analytics.view", "audit.read", "categories.manage", "dashboard.view", "moderation.manage", "notifications.send", "roles.manage", "secrets.manage",
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
  profiles: [{...adminProfile,id:MOCK_A15_ADMIN_ID,email:"e2e-a15-admin@kecon.test",family_name:"Đội UI",role:"super_admin"},{...profile,id:MOCK_A15_TARGET_ID,family_name:"Gia đình Xác nhận",display_name:"QA Xác nhận"},profile, pinProfile, ageProfile, adminProfile, editorProfile, {...adminProfile,id:MOCK_MFA_USER_ID,email:"e2e-mfa@kecon.test"}, { ...profile, id: MOCK_AVATAR_USER_ID, email: avatarUser.email }, {...profile,id:MOCK_PHOTO_USER_ID}, {...profile,id:MOCK_VOICE_USER_ID}],
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
const FEATURE_FLAGS = Object.fromEntries(['gamification', 'story_drawing', 'book_scan', 'expert_review', 'branching_stories', 'vocabulary_quiz', 'multilingual', 'advanced_authoring', 'ai_illustrations', 'child_push', 'ai_ambience'].map(k=>[k,true]));
function rpc(name, sub, body, claims={}) {
  const hasPin = sub === MOCK_PIN_USER_ID;
  const rawPermissions = permissionsOf(sub);
  const access=mockAdminAccess(sub,claims);
  const permissions=access.state==="ready"?rawPermissions:[];
  switch (name) {
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
    case "measurement_summary":if(!permissions.includes("analytics.view"))return rpcError(400,"42501","Forbidden");return {days:body.p_days,since:"2026-10-01T00:00:00Z",timezone:"UTC",costs:[{day:"2026-10-07",provider:"openai",feature:"story.generate",attempts:3,succeeded:1,failed:1,pending:1,estimated_usd:0.00014,unknown_cost:2,byo_attempts:0,input_tokens:100,output_tokens:20}],totals:{attempts:3,estimated_usd:0.00014,unknown_cost:2,pending:1,byo_attempts:0},funnel:{signup:10,home_view:6,first_listen:3,story_created:2}};
    case "set_ai_price":if(!permissions.includes("settings.write"))return rpcError(400,"42501","Forbidden");return null;
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
      return { allowed: true };
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

const photos=new Map();
createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  const path = url.pathname;
  if (req.method === "OPTIONS") return send(res, 204);
  if (path === "/health") return send(res, 200, { ok: true });
  if (path.startsWith("/__provider/")) return providerMock(req, res, path);
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
        const out = name === "public_feature_flags" ? {...FEATURE_FLAGS} : authed ? rpc(name, sub, body,tokenClaims(req.headers.authorization)) : null;
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
