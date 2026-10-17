/**
 * T03 · PIN phụ huynh: bcrypt phía server, client không đọc được hash,
 * khoá sau 5 lần sai, dữ liệu btoa cũ bị xoá và buộc đặt lại.
 */
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrationFile, asAnon, asUser, createMigratedDb, listMigrations } from "./supabase-harness";

type PinResult = { ok: boolean; reason?: string; attempts_left?: number; locked_until?: string | null };
type PinStatus = { ok: boolean; has_pin: boolean; reset_required: boolean; locked_until: string | null };

const PIN_MIGRATION = "017_parental_pin.sql";

let db: PGlite;
let legacyUser: string;

async function createUser(): Promise<string> {
  const id = randomUUID();
  await db.query("INSERT INTO auth.users (id, email) VALUES ($1, $2)", [id, `${id}@test.local`]);
  return id;
}

beforeAll(async () => {
  // Apply everything before 017, seed a legacy btoa PIN, then apply 017+ (data migration path).
  ({ db } = await createMigratedDb({ stopBefore: PIN_MIGRATION }));
  legacyUser = await createUser();
  await db.query("INSERT INTO public.parental_controls (user_id, pin_hash, is_enabled) VALUES ($1, $2, true)", [
    legacyUser,
    Buffer.from("1234").toString("base64"),
  ]);
  for (const file of listMigrations().filter((f) => f >= PIN_MIGRATION)) {
    await applyMigrationFile(db, file);
  }
});

afterAll(async () => {
  await db?.close();
});

const setPin = (uid: string, pin: string | null, current?: string) =>
  asUser(db, uid, async (tx) => {
    const { rows } = await tx.query<{ r: PinResult }>("SELECT public.set_parent_pin($1, $2) AS r", [pin, current ?? null]);
    return rows[0].r;
  });

const verifyPin = (uid: string, pin: string) =>
  asUser(db, uid, async (tx) => {
    const { rows } = await tx.query<{ r: PinResult }>("SELECT public.verify_parent_pin($1) AS r", [pin]);
    return rows[0].r;
  });

const status = (uid: string) =>
  asUser(db, uid, async (tx) => {
    const { rows } = await tx.query<{ r: PinStatus }>("SELECT public.parent_pin_status() AS r");
    return rows[0].r;
  });

describe("017 · chuyển dữ liệu PIN cũ", () => {
  it("cột parental_controls.pin_hash (btoa) bị bỏ", async () => {
    const { rows } = await db.query(
      "SELECT 1 FROM information_schema.columns WHERE table_name = 'parental_controls' AND column_name = 'pin_hash'"
    );
    expect(rows).toHaveLength(0);
  });

  it("user có PIN cũ → không còn PIN, bị buộc đặt lại; PIN cũ không dùng được", async () => {
    expect(await status(legacyUser)).toMatchObject({ has_pin: false, reset_required: true });
    expect(await verifyPin(legacyUser, "1234")).toMatchObject({ ok: false, reason: "no_pin" });
    // Giữ nguyên các cài đặt khác của phụ huynh
    const { rows } = await db.query<{ is_enabled: boolean }>(
      "SELECT is_enabled FROM public.parental_controls WHERE user_id = $1",
      [legacyUser]
    );
    expect(rows[0].is_enabled).toBe(true);
  });

  it("đặt PIN mới → hết reset_required", async () => {
    expect(await setPin(legacyUser, "4321")).toEqual({ ok: true });
    expect(await status(legacyUser)).toMatchObject({ has_pin: true, reset_required: false });
  });
});

