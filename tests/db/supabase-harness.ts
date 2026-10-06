/**
 * Minimal in-process "Supabase" for migration tests, built on PGlite
 * (Postgres compiled to WASM). No Docker, network or secrets required.
 *
 * - Real `pgcrypto` and `vector` extensions, so migrations run verbatim
 *   (including `CREATE EXTENSION` and pgcrypto's `gen_random_bytes`).
 * - Stubs for the parts of Supabase the migrations depend on: roles
 *   (anon/authenticated/service_role), Supabase's default grants, `auth.users`,
 *   `auth.uid()` (reads the JWT claims GUC like the real one), `storage.*`.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { vector } from "@electric-sql/pglite-pgvector";

export const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

const SUPABASE_STUB = /* sql */ `
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE SCHEMA IF NOT EXISTS extensions;

CREATE ROLE anon NOLOGIN NOINHERIT;
CREATE ROLE authenticated NOLOGIN NOINHERIT;
CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;

GRANT USAGE ON SCHEMA public, auth, storage, extensions TO anon, authenticated, service_role;

-- Supabase grants everything in "public" to the API roles by default and
-- relies on RLS + explicit REVOKEs. Mirror that so REVOKEs are meaningful.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;

CREATE TABLE auth.users (
  id uuid PRIMARY KEY,
  email text,
  raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(
    coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
    ), ''
  )::uuid
$$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
$$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon, authenticated, service_role;

CREATE TABLE storage.buckets (
  id text PRIMARY KEY,
  name text NOT NULL,
  public boolean DEFAULT false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz DEFAULT now()
);
CREATE TABLE storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text REFERENCES storage.buckets(id),
  name text,
  owner uuid,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE _parts text[];
BEGIN
  SELECT string_to_array(name, '/') INTO _parts;
  RETURN _parts[1 : array_length(_parts, 1) - 1];
END $$;
`;

export function listMigrations(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

export class MigrationError extends Error {
  constructor(public readonly file: string, cause: unknown) {
    super(`Migration ${file} failed: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

/** Apply one migration file to `db` (used to test data migrations step by step). */
export async function applyMigrationFile(db: PGlite, file: string): Promise<void> {
  const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
  try {
    await db.exec(sql);
  } catch (err) {
    throw new MigrationError(file, err);
  }
}

/**
 * Boot PGlite, install the Supabase stub and apply every migration in order.
 * Throws on the first failure. `stopBefore` (a file name) leaves that
 * migration and later ones unapplied so a test can seed legacy data first.
 */
export async function createMigratedDb(opts: { stopBefore?: string } = {}): Promise<{ db: PGlite; applied: string[] }> {
  const db = await PGlite.create({ extensions: { pgcrypto, vector } });
  await db.exec(SUPABASE_STUB);
  const applied: string[] = [];
  for (const file of listMigrations()) {
    if (opts.stopBefore && file >= opts.stopBefore) break;
    try {
      await applyMigrationFile(db, file);
    } catch (err) {
      await db.close();
      throw err;
    }
    applied.push(file);
  }
  return { db, applied };
}

export type Tx = Transaction;
type Role = "anon" | "authenticated";

/**
 * Run `fn` inside a transaction as a PostgREST request would: `SET LOCAL ROLE`
 * plus JWT claims (so `auth.uid()` works). Everything resets on commit/rollback;
 * errors roll back and are re-thrown.
 */
export function asRole<T>(db: PGlite, role: Role, uid: string | null, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    const claims = uid ? { sub: uid, role } : { role };
    await tx.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    await tx.exec(`SET LOCAL ROLE ${role}`);
    return fn(tx);
  });
}

export const asUser = <T>(db: PGlite, uid: string, fn: (tx: Tx) => Promise<T>) =>
  asRole(db, "authenticated", uid, fn);
export const asAnon = <T>(db: PGlite, fn: (tx: Tx) => Promise<T>) => asRole(db, "anon", null, fn);
