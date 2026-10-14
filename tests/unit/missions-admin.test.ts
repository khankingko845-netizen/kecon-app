import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import {
  BANNED_PRAISE,
  EDITABLE_FIELDS,
  TEXT_LIMITS,
  draftOf,
  missionsAdminError,
  reasonProblem,
  templatePatch,
  templateTitle,
  validateDraft,
  type AdminMissionTemplate,
} from "@/lib/missions-admin";
import { canOpenSection, sectionFromSegments, sectionsFor } from "@/lib/admin-routes";

const migration = (f: string) => readFileSync(join(process.cwd(), "supabase", "migrations", f), "utf8");
const tpl = (over: Partial<AdminMissionTemplate> = {}): AdminMissionTemplate => ({
  id: "tu-cat-do-choi",
  kind: "habit",
  title: "Tự cất đồ chơi",
  parent_label: "Hôm nay bé tự cất đồ chơi về chỗ",
  praise: "Bé đã tự đưa đồ chơi về đúng chỗ. Đóm thấy bé cố gắng lắm!",
  prompt: "Hỏi bé: “Món đồ chơi nào thích ở đâu?”",
  story_tag: "kc-lib:do-choi-muon-ve-nha",
  story_title: "Đồ chơi muốn về nhà",
  target: null,
  active: true,
  version: 3,
  updated_at: "2026-10-14T00:00:00Z",
  done_28d: 4,
  ...over,
});

describe("G-08 · same rules as the database", () => {
  it("banned praise words and text limits match migration 036; editable fields match 039", () => {
    const m036 = migration("036_missions_parent.sql");
    const words = /mission_templates_process_praise\s+CHECK \(concat_ws\([^)]*\) !~\* '\(([^']+)\)'\)/.exec(m036)?.[1];
    expect(words?.split("|")).toEqual(BANNED_PRAISE.source.slice(1, -1).split("|"));
    for (const [f, [min, max]] of Object.entries(TEXT_LIMITS)) expect(m036).toContain(`${f} IS NULL OR char_length(${f}) BETWEEN ${min} AND ${max}`);
    const m039 = migration("039_missions_admin.sql");
    expect(m039).toContain("WHEN 'base' THEN '{}'::text[]");
    expect(m039).toContain(`WHEN 'themed' THEN ARRAY['${EDITABLE_FIELDS.themed.join("', '")}']`);
    expect(m039).toContain(`WHEN 'family' THEN ARRAY['${EDITABLE_FIELDS.family.join("', '")}']`);
    expect(m039).toContain(`ELSE ARRAY['${EDITABLE_FIELDS.habit.join("', '")}']`);
    expect(EDITABLE_FIELDS.kindness).toEqual(EDITABLE_FIELDS.habit);
  });
});

describe("G-08 · draft checks before saving", () => {
  it("flags length, result/streak praise and kindness that does not thank", () => {
    const t = tpl();
    expect(validateDraft(t, draftOf(t))).toEqual({});
    expect(validateDraft(t, { ...draftOf(t), title: "x" }).title).toMatch(/2–60/);
    expect(validateDraft(t, { ...draftOf(t), praise: "Bé GIỎI quá!" }).praise).toMatch(/“GIỎI”/);
    expect(validateDraft(t, { ...draftOf(t), parent_label: "Bé cất đồ chơi liên tục 3 ngày" }).parent_label).toMatch(/liên tục/);
    expect(validateDraft(t, { ...draftOf(t), prompt: "" })).toEqual({}); // optional
    const k = tpl({ id: "chia-se", kind: "kindness", praise: "Cảm ơn bé đã chia sẻ với bạn." });
    expect(validateDraft(k, draftOf(k))).toEqual({});
    expect(validateDraft(k, { ...draftOf(k), praise: "Bé chia sẻ với bạn rồi!" }).praise).toMatch(/Cảm ơn/);
    const f = tpl({ id: "ca-nha-doc-cung", kind: "family", target: 3, prompt: null });
    expect(validateDraft(f, { ...draftOf(f), target: 8 }).target).toMatch(/1 đến 7/);
    // Fields this kind cannot edit are never checked (themed copy lives in the app).
    expect(validateDraft(tpl({ kind: "themed", title: null, praise: null, parent_label: null }), draftOf(tpl({ kind: "themed", title: null })))).toEqual({});
  });

  it("sends only changed, editable fields — trimmed, NFC, empty prompt as null", () => {
    const t = tpl();
    expect(templatePatch(t, draftOf(t))).toEqual({});
    const nfd = "Bé đã tự cất đồ chơi gọn gàng!".normalize("NFD");
    expect(templatePatch(t, { ...draftOf(t), praise: `  ${nfd}  `, prompt: " ", active: false })).toEqual({
      praise: "Bé đã tự cất đồ chơi gọn gàng!",
      prompt: null,
      active: false,
    });
    const f = tpl({ kind: "family", target: 3 });
    expect(templatePatch(f, { ...draftOf(f), target: 2, active: false })).toEqual({ target: 2 }); // family cannot be switched off
    expect(templatePatch(tpl({ kind: "base" }), { ...draftOf(tpl()), title: "Khác", active: false })).toEqual({});
  });

  it("reason 10–500 characters; RPC errors become plain Vietnamese, never raw DB text", () => {
    expect(reasonProblem("ngắn")).toMatch(/10–500/);
    expect(reasonProblem("Sửa câu khen cho tự nhiên hơn")).toBeNull();
    expect(missionsAdminError({ code: "40001", message: "Template changed; reload" })).toMatch(/người khác đổi/);
    expect(missionsAdminError({ code: "23514", message: 'new row violates check constraint "mission_templates_process_praise"' })).toMatch(/giỏi/);
    expect(missionsAdminError({ code: "22023", message: "Kindness praise must thank" })).toMatch(/Cảm ơn/);
    expect(missionsAdminError({ code: "42501", message: "Permission denied" })).toMatch(/quyền/);
    expect(missionsAdminError({ code: "XX000", message: "secret internals" })).not.toMatch(/internals/);
    expect(templateTitle({ id: "co-tich", title: null })).toBe("Nghe một truyện cổ tích");
  });
});

describe("G-08 · admin section", () => {
  it("/admin/missions opens for templates.manage only", () => {
    expect(sectionFromSegments(["missions"])?.screen).toBe("admin-missions");
    expect(canOpenSection("admin-missions", ["templates.manage"])).toBe(true);
    expect(canOpenSection("admin-missions", ["analytics.view", "dashboard.view"])).toBe(false);
    expect(sectionsFor(["templates.manage"]).map((s) => s.slug)).toEqual(["templates", "missions"]);
  });
});
