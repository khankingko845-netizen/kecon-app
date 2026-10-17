import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
vi.mock("@/lib/server-settings", () => ({ getServiceClient: () => null }));
import { ProviderHttpError } from "@/lib/provider-keys";
import {
  deleteProviderVoice,
  isMissingVoice,
  runVoiceDeletions,
  runVoiceDeletionsWithin,
  type DeletionKey,
  type VoiceDeletionDeps,
} from "@/lib/voice-deletion";

const http = (status: number, code: string | null = null, message = "x") => new ProviderHttpError("elevenlabs", status, code, message);

describe("isMissingVoice", () => {
  it("404 / voice_not_found / a 400 saying it does not exist = this account has no such voice", () => {
    expect(isMissingVoice(http(404))).toBe(true);
    expect(isMissingVoice(http(400, "voice_not_found"))).toBe(true);
    expect(isMissingVoice(http(422, "voice_does_not_exist"))).toBe(true);
    expect(isMissingVoice(http(400, null, "A voice with the voice_id abc does not exist."))).toBe(true);
  });
  it("auth / server / network errors are not 'missing' (the deletion is retried)", () => {
    expect(isMissingVoice(http(401, "invalid_api_key"))).toBe(false);
    expect(isMissingVoice(http(500))).toBe(false);
    expect(isMissingVoice(http(0, "network"))).toBe(false);
    expect(isMissingVoice(new Error("404"))).toBe(false);
  });
});

function providerDeps(keys: DeletionKey[], answers: Record<string, "deleted" | "missing" | Error>) {
  const calls: string[] = [];
  return {
    calls,
    keys: vi.fn(async () => keys),
    deleteVoice: vi.fn(async (key: string, voice: string) => {
      calls.push(`delete:${key}:${voice}`);
      const a = answers[key];
      if (a instanceof Error) throw a;
      return a ?? "missing";
    }),
    purgeHistory: vi.fn(async (key: string) => {
      calls.push(`history:${key}`);
      return 3;
    }),
  };
}

describe("deleteProviderVoice", () => {
  it("the voice's own key: history first (while the voice exists), then the voice", async () => {
    const d = providerDeps([{ secret: "own", pinned: true }, { secret: "other", pinned: false }], { own: "deleted" });
    expect(await deleteProviderVoice(d, "v1")).toEqual({ result: "deleted", history: 3 });
    expect(d.calls).toEqual(["history:own", "delete:own:v1"]);
  });
  it("gone at its own key and unknown elsewhere → already_gone", async () => {
    const d = providerDeps([{ secret: "own", pinned: true }, { secret: "other", pinned: false }], {});
    expect((await deleteProviderVoice(d, "v1")).result).toBe("already_gone");
  });
  it("no pinned key, unknown to every key → not_found; found on another key → deleted there", async () => {
    expect((await deleteProviderVoice(providerDeps([{ secret: "a", pinned: false }], {}), "v1")).result).toBe("not_found");
    const d = providerDeps([{ secret: "a", pinned: false }, { secret: "b", pinned: false }], { b: "deleted" });
    expect(await deleteProviderVoice(d, "v1")).toEqual({ result: "deleted", history: 3 });
    expect(d.calls).toEqual(["delete:a:v1", "delete:b:v1", "history:b"]);
  });
  it("a key that failed (not 'missing') makes the outcome uncertain → throws, secret scrubbed", async () => {
    const d = providerDeps([{ secret: "sk_secret_value", pinned: false }], { sk_secret_value: http(500, null, "boom sk_secret_value") });
    await expect(deleteProviderVoice(d, "v1")).rejects.toThrow(/boom/);
    await expect(deleteProviderVoice(d, "v1")).rejects.not.toThrow(/sk_secret_value/);
  });
  it("no ElevenLabs key configured → throws (job retried, never marked done)", async () => {
    await expect(deleteProviderVoice(providerDeps([], {}), "v1")).rejects.toThrow(/no_keys/);
  });
  it("a history purge failure never blocks deleting the voice", async () => {
    const d = providerDeps([{ secret: "own", pinned: true }], { own: "deleted" });
    d.purgeHistory.mockRejectedValue(new Error("missing permission"));
    expect(await deleteProviderVoice(d, "v1")).toEqual({ result: "deleted", history: 0 });
  });
});

type Rpc = (fn: string, args: Record<string, unknown>) => unknown;
function fakeService(handler: Rpc) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const service = {
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      try {
        return { data: await handler(fn, args), error: null };
      } catch (err) {
        return { data: null, error: { message: (err as Error).message } };
      }
    }),
  } as unknown as SupabaseClient;
  return { service, calls };
}

