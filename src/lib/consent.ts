"use client";
/**
 * T11 · Server-side parent consent (migration 042, docs/parent-consent.md).
 *
 * The app opens only after the signed-in parent accepted the CURRENT version of
 * the parent privacy policy; the server decides (`consent_status`) and enforces it
 * for paid AI / voice (consume_usage), reminders and personal-data API routes.
 * This module keeps the latest answer for the page and a small hint in
 * localStorage — `{ uid, version }` — so a family that already consented sees the
 * app at once while the server check runs; the hint never grants anything on the
 * server, and a new version / a withdrawal on another device closes the app as
 * soon as the check returns.
 */
import { useEffect, useSyncExternalStore } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

export type ConsentMethod = "parent_pin" | "account_holder";

export interface ConsentDocument {
  id: string;
  version: number;
  locale: string;
  title: string;
  summary: string;
  /** Present when consent is required or the full text was requested. */
  body?: string;
  body_sha256: string;
  published_at: string;
}

export interface ConsentRecord {
  version: number;
  accepted_at: string;
  method?: ConsentMethod;
  withdrawn_at?: string | null;
}

export interface ConsentStatus {
  required: boolean;
  hasPin: boolean;
  document: ConsentDocument;
  /** Active consent to the current version. */
  accepted: ConsentRecord | null;
  /** Still-open consent to an older version (→ "chính sách đã cập nhật"). */
  previous: ConsentRecord | null;
  /** Latest withdrawal when no consent is active. */
  withdrawnAt: string | null;
  /** Only with `full: true`: newest first, at most 20. */
  history: ConsentRecord[] | null;
}

export type ConsentFailure =
  | "unauthenticated"
  | "not_found"
  | "stale"
  | "parent_proof_required"
  | "invalid_kind"
  | "no_document"
  | "unavailable";

export type AcceptResult =
  | { ok: true; version: number; acceptedAt: string; method: ConsentMethod; already: boolean }
  | { ok: false; reason: ConsentFailure; currentVersion?: number };

export type WithdrawResult = { ok: true; withdrawn: number } | { ok: false; reason: ConsentFailure };