describe("017 · lưu trữ an toàn", () => {
  it("hash là bcrypt, không giải ngược được, không chứa PIN", async () => {
    const uid = await createUser();
    await setPin(uid, "2468");
    const { rows } = await db.query<{ pin_hash: string }>("SELECT pin_hash FROM public.parental_pins WHERE user_id = $1", [uid]);
    expect(rows[0].pin_hash).toMatch(/^\$2[abxy]?\$10\$/);
    expect(rows[0].pin_hash).not.toContain("2468");
    expect(rows[0].pin_hash).not.toBe(Buffer.from("2468").toString("base64"));
  });

  it("client (authenticated) không đọc/ghi trực tiếp bảng parental_pins", async () => {
    const uid = await createUser();
    await setPin(uid, "1357");
    await expect(asUser(db, uid, (tx) => tx.query("SELECT pin_hash FROM public.parental_pins"))).rejects.toThrow(
      /permission denied/
    );
    await expect(
      asUser(db, uid, (tx) => tx.query("UPDATE public.parental_pins SET failed_attempts = 0 WHERE user_id = $1", [uid]))
    ).rejects.toThrow(/permission denied/);
  });

  it("không gọi trực tiếp được hàm nội bộ _check_parent_pin; anon không gọi được RPC", async () => {
    const uid = await createUser();
    await expect(
      asUser(db, uid, (tx) => tx.query("SELECT public._check_parent_pin($1, '0000')", [uid]))
    ).rejects.toThrow(/permission denied/);
    await expect(asAnon(db, (tx) => tx.query("SELECT public.verify_parent_pin('0000')"))).rejects.toThrow(
      /permission denied/
    );
  });

  it("PIN phải là 4–6 chữ số", async () => {
    const uid = await createUser();
    for (const bad of ["123", "1234567", "12a4", "", null]) {
      expect(await setPin(uid, bad)).toMatchObject({ ok: false, reason: "invalid_format" });
    }
    expect(await setPin(uid, "123456")).toEqual({ ok: true });
  });
});

describe("017 · xác minh & khoá", () => {
  it("đúng PIN → ok; sai → invalid kèm số lần còn lại", async () => {
    const uid = await createUser();
    await setPin(uid, "1111");
    expect(await verifyPin(uid, "1111")).toEqual({ ok: true });
    expect(await verifyPin(uid, "0000")).toEqual({ ok: false, reason: "invalid", attempts_left: 4 });
  });

  it("sai 5 lần → khoá 15 phút, kể cả PIN đúng cũng bị từ chối", async () => {
    const uid = await createUser();
    await setPin(uid, "2222");
    for (let i = 0; i < 4; i++) expect((await verifyPin(uid, "9999")).reason).toBe("invalid");
    const fifth = await verifyPin(uid, "9999");
    expect(fifth.reason).toBe("locked");

    expect(await verifyPin(uid, "2222")).toMatchObject({ ok: false, reason: "locked" });
    const s = await status(uid);
    const minutes = (new Date(s.locked_until!).getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(14);
    expect(minutes).toBeLessThanOrEqual(15.1);
  });

  it("hết thời gian khoá → thử lại được; đúng PIN reset bộ đếm", async () => {
    const uid = await createUser();
    await setPin(uid, "3333");
    for (let i = 0; i < 5; i++) await verifyPin(uid, "0000");
    await db.query("UPDATE public.parental_pins SET locked_until = now() - interval '1 second' WHERE user_id = $1", [uid]);

    expect(await verifyPin(uid, "0000")).toMatchObject({ reason: "invalid", attempts_left: 4 });
    expect(await verifyPin(uid, "3333")).toEqual({ ok: true });
    expect(await verifyPin(uid, "0000")).toMatchObject({ attempts_left: 4 });
  });

  it("đổi PIN cần PIN hiện tại đúng; sai cũng bị tính vào lần khoá", async () => {
    const uid = await createUser();
    await setPin(uid, "4444");
    expect(await setPin(uid, "5555")).toMatchObject({ ok: false, reason: "invalid" });
    expect(await setPin(uid, "5555", "0000")).toMatchObject({ ok: false, reason: "invalid", attempts_left: 3 });
    expect(await setPin(uid, "5555", "4444")).toEqual({ ok: true });
    expect(await verifyPin(uid, "4444")).toMatchObject({ ok: false });
    expect(await verifyPin(uid, "5555")).toEqual({ ok: true });
  });

  it("chưa đặt PIN → verify trả no_pin", async () => {
    const uid = await createUser();
    expect(await verifyPin(uid, "1234")).toEqual({ ok: false, reason: "no_pin" });
    expect(await status(uid)).toMatchObject({ has_pin: false, reset_required: false, locked_until: null });
  });

  it("mỗi user chỉ tác động PIN của chính mình", async () => {
    const a = await createUser();
    const b = await createUser();
    await setPin(a, "7777");
    for (let i = 0; i < 5; i++) await verifyPin(b, "7777");
    expect(await verifyPin(a, "7777")).toEqual({ ok: true });
  });
});
