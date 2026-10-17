import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Background refreshes (after accept / withdraw) use the browser client.
const browser = vi.hoisted(() => ({ rpc: (async () => ({ data: null, error: { message: "unset" } })) as (name: string, args: unknown) => Promise<unknown> }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc: (name: string, args: unknown) => browser.rpc(name, args) }) }));

import {
  acceptConsent,
  CONSENT_HINT_KEY,
  consentErrorMessage,
  fetchConsentStatus,
  markConsentAccepted,
  markConsentWithdrawn,
  parseConsentStatus,
  readConsentHint,
  refreshConsent,
  getConsentState,
  resetConsentStore,
  startConsentGate,
  withdrawConsent,
  writeConsentHint,
} from "@/lib/consent";
import { parsePolicyBlocks } from "@/components/parent/PolicyText";

const SHA = "a".repeat(64);
const doc = (version = 1, body?: string) => ({
  id: `doc-${version}`,
  version,
  locale: "vi",
  title: "Chính sách quyền riêng tư cho bố mẹ",
  summary: "- Không quảng cáo.",
  body_sha256: SHA,
  published_at: "2026-10-16T00:00:00Z",
  ...(body ? { body } : {}),
});
const statusJson = (over: Record<string, unknown> = {}) => ({
  ok: true,
  kind: "parent_policy",
  required: true,
  has_pin: false,
  document: doc(1, "## 1. Văn bản\nNội dung."),
  accepted: null,
  previous: null,
  withdrawn_at: null,
  history: null,
  ...over,
});

function fake(handler: (name: string, args: unknown) => { data: unknown; error: { message: string; code?: string } | null }) {
  const rpc = vi.fn(async (name: string, args: unknown) => handler(name, args));
  return { client: { rpc } as unknown as SupabaseClient, rpc };
}

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    length: 0,
  };
}

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  resetConsentStore();
  browser.rpc = async () => ({ data: null, error: { message: "unset" } });
});

describe("parseConsentStatus", () => {
  it("maps the RPC JSON and rejects malformed answers", () => {
    const s = parseConsentStatus(statusJson({ has_pin: true, previous: { version: 1, accepted_at: "2026-10-01T00:00:00Z" } }));
    expect(s).toMatchObject({ required: true, hasPin: true, document: { version: 1, body: "## 1. Văn bản\nNội dung." }, previous: { version: 1 } });
    expect(parseConsentStatus({ ok: false, reason: "unauthenticated" })).toBeNull();
    expect(parseConsentStatus(statusJson({ document: { ...doc(), body_sha256: "nope" } }))).toBeNull();
    expect(parseConsentStatus(statusJson({ required: "yes" }))).toBeNull();
    expect(parseConsentStatus(null)).toBeNull();
  });

  it("keeps history rows and drops broken ones", () => {
    const s = parseConsentStatus(
      statusJson({ history: [{ version: 1, accepted_at: "2026-10-02T00:00:00Z", method: "parent_pin", withdrawn_at: "2026-10-03T00:00:00Z" }, { nope: 1 }] }),
    );
    expect(s?.history).toEqual([{ version: 1, accepted_at: "2026-10-02T00:00:00Z", method: "parent_pin", withdrawn_at: "2026-10-03T00:00:00Z" }]);
  });
});

