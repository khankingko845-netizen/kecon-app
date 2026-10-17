/**
 * T10 · Hồ sơ bé (docs/child-profiles.md) — pure helpers shared by the app and the API.
 *
 * A household has 1–5 child profiles (the DB guard in migration 044 enforces the limit,
 * the household, the creator and consent). Age is computed from the birth year only;
 * no full date of birth is stored. The child chosen on this device ("bé đang nghe")
 * drives the greeting, the kid UI age band, suggestions and story creation.
 */
import { DEFAULT_AGE_BAND, normalizeAgeBand, type AgeBandId } from "@/lib/age-bands";

export const MAX_CHILD_PROFILES = 5;
export const MAX_CHILD_INTERESTS = 5;
export const MAX_CHILD_NAME_LENGTH = 40;
export const MAX_INTEREST_LENGTH = 24;
/** Ages offered when adding a child (KểCon is for 1–12); the DB also keeps legacy ages up to 18. */
export const PICKER_MAX_AGE = 12;
export const DB_MAX_AGE = 18;

export interface ChildProfile {
  id: string;
  display_name: string;
  birth_year: number | null;
  interests: string[];
  created_at?: string;
}

/** Columns the app reads (never household_id/created_by: they are server-managed). */
export const CHILD_PROFILE_COLUMNS = "id, display_name, birth_year, interests, created_at";

export const INTEREST_SUGGESTIONS = [
  "Khủng long",
  "Xe cộ",
  "Động vật",
  "Công chúa",
  "Siêu nhân",
  "Vũ trụ",
  "Biển cả",
  "Âm nhạc",
  "Vẽ tranh",
  "Bóng đá",
] as const;

const VN_YEAR = new Intl.DateTimeFormat("en", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric" });

/** Calendar year in Việt Nam (the DB guard uses the same time zone). */
export function vnYear(now: Date = new Date()): number {
  return Number(VN_YEAR.format(now));
}

export function childAge(birthYear: number | null | undefined, now: Date = new Date()): number | null {
  if (typeof birthYear !== "number" || !Number.isInteger(birthYear)) return null;
  const age = vnYear(now) - birthYear;
  return age >= 0 ? age : null;
}

/** Age band of a child; unknown birth year → the default band (3–5). */
export function childBand(child: Pick<ChildProfile, "birth_year"> | null | undefined, now: Date = new Date()): AgeBandId {
  const age = childAge(child?.birth_year, now);
  return age === null ? DEFAULT_AGE_BAND : normalizeAgeBand(age);
}

export function ageLabel(birthYear: number | null | undefined, now: Date = new Date()): string {
  const age = childAge(birthYear, now);
  if (age === null) return "Chưa có năm sinh";
  return age === 0 ? "Dưới 1 tuổi" : `${age} tuổi`;
}

export function birthYearOptions(now: Date = new Date()): { year: number; age: number }[] {
  const year = vnYear(now);
  return Array.from({ length: PICKER_MAX_AGE + 1 }, (_, age) => ({ year: year - age, age }));
}

const clean = (raw: string) => raw.normalize("NFC").replace(/\s+/g, " ").trim();
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

export function normalizeChildName(raw: string): string {
  return clean(raw ?? "");
}

export function normalizeInterests(list: readonly string[]): string[] {
  const out: string[] = [];
  for (const item of list ?? []) {
    const tag = clean(String(item ?? ""));
    if (tag && !out.some((t) => t.toLocaleLowerCase("vi") === tag.toLocaleLowerCase("vi"))) out.push(tag);
  }
  return out;
}

export interface ChildDraft {
  displayName: string;
  birthYear: number | null;
  interests: string[];
}

export type ChildDraftResult =
  | { ok: true; value: { display_name: string; birth_year: number; interests: string[] } }
  | { ok: false; field: "name" | "birthYear" | "interests"; message: string };

export function validateChildDraft(draft: ChildDraft, now: Date = new Date()): ChildDraftResult {
  // Control characters are checked before whitespace is collapsed (a bell/escape is not a space).
  const rawName = String(draft.displayName ?? "").replace(/[\t\n\r]/g, " ");
  const name = normalizeChildName(rawName);
  if (!name || name.length > MAX_CHILD_NAME_LENGTH || CONTROL.test(rawName)) {
    return { ok: false, field: "name", message: `Nhập tên gọi của bé (tối đa ${MAX_CHILD_NAME_LENGTH} ký tự).` };
  }
  const year = draft.birthYear;
  const age = typeof year === "number" ? childAge(year, now) : null;
  if (age === null || age > DB_MAX_AGE) return { ok: false, field: "birthYear", message: "Chọn năm sinh của bé." };
  const interests = normalizeInterests(draft.interests ?? []);
  if (interests.length > MAX_CHILD_INTERESTS || interests.some((t) => t.length > MAX_INTEREST_LENGTH || CONTROL.test(t))) {
    return { ok: false, field: "interests", message: `Tối đa ${MAX_CHILD_INTERESTS} sở thích, mỗi sở thích tối đa ${MAX_INTEREST_LENGTH} ký tự.` };
  }
  return { ok: true, value: { display_name: name, birth_year: year as number, interests } };
}

/** The child chosen on this device if it still exists, otherwise the first (oldest) profile. */
export function pickActiveChild<T extends ChildProfile>(children: readonly T[], storedId: string | null | undefined): T | null {
  return children.find((c) => c.id === storedId) ?? children[0] ?? null;
}

export const activeChildKey = (uid: string) => `kecon-active-child:${uid}`;
export const pendingChildKey = (uid: string) => `kecon-pending-child:${uid}`;

export function childNames(children: readonly Pick<ChildProfile, "display_name">[]): string {
  return children.map((c) => c.display_name).join(", ");
}

export function childInitial(name: string): string {
  const first = Array.from(normalizeChildName(name ?? ""))[0];
  return first ? first.toLocaleUpperCase("vi") : "?";
}

/** Signup keeps the child's name/year on the device until the parent has consented (T11). */
export interface PendingChild {
  displayName: string;
  birthYear: number | null;
}

export function parsePendingChild(raw: string | null | undefined): PendingChild | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as { displayName?: unknown; birthYear?: unknown };
    const displayName = normalizeChildName(typeof data.displayName === "string" ? data.displayName : "");
    if (!displayName) return null;
    const birthYear = typeof data.birthYear === "number" && Number.isInteger(data.birthYear) ? data.birthYear : null;
    return { displayName: displayName.slice(0, MAX_CHILD_NAME_LENGTH), birthYear };
  } catch {
    return null;
  }
}

