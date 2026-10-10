/**
 * Admin v2 · A-03 — nhật ký thao tác quản trị.
 *
 * Writes to sensitive tables are logged by DB triggers (`audit_<table>`,
 * migration 020) whatever the client does. Admin API routes log the actions
 * that don't touch those tables (provider tests, push, illustration…) through
 * {@link auditAdmin} → `log_admin_action()`; the actor is always `auth.uid()`.
 *
 * `tests/unit/admin-audit.test.ts` scans every staff route: each handler must
 * call `auditAdmin(` or declare `// audit: db-trigger <table>` for a table that
 * has an `audit_<table>` trigger.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** Every action the log can contain (DB triggers + API routes), with its Vietnamese label. */
export const AUDIT_ACTIONS = {
  "flag.create": "Tạo cờ tính năng", "flag.update": "Đổi cờ tính năng", "flag.delete": "Xoá cờ tính năng",
  "measurement.view": "Xem đo lường tổng hợp",
  "pricing.update": "Đổi đơn giá AI",
  "admin_session.open": "Mở phiên quản trị",
  "admin_session.close": "Khoá phiên quản trị",
  "admin_session.revoke": "Thu hồi phiên quản trị",
  "story.unpublish": "Ẩn truyện",
  "user.role_change": "Đổi vai trò",
  "user.plan_change": "Đổi gói cước",
  "user.update": "Sửa hồ sơ người dùng",
  "secret.create": "Thêm API key",
  "secret.update": "Đổi API key",
  "secret.delete": "Xoá API key",
  "provider_key.add": "Thêm key giọng nói",
  "provider_key.update": "Sửa key giọng nói",
  "provider_key.delete": "Xoá key giọng nói",
  "provider_key.status": "Key giọng nói đổi trạng thái",
  "provider_key.check": "Kiểm tra key giọng nói",
  "setting.create": "Thêm cài đặt",
  "setting.update": "Sửa cài đặt",
  "setting.delete": "Xoá cài đặt",
  "story.create": "Tạo truyện",
  "story.update": "Sửa truyện",
  "story.trash": "Chuyển truyện vào thùng rác",
  "story.restore": "Khôi phục truyện",
  "story.delete": "Xoá hẳn truyện",
  "story.illustrate": "Minh hoạ truyện",
  "category.create": "Thêm danh mục",
  "category.update": "Sửa danh mục",
  "category.delete": "Xoá danh mục",
  "template.create": "Thêm mẫu truyện",
  "template.update": "Sửa mẫu truyện",
  "template.delete": "Xoá mẫu truyện",
  "default_voice.create": "Thêm giọng mặc định",
  "default_voice.update": "Sửa giọng mặc định",
  "default_voice.delete": "Xoá giọng mặc định",
  "provider.test": "Thử kết nối nhà cung cấp AI",
  "voice.catalog": "Tải danh sách giọng",
  "voice.preview": "Nghe thử giọng",
  "default_voice.list": "Xem giọng mặc định và giọng đã tắt",
  "voice.import": "Thêm giọng thư viện vào tài khoản",
  "voice.lookup": "Tra cứu giọng ElevenLabs",
  "push.send": "Gửi thông báo đẩy",
} as const;
export type AuditAction = keyof typeof AUDIT_ACTIONS;

export const AUDIT_TARGET_LABELS: Record<string, string> = {
  pricing: "Đơn giá AI",
  admin_session: "Phiên quản trị",
  user: "Người dùng",
  setting: "Cài đặt",
  story: "Truyện",
  category: "Danh mục",
  template: "Mẫu truyện",
  default_voice: "Giọng mặc định",
  provider: "Nhà cung cấp",
  provider_key: "Key giọng nói",
  voice: "Giọng",
  push: "Thông báo",
};

export function auditActionLabel(action: string): string {
  return (AUDIT_ACTIONS as Record<string, string>)[action] ?? action;
}

function formatAuditValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "(trống)";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 80 ? `${text.slice(0, 77)}…` : text;
}

/** Display lines `field: before → after` (one side only for create / delete). */
export function auditChanges(row: { before: Record<string, unknown> | null; after: Record<string, unknown> | null }): string[] {
  const before = row.before ?? {};
  const after = row.after ?? {};
  const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));
  return keys.map((key) => {
    if (!row.before) return `${key}: ${formatAuditValue(after[key])}`;
    if (!row.after) return `${key}: ${formatAuditValue(before[key])}`;
    return `${key}: ${formatAuditValue(before[key])} → ${formatAuditValue(after[key])}`;
  });
}

export interface AuditEntry {
  action: AuditAction;
  targetType?: string;
  targetId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  reason?: string | null;
}

const SENSITIVE_KEY = /(api_?key|apikey|secret|token|password|authorization|cookie)/i;
export const REDACTED = "[đã ẩn]";

/** Deep copy with every credential-looking field masked — API keys never reach the log. */
export function redactSecrets<T>(value: T, depth = 0): T {
  if (depth > 6 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redactSecrets(v, depth + 1)) as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEY.test(k) && v !== null && v !== undefined && v !== "" ? REDACTED : redactSecrets(v, depth + 1);
  }
  return out as T;
}

/** Caller IP as seen by our edge (Cloudflare → Caddy → Next). */
export function requestIp(headers: Headers): string | null {
  const first = (v: string | null) => v?.split(",")[0]?.trim() || null;
  return first(headers.get("cf-connecting-ip")) ?? first(headers.get("x-real-ip")) ?? first(headers.get("x-forwarded-for"));
}

/**
 * Log an admin action before performing it. Fails closed: if the log can't be
 * written the route must not act — returns a 503 Response, otherwise `null`.
 */
export async function auditAdmin(supabase: SupabaseClient, request: Request, entry: AuditEntry): Promise<Response | null> {
  try {
    const { error } = await supabase.rpc("log_admin_action", {
      p_action: entry.action,
      p_target_type: entry.targetType ?? null,
      p_target_id: entry.targetId ?? null,
      p_before: entry.before ? redactSecrets(entry.before) : null,
      p_after: entry.after ? redactSecrets(entry.after) : null,
      p_reason: entry.reason ?? null,
      p_ip: requestIp(request.headers),
      p_user_agent: request.headers.get("user-agent")?.slice(0, 300) ?? null,
    });
    if (!error) return null;
  } catch {
    /* fall through */
  }
  return Response.json({ error: "Không ghi được nhật ký thao tác — thử lại sau", code: "audit_failed" }, { status: 503 });
}
