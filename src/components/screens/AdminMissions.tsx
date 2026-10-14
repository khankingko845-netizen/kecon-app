"use client";
/**
 * G-08 · Admin › Nhiệm vụ: mission templates + character cards for "Bầu trời
 * của Đóm" (docs/g08-missions-admin.md). Every save needs a reason and is
 * written to the audit log by the DB (migration 039). Mobile first: cards, not
 * wide tables; 44px targets.
 */
import { useCallback, useEffect, useId, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/Toast";
import { useAdminConfirm } from "@/components/admin/AdminConfirm";
import { AdminDrawer, AdminHeader } from "@/components/admin/AdminUi";
import StoryThumb from "@/components/ui/StoryThumb";
import {
  EDITABLE_FIELDS,
  FIELD_LABELS,
  KIND_LABELS,
  REASON_MAX,
  TEXT_LIMITS,
  draftOf,
  missionsAdminError,
  reasonProblem,
  templatePatch,
  templateTitle,
  validateDraft,
  type AdminMissionSticker,
  type AdminMissionTemplate,
  type AdminMissionsCatalog,
  type MissionDraft,
  type MissionTextField,
} from "@/lib/missions-admin";

const fetchCatalog = async () => {
  const { data, error } = await createClient().rpc("admin_missions_catalog");
  return error || !data ? { error: missionsAdminError(error) } : { data: data as AdminMissionsCatalog };
};

function Status({ on, onLabel, offLabel }: { on: boolean; onLabel: string; offLabel: string }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold ${on ? "bg-green-100 text-green-900" : "bg-gray-200 text-gray-800"}`}>
      {on ? onLabel : offLabel}
    </span>
  );
}

export default function AdminMissions({ onBack }: { onBack: () => void }) {
  const { toast } = useToast();
  const confirm = useAdminConfirm();
  const [state, setState] = useState<{ data?: AdminMissionsCatalog; error?: string } | null>(null);
  const [editing, setEditing] = useState<AdminMissionTemplate | null>(null);
  const [draft, setDraft] = useState<MissionDraft | null>(null);
  const [reason, setReason] = useState("");
  const [tried, setTried] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const ids = useId();

  useEffect(() => {
    let active = true;
    fetchCatalog().then((r) => {
      if (active) setState(r);
    });
    return () => {
      active = false;
    };
  }, []);
  const reload = useCallback(async () => {
    const r = await fetchCatalog();
    setState(r);
    return r.data ?? null;
  }, []);

  const data = state?.data ?? null;
  const open = (t: AdminMissionTemplate) => {
    setEditing(t);
    setDraft(draftOf(t));
    setReason("");
    setTried(false);
    setSaveError("");
  };
  const close = () => {
    setEditing(null);
    setDraft(null);
  };

  const fields = editing ? EDITABLE_FIELDS[editing.kind] : [];
  const errors = editing && draft ? validateDraft(editing, draft) : {};
  const patch = editing && draft ? templatePatch(editing, draft) : {};
  const changed = Object.keys(patch).length > 0;
  const reasonErr = reasonProblem(reason);

  async function save() {
    setTried(true);
    if (!editing || !changed || Object.keys(errors).length > 0 || reasonErr) {
      // On a phone the first problem may be off-screen: move focus there so it
      // scrolls into view and a screen reader reads the message (aria-describedby).
      const first = fields.find((f) => errors[f]) ?? (changed && reasonErr ? "reason" : undefined);
      if (first) requestAnimationFrame(() => document.getElementById(`${ids}-${first}`)?.focus());
      return;
    }
    setBusy("template");
    setSaveError("");
    const { data: r, error } = await createClient().rpc("admin_update_mission_template", {
      p_id: editing.id,
      p_expected_version: editing.version,
      p_patch: patch,
      p_reason: reason.trim(),
    });
    setBusy(null);
    if (error || !r) {
      const msg = missionsAdminError(error);
      setSaveError(msg);
      toast("error", msg);
      if (error?.code === "40001") {
        // Keep what staff typed, compare against the fresh row from now on.
        const fresh = (await reload())?.templates.find((t) => t.id === editing.id);
        if (fresh) setEditing(fresh);
      }
      return;
    }
    toast("success", `Đã lưu “${templateTitle(editing)}” · phiên bản ${(r as { version: number }).version}.`);
    close();
    await reload();
  }

  async function toggleSticker(s: AdminMissionSticker) {
    const pausing = s.enabled;
    const why = await confirm({
      title: pausing ? `Tạm dừng thẻ “${s.title}”?` : `Bật lại thẻ “${s.title}”?`,
      description: pausing
        ? "Bé nghe hết truyện này sẽ không nhận thẻ mới. Thẻ các bé đã có vẫn giữ nguyên trong album."
        : "Bé nghe hết truyện này lần đầu sẽ lại nhận thẻ nhân vật.",
      confirmLabel: pausing ? "Tạm dừng thẻ" : "Bật lại thẻ",
    });
    if (!why) return;
    setBusy(s.story_id);
    const { error } = await createClient().rpc("admin_set_mission_sticker", {
      p_story: s.story_id,
      p_enabled: !s.enabled,
      p_expected: s.enabled,
      p_reason: why,
    });
    setBusy(null);
    if (error) {
      toast("error", missionsAdminError(error));
      if (error.code === "40001") await reload();
      return;
    }
    toast("success", pausing ? `Đã tạm dừng thẻ “${s.title}”.` : `Đã bật lại thẻ “${s.title}”.`);
    await reload();
  }

  const q = query.normalize("NFC").trim().toLowerCase();
  const stickers = (data?.stickers ?? []).filter((s) => !q || s.title.normalize("NFC").toLowerCase().includes(q));
  const textField = (f: MissionTextField) => {
    if (!draft || !fields.includes(f)) return null;
    const id = `${ids}-${f}`,
      err = tried ? errors[f] : undefined,
      [, max] = TEXT_LIMITS[f];
    const Tag = f === "title" ? "input" : "textarea";
    return (
      <div key={f}>
        <label htmlFor={id} className="mb-1.5 block text-sm font-bold">
          {FIELD_LABELS[f]}
        </label>
        <Tag
          id={id}
          value={draft[f]}
          maxLength={max + 20}
          rows={f === "title" ? undefined : 3}
          aria-invalid={Boolean(err)}
          aria-describedby={`${id}-count${err ? ` ${id}-err` : ""}`}
          onChange={(e: { target: { value: string } }) => setDraft({ ...draft, [f]: e.target.value })}
          className="admin-input w-full"
        />
        <p id={`${id}-count`} className="mt-1 text-xs text-ink-2">
          {draft[f].trim().length}/{max} ký tự
        </p>
        {err && (
          <p id={`${id}-err`} className="mt-1 text-sm text-red-800">
            {err}
          </p>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-full">
      <AdminHeader title="Nhiệm vụ & thẻ nhân vật" onBack={onBack} />
      <div className="space-y-6 p-5">
        <p className="max-w-3xl text-sm text-ink-2">
          Đổi câu chữ hoặc bật/tắt cho “Bầu trời của Đóm”. Mỗi thay đổi cần lý do và được ghi vào Nhật ký. Lời khen nói về việc bé làm — không
          dùng “giỏi”, “thông minh”, “liên tục”. Nhiệm vụ hằng ngày và nhiệm vụ cả nhà luôn bật.
        </p>
        {state?.error && (
          <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {state.error}
            <button className="admin-button" onClick={() => void reload()}>
              Thử lại
            </button>
          </div>
        )}
        {!state && <p role="status">Đang tải nhiệm vụ…</p>}

        {data && (
          <>
            <section aria-labelledby={`${ids}-tpl`}>
              <h2 id={`${ids}-tpl`} className="text-lg font-bold">
                Mẫu nhiệm vụ
              </h2>
              <p className="mt-1 text-sm text-ink-2">Số lần xong tính 28 ngày gần nhất, tất cả tài khoản.</p>
              <ul className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2" aria-label="Mẫu nhiệm vụ">
                {data.templates.map((t) => (
                  <li key={t.id} className="flex min-w-0 flex-col gap-2 rounded-xl border border-gray-200 bg-white p-4" data-testid={`mission-${t.id}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="min-w-0 flex-1 font-bold">{templateTitle(t)}</h3>
                      <Status on={t.active} onLabel="Đang bật" offLabel="Đang tắt" />
                    </div>
                    <p className="text-sm text-ink-2">
                      {KIND_LABELS[t.kind]}
                      {t.kind === "family" && t.target ? ` · ${t.target} truyện/tuần` : ""} · xong {t.done_28d} lần · phiên bản {t.version}
                    </p>
                    {t.story_title && <p className="text-sm">Truyện: {t.story_title}</p>}
                    {t.praise && <p className="text-sm italic">“{t.praise}”</p>}
                    <div className="mt-auto">
                      {EDITABLE_FIELDS[t.kind].length > 0 ? (
                        <button className="admin-button" onClick={() => open(t)} aria-label={`Sửa nhiệm vụ ${templateTitle(t)}`}>
                          Sửa
                        </button>
                      ) : (
                        <p className="text-sm text-ink-2">Luôn bật · câu chữ nằm trong ứng dụng</p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            <section aria-labelledby={`${ids}-stk`}>
              <h2 id={`${ids}-stk`} className="text-lg font-bold">
                Thẻ nhân vật
              </h2>
              <p className="mt-1 max-w-3xl text-sm text-ink-2">
                Bé nghe hết một truyện thư viện lần đầu thì nhận 1 thẻ. Tạm dừng chỉ ngừng tặng thẻ mới; thẻ bé đã có không bị lấy lại.
              </p>
              <label htmlFor={`${ids}-q`} className="mt-3 block text-sm font-bold">
                Tìm theo tên truyện
              </label>
              <input id={`${ids}-q`} type="search" value={query} onChange={(e) => setQuery(e.target.value)} className="admin-input mt-1.5 w-full max-w-sm" />
              <ul className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3" aria-label="Thẻ nhân vật">
                {stickers.map((s) => {
                  return (
                    <li key={s.story_id} className="flex min-w-0 flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white p-3" data-testid={`sticker-${s.story_id}`}>
                      <StoryThumb story={{ id: s.story_id, ...s }} className="h-12 w-[72px] shrink-0 rounded-lg" iconSize={28} />
                      <div className="min-w-[9rem] flex-1">
                        <h3 className="line-clamp-2 break-words font-bold">{s.title}</h3>
                        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-2">
                          <span>Đã tặng {s.awarded}</span>
                          <Status on={s.enabled} onLabel="Đang tặng" offLabel="Tạm dừng" />
                          {!s.published && <span>chưa xuất bản</span>}
                        </p>
                      </div>
                      <button
                        className="admin-button ml-auto shrink-0"
                        disabled={busy === s.story_id}
                        onClick={() => void toggleSticker(s)}
                        aria-label={`${s.enabled ? "Tạm dừng" : "Bật lại"} thẻ ${s.title}`}
                      >
                        {s.enabled ? "Tạm dừng" : "Bật lại"}
                      </button>
                    </li>
                  );
                })}
              </ul>
              {stickers.length === 0 && <p className="mt-3 text-sm">Không có truyện nào khớp.</p>}
            </section>
          </>
        )}
      </div>

      <AdminDrawer title={editing ? `Sửa: ${templateTitle(editing)}` : "Sửa nhiệm vụ"} open={Boolean(editing && draft)} onClose={close}>
        {editing && draft && (
          <form
            noValidate
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <p className="text-sm text-ink-2">
              {KIND_LABELS[editing.kind]} · phiên bản {editing.version}
              {editing.story_title ? ` · gắn với truyện “${editing.story_title}”` : ""}
            </p>
            {editing.kind === "themed" && <p className="text-sm">Câu chữ của nhiệm vụ chủ đề nằm trong ứng dụng; ở đây chỉ bật/tắt khỏi vòng xoay.</p>}
            {(["title", "parent_label", "praise", "prompt"] as const).map(textField)}
            {fields.includes("target") && (
              <div>
                <label htmlFor={`${ids}-target`} className="mb-1.5 block text-sm font-bold">
                  Số truyện cả nhà đọc mỗi tuần
                </label>
                <select
                  id={`${ids}-target`}
                  value={draft.target ?? ""}
                  onChange={(e) => setDraft({ ...draft, target: Number(e.target.value) })}
                  className="admin-input w-full max-w-[12rem]"
                >
                  {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                    <option key={n} value={n}>
                      {n} truyện
                    </option>
                  ))}
                </select>
              </div>
            )}
            {fields.includes("active") && (
              <label className="flex min-h-11 items-center gap-3 text-sm font-bold">
                <input type="checkbox" className="h-5 w-5" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />
                Đang bật (bé và bố mẹ thấy nhiệm vụ này)
              </label>
            )}
            <div>
              <label htmlFor={`${ids}-reason`} className="mb-1.5 block text-sm font-bold">
                Lý do thay đổi (10–{REASON_MAX} ký tự, ghi vào Nhật ký)
              </label>
              <textarea
                id={`${ids}-reason`}
                rows={2}
                value={reason}
                maxLength={REASON_MAX}
                aria-invalid={tried && Boolean(reasonErr)}
                aria-describedby={tried && reasonErr ? `${ids}-reason-err` : undefined}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Ví dụ: Sửa câu khen cho tự nhiên hơn theo góp ý phụ huynh"
                className="admin-input w-full"
              />
              {tried && reasonErr && (
                <p id={`${ids}-reason-err`} className="mt-1 text-sm text-red-800">
                  {reasonErr}
                </p>
              )}
            </div>
            {tried && !changed && <p className="text-sm">Chưa có gì thay đổi.</p>}
            {saveError && (
              <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                {saveError}
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-3">
              <button type="button" className="admin-button" onClick={close}>
                Huỷ
              </button>
              <button type="submit" className="min-h-11 rounded-xl bg-accent px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50" disabled={busy === "template"}>
                {busy === "template" ? "Đang lưu…" : "Lưu thay đổi"}
              </button>
            </div>
          </form>
        )}
      </AdminDrawer>
    </div>
  );
}