describe("RPC wrappers", () => {
  it("fetchConsentStatus sends locale + full and throws a typed error", async () => {
    const { client, rpc } = fake(() => ({ data: statusJson(), error: null }));
    await expect(fetchConsentStatus(client, { locale: "en", full: true })).resolves.toMatchObject({ required: true });
    expect(rpc).toHaveBeenCalledWith("consent_status", { p_locale: "en", p_full: true });
    const broken = fake(() => ({ data: null, error: { message: "down" } }));
    await expect(fetchConsentStatus(broken.client)).rejects.toMatchObject({ reason: "unavailable" });
    const noDoc = fake(() => ({ data: { ok: false, reason: "no_document" }, error: null }));
    await expect(fetchConsentStatus(noDoc.client)).rejects.toMatchObject({ reason: "no_document" });
  });

  it("acceptConsent sends the exact document id, hash and parent proof", async () => {
    const { client, rpc } = fake(() => ({ data: { ok: true, already: false, version: 1, accepted_at: "2026-10-16T01:00:00Z", method: "parent_pin" }, error: null }));
    const proof = "b".repeat(64);
    await expect(acceptConsent(client, doc(), proof)).resolves.toEqual({ ok: true, version: 1, acceptedAt: "2026-10-16T01:00:00Z", method: "parent_pin", already: false });
    expect(rpc).toHaveBeenCalledWith("consent_accept", { p_document: "doc-1", p_body_sha256: SHA, p_proof: proof });
  });

  it("acceptConsent maps refusals: stale (with the current version), PIN proof, network", async () => {
    const stale = fake(() => ({ data: { ok: false, reason: "stale", current_version: 2 }, error: null }));
    await expect(acceptConsent(stale.client, doc(), null)).resolves.toEqual({ ok: false, reason: "stale", currentVersion: 2 });
    const pin = fake(() => ({ data: { ok: false, reason: "parent_proof_required" }, error: null }));
    await expect(acceptConsent(pin.client, doc(), null)).resolves.toMatchObject({ ok: false, reason: "parent_proof_required" });
    const down = fake(() => ({ data: null, error: { message: "fetch failed" } }));
    await expect(acceptConsent(down.client, doc(), null)).resolves.toMatchObject({ ok: false, reason: "unavailable" });
    const weird = fake(() => ({ data: { ok: false, reason: "drop table" }, error: null }));
    await expect(acceptConsent(weird.client, doc(), null)).resolves.toMatchObject({ ok: false, reason: "unavailable" });
  });

  it("withdrawConsent targets the parent policy with the proof", async () => {
    const { client, rpc } = fake(() => ({ data: { ok: true, withdrawn: 1 }, error: null }));
    await expect(withdrawConsent(client, null)).resolves.toEqual({ ok: true, withdrawn: 1 });
    expect(rpc).toHaveBeenCalledWith("consent_withdraw", { p_kind: "parent_policy", p_proof: null });
    const pin = fake(() => ({ data: { ok: false, reason: "parent_proof_required" }, error: null }));
    await expect(withdrawConsent(pin.client, null)).resolves.toEqual({ ok: false, reason: "parent_proof_required" });
  });

  it("every refusal has a Vietnamese message for parents", () => {
    for (const r of ["stale", "parent_proof_required", "unauthenticated", "no_document", "not_found", "invalid_kind", "unavailable"] as const)
      expect(consentErrorMessage(r)).toMatch(/[a-zà-ỹ]/i);
    expect(consentErrorMessage("stale")).toContain("cập nhật");
  });
});

describe("hint (localStorage)", () => {
  it("is per account and never trusted for another one", () => {
    writeConsentHint("u1", 1);
    expect(readConsentHint("u1")).toBe(1);
    expect(readConsentHint("u2")).toBeNull();
    localStorage.setItem(CONSENT_HINT_KEY, "{bad json");
    expect(readConsentHint("u1")).toBeNull();
    localStorage.setItem(CONSENT_HINT_KEY, JSON.stringify({ uid: "u1", version: 0 }));
    expect(readConsentHint("u1")).toBeNull();
  });
});

