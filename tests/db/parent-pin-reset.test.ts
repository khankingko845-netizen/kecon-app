/**
 * T19 · Quên PIN: reset_parent_pin() chỉ chạy khi phiên vừa đăng nhập lại
 * (claim `amr` của JWT ≤ 10 phút); bé / phiên cũ không tự xoá PIN được.
 */
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asUser, createMigratedDb } from "./supabase-harness";

type Result = { ok: boolean; reason?: string; attempts_left?: number; locked_until?: string | null };

let db: PGlite;

beforeAll(async () => {
  ({ db } = await createMigratedDb());
});

afterAll(async () => {
  await db?.close();
});

async function createUser(): Promise<string> {
  const id = randomUUID();
  await db.query("INSERT INTO auth.users (id, email) VALUES ($1, $2)", [id, `${id}@test.local`]);
  return id;
}

const nowSec = () => Math.floor(Date.now() / 1000);
const amr = (method: string, secondsAgo: number) => ({ amr: [{ method, timestamp: nowSec() - secondsAgo }] });

const rpc = (uid: string, sql: string, params: unknown[] = [], claims?: Record<string, unknown>) =>
  asUser(
    db,
    uid,
    async (tx) => {
      const { rows } = await tx.query<{ r: Result }>(sql, params);
      return rows[0].r;
    },
    claims
  );

const setPin = (uid: string, pin: string, current?: string) =>
  rpc(uid, "SELECT public.set_parent_pin($1, $2) AS r", [pin, current ?? null]);
const verifyPin = (uid: string, pin: string) => rpc(uid, "SELECT public.verify_parent_pin($1) AS r", [pin]);
const reset = (uid: string, claims?: Record<string, unknown>) => rpc(uid, "SELECT public.reset_parent_pin() AS r", [], claims);
const status = (uid: string) => rpc(uid, "SELECT public.parent_pin_status() AS r");

describe("018 · reset_parent_pin", () => {
  it("không có amr / amr cũ hơn 10 phút → reauth_required, PIN giữ nguyên", async () => {
    const uid = await createUser();
    await setPin(uid, "2468");
    expect(await reset(uid)).toEqual({ ok: false, reason: "reauth_required" });
    expect(await reset(uid, amr("password", 11 * 60))).toEqual({ ok: false, reason: "reauth_required" });
    expect(await verifyPin(uid, "2468")).toEqual({ ok: true });
  });

  it("amr kiểu chuỗi, anonymous hoặc timestamp tương lai không được tính", async () => {
    const uid = await createUser();
    await setPin(uid, "1357");
    expect(await reset(uid, { amr: ["pwd"] })).toMatchObject({ reason: "reauth_required" });
    expect(await reset(uid, amr("anonymous", 5))).toMatchObject({ reason: "reauth_required" });
    expect(await reset(uid, amr("password", -3600))).toMatchObject({ reason: "reauth_required" });
    expect(await reset(uid, { amr: [{ method: "password", timestamp: "abc" }] })).toMatchObject({ reason: "reauth_required" });
    expect((await status(uid)).ok).toBe(true);
    expect(await verifyPin(uid, "1357")).toEqual({ ok: true });
  });

  it("vừa đăng nhập lại (mật khẩu hoặc OAuth) → xoá PIN, gỡ khoá, buộc đặt PIN mới", async () => {
    const uid = await createUser();
    await setPin(uid, "1111");
    for (let i = 0; i < 5; i++) await verifyPin(uid, "0000");
    expect(await verifyPin(uid, "1111")).toMatchObject({ ok: false, reason: "locked" });

    expect(await reset(uid, amr("password", 30))).toEqual({ ok: true });
    expect(await status(uid)).toMatchObject({ has_pin: false, reset_required: true, locked_until: null });
    expect(await verifyPin(uid, "1111")).toMatchObject({ ok: false, reason: "no_pin" });

    // Đặt PIN mới không cần PIN cũ
    expect(await setPin(uid, "9876")).toEqual({ ok: true });
    expect(await status(uid)).toMatchObject({ has_pin: true, reset_required: false });

    expect(await reset(uid, amr("oauth", 60))).toEqual({ ok: true });
  });

  it("user chưa từng có PIN vẫn reset được (idempotent)", async () => {
    const uid = await createUser();
    expect(await reset(uid, amr("otp", 1))).toEqual({ ok: true });
    expect(await status(uid)).toMatchObject({ has_pin: false, reset_required: true });
  });

  it("chỉ tác động tới PIN của chính mình", async () => {
    const a = await createUser();
    const b = await createUser();
    await setPin(a, "4444");
    await setPin(b, "5555");
    expect(await reset(a, amr("password", 10))).toEqual({ ok: true });
    expect(await verifyPin(b, "5555")).toEqual({ ok: true });
  });

  it("anon không gọi được; hàm nội bộ _recent_reauth bị chặn với client", async () => {
    const uid = await createUser();
    await expect(asAnon(db, (tx) => tx.query("SELECT public.reset_parent_pin()"))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, uid, (tx) => tx.query("SELECT public._recent_reauth()"))).rejects.toThrow(/permission denied/);
  });
});