const ERRORS: [RegExp, string][] = [
  [/child_profile_limit/, `Mỗi gia đình có tối đa ${MAX_CHILD_PROFILES} hồ sơ bé.`],
  [/consent_required/, "Bố mẹ cần đồng ý chính sách quyền riêng tư trước khi thêm hoặc sửa hồ sơ bé."],
  [/invalid_child_name/, `Tên gọi của bé chưa hợp lệ (1–${MAX_CHILD_NAME_LENGTH} ký tự).`],
  [/invalid_birth_year/, "Năm sinh chưa hợp lệ."],
  [/invalid_child_interest|too_many_child_interests/, `Tối đa ${MAX_CHILD_INTERESTS} sở thích, mỗi sở thích tối đa ${MAX_INTEREST_LENGTH} ký tự.`],
  [/household_scope/, "Hồ sơ bé này không thuộc gia đình của bạn."],
];

/** DB/PostgREST error → a short Vietnamese message (never the raw error). */
export function childErrorMessage(error: unknown): string {
  const text = error && typeof error === "object" && "message" in error ? String((error as { message?: unknown }).message ?? "") : "";
  return ERRORS.find(([re]) => re.test(text))?.[1] ?? "Chưa lưu được hồ sơ bé. Thử lại nhé.";
}

/** Story prompts: the child's interests as plain data (quotes/brackets/line breaks removed). */
export function interestsPromptLine(interests: readonly string[] | null | undefined): string | null {
  const list = normalizeInterests((interests ?? []).map((t) => String(t).replace(/["'`<>{}[\]\\]/g, "")))
    .map((t) => t.slice(0, 40))
    .slice(0, MAX_CHILD_INTERESTS);
  return list.length ? `Bé thích: ${list.join(", ")} (lồng ghép nhẹ nhàng nếu hợp với truyện, không bắt buộc).` : null;
}
