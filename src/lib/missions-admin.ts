/**
 * G-08 · admin for "Bầu trời của Đóm": mission templates + character cards
 * (docs/g08-missions-admin.md, migration 039). The checks here mirror the DB
 * (036 CHECKs + 039 RPCs) so staff see a problem before saving; the DB stays
 * the authority and returns the same rules as error codes.
 */
import { MISSION_COPY, isMissionId } from "@/lib/missions";

export type MissionKind = "base" | "themed" | "habit" | "kindness" | "family";
export type MissionTextField = "title" | "parent_label" | "praise" | "prompt";
export type MissionField = MissionTextField | "target" | "active";

export interface AdminMissionTemplate {
  id: string;
  kind: MissionKind;
  title: string | null;
  parent_label: string | null;
  praise: string | null;
  prompt: string | null;
  story_tag: string | null;
  story_title: string | null;
  target: number | null;
  active: boolean;
  version: number;
  updated_at: string;
  done_28d: number;
}

export interface AdminMissionSticker {
  story_id: string;
  title: string;
  cover_image_url: string | null;
  thumbnail_path: string | null;
  thumbnail_scene: string | null;
  thumbnail_source: string | null;
  published: boolean;
  enabled: boolean;
  updated_at: string | null;
  awarded: number;
}

export interface AdminMissionsCatalog {
  templates: AdminMissionTemplate[];
  stickers: AdminMissionSticker[];
  since: string;
}

/** What staff may change per kind (same lists as admin_update_mission_template). */
export const EDITABLE_FIELDS: Record<MissionKind, readonly MissionField[]> = {
  base: [],
  themed: ["active"],
  habit: ["title", "parent_label", "praise", "prompt", "active"],
  kindness: ["title", "parent_label", "praise", "prompt", "active"],
  family: ["title", "parent_label", "praise", "target"],
};

export const KIND_LABELS: Record<MissionKind, string> = {
  base: "Hằng ngày",
  themed: "Chủ đề trong app",
  habit: "Thói quen tốt",
  kindness: "Việc tốt",
  family: "Cả nhà",
};

export const FIELD_LABELS: Record<MissionTextField, string> = {
  title: "Tên nhiệm vụ",
  parent_label: "Câu bố mẹ xác nhận",
  praise: "Lời Đóm khen",
  prompt: "Câu hỏi trò chuyện (không bắt buộc)",
};

/** Character limits from migration 036. */
export const TEXT_LIMITS: Record<MissionTextField, readonly [number, number]> = {
  title: [2, 60],
  parent_label: [2, 120],
  praise: [2, 160],
  prompt: [2, 200],
};

/** Same words as CHECK mission_templates_process_praise (036): praise the effort, never the child or a streak. */
export const BANNED_PRAISE = /(giỏi|thông minh|xuất sắc|thiên tài|liền|liên tục|liên tiếp|thua|phạt)/iu;
export const REASON_MIN = 10;
export const REASON_MAX = 500;

export interface MissionDraft {
  title: string;
  parent_label: string;
  praise: string;
  prompt: string;
  target: number | null;
  active: boolean;
}

const clean = (v: string) => v.normalize("NFC").replace(/\s+/g, " ").trim();

export function templateTitle(t: Pick<AdminMissionTemplate, "id" | "title">): string {
  if (t.title) return t.title;
  return isMissionId(t.id) ? MISSION_COPY[t.id].title : t.id;
}

export function draftOf(t: AdminMissionTemplate): MissionDraft {
  return {
    title: t.title ?? "",
    parent_label: t.parent_label ?? "",
    praise: t.praise ?? "",
    prompt: t.prompt ?? "",
    target: t.target,
    active: t.active,
  };
}

/** Field → Vietnamese problem, for the fields this kind can edit. */
export function validateDraft(t: AdminMissionTemplate, d: MissionDraft): Partial<Record<MissionField, string>> {
  const errors: Partial<Record<MissionField, string>> = {};
  const fields = EDITABLE_FIELDS[t.kind];
  for (const f of ["title", "parent_label", "praise", "prompt"] as const) {
    if (!fields.includes(f)) continue;
    const v = clean(d[f]);
    if (f === "prompt" && v === "") continue;
    const [min, max] = TEXT_LIMITS[f];
    if (v.length < min || v.length > max) errors[f] = `Cần ${min}–${max} ký tự (hiện ${v.length}).`;
    else if (BANNED_PRAISE.test(v)) errors[f] = `Bỏ từ “${v.match(BANNED_PRAISE)?.[0]}”: khen việc bé làm, không khen kết quả hay chuỗi ngày.`;
  }
  if (fields.includes("praise") && t.kind === "kindness" && !errors.praise && !clean(d.praise).startsWith("Cảm ơn"))
    errors.praise = "Việc tốt chỉ được cảm ơn bằng lời: câu cần bắt đầu bằng “Cảm ơn”.";
  if (fields.includes("target") && !(Number.isInteger(d.target) && (d.target as number) >= 1 && (d.target as number) <= 7))
    errors.target = "Chọn từ 1 đến 7 truyện mỗi tuần.";
  return errors;
}

/** Only the editable fields that really changed (what the RPC receives). */
export function templatePatch(t: AdminMissionTemplate, d: MissionDraft): Partial<Record<MissionField, string | number | boolean | null>> {
  const patch: Partial<Record<MissionField, string | number | boolean | null>> = {};
  const fields = EDITABLE_FIELDS[t.kind];
  for (const f of ["title", "parent_label", "praise"] as const) if (fields.includes(f) && clean(d[f]) !== (t[f] ?? "")) patch[f] = clean(d[f]);
  if (fields.includes("prompt")) {
    const p = clean(d.prompt) || null;
    if (p !== t.prompt) patch.prompt = p;
  }
  if (fields.includes("target") && d.target !== t.target) patch.target = d.target;
  if (fields.includes("active") && d.active !== t.active) patch.active = d.active;
  return patch;
}

export function reasonProblem(reason: string): string | null {
  const n = reason.trim().length;
  return n >= REASON_MIN && n <= REASON_MAX ? null : `Lý do cần ${REASON_MIN}–${REASON_MAX} ký tự (ghi vào nhật ký).`;
}

/** Supabase RPC error → message for staff (never the raw DB text). */
export function missionsAdminError(error: { code?: string; message?: string } | null | undefined): string {
  const code = error?.code ?? "",
    msg = error?.message ?? "";
  if (code === "42501") return "Không có quyền sửa nhiệm vụ, hoặc phiên quản trị đã hết hạn. Xác thực lại rồi thử lại.";
  if (code === "40001") return "Vừa có người khác đổi mục này. Đã tải lại bản mới nhất — kiểm tra rồi lưu lại.";
  if (code === "23514") return "Câu chữ chưa đạt: kiểm tra độ dài và bỏ các từ như “giỏi”, “thông minh”, “liên tục”.";
  if (code === "P0002") return "Không còn mục này (có thể đã bị xoá). Tải lại trang.";
  if (code === "22023" && /thank/i.test(msg)) return "Việc tốt chỉ được cảm ơn bằng lời: câu khen cần bắt đầu bằng “Cảm ơn”.";
  if (code === "22023" && /Lý do/.test(msg)) return `Lý do cần ${REASON_MIN}–${REASON_MAX} ký tự.`;
  if (code === "22023") return "Giá trị không hợp lệ cho loại nhiệm vụ này.";
  return "Chưa lưu được. Kiểm tra mạng rồi thử lại.";
}