describe("gate store", () => {
  const accepted = (version = 1) => statusJson({ required: false, accepted: { version, accepted_at: "2026-10-16T01:00:00Z", method: "account_holder" } });

  it("an account never seen on this device waits for the server; required → gate, hint cleared", async () => {
    writeConsentHint("someone-else", 1);
    startConsentGate("u1");
    expect(getConsentState()).toMatchObject({ uid: "u1", phase: "checking" });
    const { client } = fake(() => ({ data: statusJson(), error: null }));
    await refreshConsent("u1", client);
    expect(getConsentState()).toMatchObject({ uid: "u1", phase: "required", reason: null });
    expect(getConsentState().status?.document.version).toBe(1);
    expect(localStorage.getItem(CONSENT_HINT_KEY)).toBeNull();
  });

  it("accepted → open and the hint remembers this account + version", async () => {
    startConsentGate("u1");
    const { client } = fake(() => ({ data: accepted(), error: null }));
    await refreshConsent("u1", client);
    expect(getConsentState().phase).toBe("ok");
    expect(readConsentHint("u1")).toBe(1);
  });

  it("with a hint the app opens at once; offline keeps it open, a refusal closes it", async () => {
    writeConsentHint("u1", 1);
    startConsentGate("u1");
    expect(getConsentState().phase).toBe("ok");
    await refreshConsent("u1", fake(() => ({ data: null, error: { message: "offline" } })).client);
    expect(getConsentState()).toMatchObject({ phase: "ok", reason: "unavailable" });
    // New policy version (or withdrawn on another device): the server says required.
    await refreshConsent("u1", fake(() => ({ data: statusJson({ previous: { version: 1, accepted_at: "2026-10-01T00:00:00Z" }, document: doc(2, "x") }), error: null })).client);
    expect(getConsentState()).toMatchObject({ phase: "required", status: { previous: { version: 1 }, document: { version: 2 } } });
    expect(readConsentHint("u1")).toBeNull();
  });

  it("no hint and no answer → error (never open)", async () => {
    startConsentGate("u1");
    await refreshConsent("u1", fake(() => ({ data: null, error: { message: "down" } })).client);
    expect(getConsentState()).toMatchObject({ phase: "error", reason: "unavailable" });
  });

  it("drops a late answer for the previous account", async () => {
    startConsentGate("u1");
    let release!: (v: unknown) => void;
    const slow = { rpc: vi.fn(() => new Promise((r) => (release = r))) } as unknown as SupabaseClient;
    const pending = refreshConsent("u1", slow);
    startConsentGate("u2");
    release({ data: accepted(), error: null });
    await pending;
    expect(getConsentState()).toMatchObject({ uid: "u2", phase: "checking" });
    expect(readConsentHint("u1")).toBeNull();
  });

  it("accept opens immediately and confirms in the background; withdraw closes at once", async () => {
    startConsentGate("u1");
    await refreshConsent("u1", fake(() => ({ data: statusJson(), error: null })).client);
    browser.rpc = async () => ({ data: accepted(), error: null });
    markConsentAccepted("u1", { ok: true, version: 1, acceptedAt: "2026-10-16T01:00:00Z", method: "account_holder", already: false });
    expect(getConsentState()).toMatchObject({ phase: "ok", status: { required: false, accepted: { version: 1 } } });
    expect(readConsentHint("u1")).toBe(1);
    await vi.waitFor(() => expect(getConsentState().checkedAt).toBeGreaterThan(0));

    browser.rpc = async () => ({ data: statusJson({ withdrawn_at: "2026-10-16T02:00:00Z" }), error: null });
    markConsentWithdrawn("u1");
    expect(getConsentState().phase).toBe("checking");
    expect(readConsentHint("u1")).toBeNull();
    await vi.waitFor(() => expect(getConsentState().phase).toBe("required"));
    expect(getConsentState().status?.withdrawnAt).toBe("2026-10-16T02:00:00Z");
  });

  it("signing out resets the gate", () => {
    startConsentGate("u1");
    startConsentGate(null);
    expect(getConsentState()).toMatchObject({ uid: null, phase: "idle" });
  });
});

describe("policy text", () => {
  it("parsePolicyBlocks: headings, bullets, paragraphs — text only", () => {
    expect(parsePolicyBlocks("## 1. A\nĐoạn một.\n\n- x\n- y\nSau danh sách\n\n## 2. B\n<script>alert(1)</script>")).toEqual([
      { kind: "h", text: "1. A" },
      { kind: "p", text: "Đoạn một." },
      { kind: "ul", items: ["x", "y"] },
      { kind: "p", text: "Sau danh sách" },
      { kind: "h", text: "2. B" },
      { kind: "p", text: "<script>alert(1)</script>" },
    ]);
  });
});