export class ConsentError extends Error {
  constructor(public readonly reason: ConsentFailure) {
    super(reason);
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const SHA = /^[0-9a-f]{64}$/;

function parseDocument(raw: unknown): ConsentDocument | null {
  if (!isObj(raw)) return null;
  const { id, version, locale, title, summary, body, body_sha256, published_at } = raw;
  if (typeof id !== "string" || typeof version !== "number" || typeof title !== "string" || typeof summary !== "string") return null;
  if (typeof body_sha256 !== "string" || !SHA.test(body_sha256)) return null;
  return {
    id,
    version,
    locale: typeof locale === "string" ? locale : "vi",
    title,
    summary,
    body: typeof body === "string" ? body : undefined,
    body_sha256,
    published_at: typeof published_at === "string" ? published_at : "",
  };
}

function parseRecord(raw: unknown): ConsentRecord | null {
  if (!isObj(raw) || typeof raw.version !== "number" || typeof raw.accepted_at !== "string") return null;
  return {
    version: raw.version,
    accepted_at: raw.accepted_at,
    method: raw.method === "parent_pin" || raw.method === "account_holder" ? raw.method : undefined,
    withdrawn_at: typeof raw.withdrawn_at === "string" ? raw.withdrawn_at : null,
  };
}

/** consent_status() JSON → typed status; `null` when malformed or not ok. */
export function parseConsentStatus(raw: unknown): ConsentStatus | null {
  if (!isObj(raw) || raw.ok !== true) return null;
  const document = parseDocument(raw.document);
  if (!document || typeof raw.required !== "boolean") return null;
  return {
    required: raw.required,
    hasPin: raw.has_pin === true,
    document,
    accepted: parseRecord(raw.accepted),
    previous: parseRecord(raw.previous),
    withdrawnAt: typeof raw.withdrawn_at === "string" ? raw.withdrawn_at : null,
    history: Array.isArray(raw.history)
      ? raw.history.map(parseRecord).filter((r): r is ConsentRecord => r !== null)
      : null,
  };
}

const FAILURES = new Set<ConsentFailure>(["unauthenticated", "not_found", "stale", "parent_proof_required", "invalid_kind", "no_document"]);
const failure = (raw: unknown): ConsentFailure =>
  isObj(raw) && typeof raw.reason === "string" && FAILURES.has(raw.reason as ConsentFailure) ? (raw.reason as ConsentFailure) : "unavailable";

export async function fetchConsentStatus(
  supabase: SupabaseClient,
  opts: { locale?: string; full?: boolean } = {},
): Promise<ConsentStatus> {
  const { data, error } = await supabase.rpc("consent_status", { p_locale: opts.locale ?? "vi", p_full: Boolean(opts.full) });
  if (error) throw new ConsentError("unavailable");
  const status = parseConsentStatus(data);
  if (!status) throw new ConsentError(failure(data));
  return status;
}

/** Accept exactly `doc` (id + hash the parent saw). `proof` = parent proof when a PIN is set. */
export async function acceptConsent(
  supabase: SupabaseClient,
  doc: Pick<ConsentDocument, "id" | "body_sha256">,
  proof: string | null,
): Promise<AcceptResult> {
  const { data, error } = await supabase.rpc("consent_accept", {
    p_document: doc.id,
    p_body_sha256: doc.body_sha256,
    p_proof: proof,
  });
  if (error) return { ok: false, reason: "unavailable" };
  if (isObj(data) && data.ok === true && typeof data.version === "number") {
    return {
      ok: true,
      version: data.version,
      acceptedAt: typeof data.accepted_at === "string" ? data.accepted_at : new Date().toISOString(),
      method: data.method === "parent_pin" ? "parent_pin" : "account_holder",
      already: data.already === true,
    };
  }
  return {
    ok: false,
    reason: failure(data),
    currentVersion: isObj(data) && typeof data.current_version === "number" ? data.current_version : undefined,
  };
}

export async function withdrawConsent(supabase: SupabaseClient, proof: string | null): Promise<WithdrawResult> {
  const { data, error } = await supabase.rpc("consent_withdraw", { p_kind: "parent_policy", p_proof: proof });
  if (error) return { ok: false, reason: "unavailable" };
  if (isObj(data) && data.ok === true) return { ok: true, withdrawn: typeof data.withdrawn === "number" ? data.withdrawn : 0 };
  return { ok: false, reason: failure(data) };
}

export function consentErrorMessage(reason: ConsentFailure): string {
  switch (reason) {
    case "stale":
      return "Chính sách vừa được cập nhật. Bố mẹ xem lại bản mới giúp Đóm nhé.";
    case "parent_proof_required":
      return "Cần nhập lại mã PIN phụ huynh để xác nhận.";
    case "unauthenticated":
      return "Phiên đăng nhập đã hết. Bố mẹ đăng nhập lại giúp nhé.";
    case "no_document":
    case "not_found":
      return "Chưa tải được chính sách. Bố mẹ thử lại sau ít phút.";
    default:
      return "Chưa kết nối được máy chủ. Kiểm tra mạng rồi thử lại nhé.";
  }
}

// ── Hint (localStorage): render without waiting when this account already consented.
export const CONSENT_HINT_KEY = "kecon-consent-v2";

export function readConsentHint(uid: string): number | null {
  try {
    const raw = JSON.parse(localStorage.getItem(CONSENT_HINT_KEY) ?? "null") as unknown;
    if (isObj(raw) && raw.uid === uid && typeof raw.version === "number" && raw.version >= 1) return raw.version;
  } catch {
    /* no storage / bad JSON */
  }
  return null;
}

export function writeConsentHint(uid: string, version: number): void {
  try {
    localStorage.setItem(CONSENT_HINT_KEY, JSON.stringify({ uid, version }));
  } catch {
    /* private mode: the server check still runs on every open */
  }
}

export function clearConsentHint(): void {
  try {
    localStorage.removeItem(CONSENT_HINT_KEY);
    localStorage.removeItem("kecon-consent-v1"); // the old banner's choice no longer means anything
  } catch {
    /* ignore */
  }
}

// ── Gate store (one per page): AppShell renders the gate, Settings withdraws.
export type ConsentPhase = "idle" | "checking" | "ok" | "required" | "error";

export interface ConsentGateState {
  uid: string | null;
  phase: ConsentPhase;
  status: ConsentStatus | null;
  reason: ConsentFailure | null;
  checkedAt: number;
}

const IDLE: ConsentGateState = { uid: null, phase: "idle", status: null, reason: null, checkedAt: 0 };
let gate: ConsentGateState = IDLE;
let seq = 0;
let gateLocale = "vi";
const listeners = new Set<() => void>();
const set = (next: ConsentGateState) => {
  gate = next;
  listeners.forEach((l) => l());
};

/** Recheck when the page comes back after this long (new version / withdrawn elsewhere). */
export const CONSENT_RECHECK_MS = 5 * 60_000;

function phaseFor(status: ConsentStatus): ConsentPhase {
  return status.required ? "required" : "ok";
}

/** Ask the server again for `uid`; results for another account or an older request are dropped. */
export async function refreshConsent(uid: string, supabase: SupabaseClient = createClient()): Promise<ConsentGateState> {
  const mine = ++seq;
  try {
    const status = await fetchConsentStatus(supabase, { locale: gateLocale });
    if (mine !== seq || gate.uid !== uid) return gate;
    if (status.required) clearConsentHint();
    else if (status.accepted) writeConsentHint(uid, status.accepted.version);
    set({ uid, phase: phaseFor(status), status, reason: null, checkedAt: Date.now() });
  } catch (err) {
    if (mine !== seq || gate.uid !== uid) return gate;
    const reason = err instanceof ConsentError ? err.reason : "unavailable";
    // Offline with a hint: keep the app open (cached stories); the server still refuses paid work.
    if (gate.phase === "ok") set({ ...gate, reason, checkedAt: Date.now() });
    else set({ uid, phase: "error", status: gate.status, reason, checkedAt: Date.now() });
  }
  return gate;
}

/** After a successful accept: open the app now, confirm in the background. */
export function markConsentAccepted(uid: string, result: Extract<AcceptResult, { ok: true }>): void {
  if (gate.uid !== uid) return;
  writeConsentHint(uid, result.version);
  const status = gate.status
    ? { ...gate.status, required: false, accepted: { version: result.version, accepted_at: result.acceptedAt, method: result.method } }
    : null;
  set({ uid, phase: "ok", status, reason: null, checkedAt: Date.now() });
  void refreshConsent(uid);
}

/** After a withdrawal: close the app at once (the gate asks again). */
export function markConsentWithdrawn(uid: string): void {
  clearConsentHint();
  if (gate.uid !== uid) return;
  set({ ...gate, phase: "checking" });
  void refreshConsent(uid);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Current gate state (outside React). */
export function getConsentState(): ConsentGateState {
  return gate;
}

/**
 * Point the gate at `uid` (null = signed out). A new account starts "ok" when this
 * device already saw it consent (hint), otherwise "checking" — refreshConsent decides.
 */
export function startConsentGate(uid: string | null): void {
  if (!uid) {
    if (gate.uid !== null) set(IDLE);
    return;
  }
  if (gate.uid === uid) return;
  seq++; // answers still in flight for the previous account are dropped
  set({ uid, phase: readConsentHint(uid) ? "ok" : "checking", status: null, reason: null, checkedAt: 0 });
}

/** Read the gate state (Settings › Quyền riêng tư). */
export function useConsentState(): ConsentGateState {
  return useSyncExternalStore(subscribe, getConsentState, () => IDLE);
}

/**
 * Drive the gate for the signed-in account (AppShell). `uid` undefined = signed out
 * or auth still loading.
 */
export function useConsentGate(uid: string | undefined, locale: string): ConsentGateState {
  const state = useConsentState();
  useEffect(() => {
    gateLocale = locale || "vi";
  }, [locale]);
  useEffect(() => {
    startConsentGate(uid ?? null);
    if (!uid) return;
    void refreshConsent(uid);
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - gate.checkedAt > CONSENT_RECHECK_MS) void refreshConsent(uid);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [uid]);
  return state;
}

/** Test hook: forget the page state. */
export function resetConsentStore(): void {
  seq++;
  gate = IDLE;
  listeners.forEach((l) => l());
}
