/**
 * Minimal in-process "Supabase" for migration tests, built on PGlite
 * (Postgres compiled to WASM). No Docker, network or secrets required.
 *
 * - Real `pgcrypto` and `vector` extensions, so migrations run verbatim
 *   (including `CREATE EXTENSION` and pgcrypto's `gen_random_bytes`).
 * - Stubs for the parts of Supabase the migrations depend on: roles
 *   (anon/authenticated/service_role), Supabase's default grants, `auth.users`,
 *   `auth.uid()` (reads the JWT claims GUC like the real one), `storage.*`,
 *   and Supabase Vault (`vault.secrets`, `vault.decrypted_secrets`,
 *   `vault.create_secret` / `vault.update_secret`) with the same signatures and
 *   grants as supabase_vault 0.3 (only service_role may touch it).
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

CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE);
CREATE TABLE auth.mfa_factors(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,status text,factor_type text);

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

-- Supabase Vault stand-in. The real extension encrypts with libsodium; here the
-- stored text is base64(reverse(secret)) — enough to prove nothing stores or
-- returns the plaintext outside \`decrypted_secrets\`.
CREATE SCHEMA vault;
CREATE TABLE vault.secrets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text,
  description text NOT NULL DEFAULT '',
  secret text NOT NULL,
  key_id uuid,
  nonce bytea,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX secrets_name_idx ON vault.secrets (name) WHERE name IS NOT NULL;
CREATE VIEW vault.decrypted_secrets AS
  SELECT s.id, s.name, s.description, s.secret,
         reverse(convert_from(decode(s.secret, 'base64'), 'utf8')) AS decrypted_secret,
         s.key_id, s.nonce, s.created_at, s.updated_at
    FROM vault.secrets s;
CREATE FUNCTION vault.create_secret(new_secret text, new_name text DEFAULT NULL, new_description text DEFAULT '', new_key_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO vault.secrets (secret, name, description, key_id)
  VALUES (encode(convert_to(reverse(new_secret), 'utf8'), 'base64'), new_name, new_description, new_key_id)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
CREATE FUNCTION vault.update_secret(secret_id uuid, new_secret text DEFAULT NULL, new_name text DEFAULT NULL, new_description text DEFAULT NULL, new_key_id uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE vault.secrets s
     SET secret = CASE WHEN new_secret IS NULL THEN s.secret ELSE encode(convert_to(reverse(new_secret), 'utf8'), 'base64') END,
         name = coalesce(new_name, s.name),
         description = coalesce(new_description, s.description),
         updated_at = now()
   WHERE s.id = secret_id;
END $$;
REVOKE ALL ON SCHEMA vault FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA vault FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA vault FROM PUBLIC;
GRANT USAGE ON SCHEMA vault TO service_role;
GRANT SELECT, DELETE ON vault.secrets, vault.decrypted_secrets TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA vault TO service_role;
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
type Role = "anon" | "authenticated" | "service_role";

/**
 * Run `fn` inside a transaction as a PostgREST request would: `SET LOCAL ROLE`
 * plus JWT claims (so `auth.uid()` works). Everything resets on commit/rollback;
 * errors roll back and are re-thrown.
 */
export function asRole<T>(
  db: PGlite,
  role: Role,
  uid: string | null,
  fn: (tx: Tx) => Promise<T>,
  extraClaims: Record<string, unknown> = {}
): Promise<T> {
  return db.transaction(async (tx) => {
    const claims = uid ? { ...extraClaims, sub: uid, role } : { ...extraClaims, role };
    await tx.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    await tx.exec(`SET LOCAL ROLE ${role}`);
    return fn(tx);
  });
}

/** Normal signed-in fixture: staff has a verified MFA/admin session. Security negative tests use asRole with explicit AAL1/expired claims. */
export const asUser = async <T>(db: PGlite, uid: string, fn: (tx: Tx) => Promise<T>, extraClaims?: Record<string, unknown>) => {
  const proof = Math.floor(Date.now()/1000);
  const present = await db.query<{exists:boolean}>("SELECT to_regclass('public.admin_sessions') IS NOT NULL AS exists");
  const role = (await db.query<{role:string}>("SELECT role FROM public.profiles WHERE id=$1",[uid])).rows[0]?.role;
  const staff = role && role !== "user";
  if(present.rows[0].exists && staff){
    await db.query("INSERT INTO auth.sessions(id,user_id) VALUES($1,$1) ON CONFLICT DO NOTHING",[uid]);
    await db.query("INSERT INTO auth.mfa_factors(id,user_id,status,factor_type) VALUES($1,$1,'verified','totp') ON CONFLICT DO NOTHING",[uid]);
    await db.query("INSERT INTO public.admin_sessions(session_id,user_id,auth_at) VALUES($1,$1,$2) ON CONFLICT(session_id) DO UPDATE SET auth_at=$2,last_activity=now(),closed=false",[uid,proof]);
  }
  return asRole(db, "authenticated", uid, fn, {...(staff?{session_id:uid,aal:'aal2',amr:[{method:'totp',timestamp:proof}]}:{}),...extraClaims});
};
export const asAnon = <T>(db: PGlite, fn: (tx: Tx) => Promise<T>) => asRole(db, "anon", null, fn);