describe("runVoiceDeletions", () => {
  const job = { id: "job-1", provider_voice_id: "v1", provider_done: false, attempts: 1, household_id: "h1" };
  const names = Array.from({ length: 150 }, (_, i) => ({ bucket: "tts-cache", name: `page-${i}.mp3` }));

  function deps(overrides: Partial<VoiceDeletionDeps> = {}, prepared = [...names, { bucket: "voice-consents", name: "h1/c1.webm" }, { bucket: "avatars", name: "x" }]) {
    const { service, calls } = fakeService((fn) => {
      if (fn === "voice_consent_expire") return 2;
      if (fn === "voice_deletion_claim") return [job];
      if (fn === "voice_deletion_prepare") return { storage_paths: prepared, pages_cleared: 150 };
      if (fn === "voice_deletion_finish") return { status: "done" };
      if (fn === "voice_deletion_overdue") return 0;
      throw new Error(`unexpected ${fn}`);
    });
    const removeFiles = vi.fn<(bucket: string, paths: string[]) => Promise<void>>(async () => undefined);
    const d: VoiceDeletionDeps = {
      service,
      keys: async () => [{ secret: "own", pinned: true }],
      deleteVoice: async () => "deleted",
      purgeHistory: async () => 4,
      removeFiles,
      ...overrides,
    };
    return { d, calls, removeFiles };
  }

  it("expire → claim → prepare → provider → files (chunks of 100, known buckets only) → finish", async () => {
    const { d, calls, removeFiles } = deps();
    const summary = await runVoiceDeletions({ householdId: "h1", limit: 5, deps: d });
    expect(summary).toEqual({ expired: 2, claimed: 1, done: 1, pending: 0, errors: 0, overdue: 0 });
    expect(calls.map((c) => c.fn)).toEqual(["voice_consent_expire", "voice_deletion_claim", "voice_deletion_prepare", "voice_deletion_finish", "voice_deletion_overdue"]);
    expect(calls[1].args).toEqual({ p_household: "h1", p_limit: 5 });
    expect(removeFiles.mock.calls.map((c) => [c[0], c[1].length])).toEqual([
      ["tts-cache", 100],
      ["tts-cache", 50],
      ["voice-consents", 1],
    ]);
    const fin = calls.find((c) => c.fn === "voice_deletion_finish")!.args;
    expect(fin.p_provider_result).toBe("deleted");
    expect(fin.p_error).toBeNull();
    expect(fin.p_history_removed).toBe(4);
    expect((fin.p_removed as unknown[]).length).toBe(151);
    expect(JSON.stringify(fin.p_removed)).not.toContain("avatars");
  });
  it("provider failure: files still removed, the job stays open with a scrubbed error", async () => {
    const { d, calls } = deps({
      keys: async () => [{ secret: "sk_live_secret", pinned: true }],
      deleteVoice: async () => {
        throw http(503, null, "upstream down sk_live_secret");
      },
    });
    const summary = await runVoiceDeletions({ deps: d });
    expect(summary?.errors).toBe(1);
    const fin = calls.find((c) => c.fn === "voice_deletion_finish")!.args;
    expect(fin.p_provider_result).toBeNull();
    expect(String(fin.p_error)).toMatch(/^elevenlabs: /);
    expect(String(fin.p_error)).not.toContain("sk_live_secret");
    expect((fin.p_removed as unknown[]).length).toBe(151);
  });
  it("a job whose voice is already gone at the provider does not call the provider again", async () => {
    const deleteVoice = vi.fn(async () => "deleted" as const);
    const { d } = deps({ deleteVoice });
    const { service } = fakeService((fn) => {
      if (fn === "voice_deletion_claim") return [{ ...job, provider_done: true }];
      if (fn === "voice_deletion_prepare") return { storage_paths: [] };
      if (fn === "voice_deletion_finish") return { status: "pending" };
      return 0;
    });
    const summary = await runVoiceDeletions({ deps: { ...d, service } });
    expect(deleteVoice).not.toHaveBeenCalled();
    expect(summary?.pending).toBe(1);
  });
  it("without a service-role client nothing runs (null)", async () => {
    expect(await runVoiceDeletions({})).toBeNull();
  });
  it("runVoiceDeletionsWithin answers 'running' when the budget is spent; the work continues", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { d } = deps({
      deleteVoice: async () => {
        await gate;
        return "deleted";
      },
    });
    expect(await runVoiceDeletionsWithin(20, { deps: d })).toBe("running");
    release();
  });
});
