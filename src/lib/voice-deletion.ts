/**
 * T12 · Voice deletion worker (migration 043, docs/voice-consent.md). A withdrawn
 * consent, a deleted family voice or a deleted account leaves a job in
 * voice_deletion_jobs; this deletes, within 24 hours:
 *  - the voice at ElevenLabs (with every key of the pool, the voice's own key first)
 *    and its generation history there (best effort),
 *  - the sample + consent recordings and the narration rendered with the voice
 *    (voice_deletion_prepare also clears those pages and story casts).
 * Runs right after a withdrawal (the withdraw route) and every 15 minutes
 * (kecon-voice-deletion.timer → POST /api/internal/voice-deletions). Idempotent:
 * a job is finished only when the provider and every file are done.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceClient } from "@/lib/server-settings";
import { elevenFetch } from "@/lib/elevenlabs";
import { ProviderHttpError } from "@/lib/provider-keys";
import { scrubSecret } from "@/lib/system-secrets";

export type ProviderOutcome = "deleted" | "already_gone" | "not_found";
export interface DeletionKey {
  secret: string;
  /** The key that created the voice (get_provider_voice_key). */
  pinned: boolean;
}
export interface VoiceDeletionDeps {
  service: SupabaseClient;
  /** Every usable ElevenLabs key, the voice's own key first; [] when none is configured. */
  keys(voiceId: string): Promise<DeletionKey[]>;
  /** DELETE /v1/voices/:id → "missing" when this account does not have it; throws otherwise. */
  deleteVoice(apiKey: string, voiceId: string): Promise<"deleted" | "missing">;
  /** Delete up to `max` history items generated with the voice; returns how many. */
  purgeHistory(apiKey: string, voiceId: string, max: number): Promise<number>;
  /** Remove storage objects (missing ones count as removed); throws on failure. */
  removeFiles(bucket: string, names: string[]): Promise<void>;
}
export interface VoiceDeletionSummary {
  expired: number;
  claimed: number;
  done: number;
  pending: number;
  errors: number;
  overdue: number | null;
}
type Job = { id: string; provider_voice_id: string | null; provider_done: boolean; attempts: number; household_id: string | null };
type StoragePath = { bucket: string; name: string };

const BUCKETS = new Set(["voice-consents", "recordings", "tts-cache"]);
const HISTORY_MAX = 1000;

function errorText(err: unknown, secret?: string): string {
  const raw = err instanceof ProviderHttpError ? `${err.status} ${err.code ?? ""} ${err.message}` : err instanceof Error ? err.message : String(err);
  return scrubSecret(raw, secret).replace(/\s+/g, " ").trim().slice(0, 300) || "error";
}
/** "This account has no such voice": 404, voice_not_found / voice_does_not_exist, or a 400 saying so. */
export function isMissingVoice(err: unknown): boolean {
  if (!(err instanceof ProviderHttpError)) return false;
  const code = (err.code ?? "").toLowerCase();
  if (err.status === 404 || code === "voice_not_found" || code === "voice_does_not_exist") return true;
  return err.status === 400 && /(does not exist|not found|not_found|does_not_exist)/i.test(err.message);
}

/** Delete the voice at ElevenLabs: deleted by some key, gone at its own key, or unknown to every key. */
export async function deleteProviderVoice(
  deps: Pick<VoiceDeletionDeps, "keys" | "deleteVoice" | "purgeHistory">,
  voiceId: string,
): Promise<{ result: ProviderOutcome; history: number }> {
  const keys = await deps.keys(voiceId);
  if (!keys.length) throw new Error("no_keys: chưa có ElevenLabs key để xoá giọng");
  const purge = async (key: DeletionKey) => {
    try {
      return await deps.purgeHistory(key.secret, voiceId, HISTORY_MAX);
    } catch {
      return 0; // history needs a key permission; the voice itself is what must go
    }
  };
  let history = 0;
  let pinnedGone = false;
  let uncertain: string | null = null;
  for (const key of keys) {
    // The voice's own account: clear its history while the voice still exists there.
    if (key.pinned) history += await purge(key);
    try {
      if ((await deps.deleteVoice(key.secret, voiceId)) === "deleted") {
        if (!key.pinned) history += await purge(key);
        return { result: "deleted", history };
      }
      if (key.pinned) pinnedGone = true;
    } catch (err) {
      uncertain = errorText(err, key.secret);
    }
  }
  if (pinnedGone) return { result: "already_gone", history };
  if (uncertain) throw new Error(uncertain);
  return { result: "not_found", history };
}

async function rpc<T>(service: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await service.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

async function runJob(deps: VoiceDeletionDeps, job: Job): Promise<"done" | "pending" | "error"> {
  const { service } = deps;
  const errors: string[] = [];
  let paths: StoragePath[] = [];
  try {
    const prepared = await rpc<{ storage_paths: StoragePath[] } | null>(service, "voice_deletion_prepare", { p_job: job.id });
    paths = (prepared?.storage_paths ?? []).filter((p) => p && BUCKETS.has(p.bucket) && typeof p.name === "string" && p.name.length > 0);
  } catch (err) {
    errors.push(errorText(err));
  }
  let provider: ProviderOutcome | null = null;
  let history = 0;
  if (job.provider_voice_id && !job.provider_done) {
    try {
      ({ result: provider, history } = await deleteProviderVoice(deps, job.provider_voice_id));
    } catch (err) {
      errors.push(`elevenlabs: ${errorText(err)}`);
    }
  }
  const removed: StoragePath[] = [];
  const byBucket = new Map<string, string[]>();
  for (const p of paths) byBucket.set(p.bucket, [...(byBucket.get(p.bucket) ?? []), p.name]);
  for (const [bucket, names] of byBucket) {
    for (let i = 0; i < names.length; i += 100) {
      const chunk = names.slice(i, i + 100);
      try {
        await deps.removeFiles(bucket, chunk);
        removed.push(...chunk.map((name) => ({ bucket, name })));
      } catch (err) {
        errors.push(`storage ${bucket}: ${errorText(err)}`);
      }
    }
  }
  const fin = await rpc<{ status: string } | null>(service, "voice_deletion_finish", {
    p_job: job.id,
    p_provider_result: provider,
    p_removed: removed,
    p_error: errors.length ? errors.join(" · ").slice(0, 500) : null,
    p_history_removed: history,
  });
  if (errors.length) return "error";
  return fin?.status === "done" ? "done" : "pending";
}

/** Process due jobs (one household right after its withdrawal, or all of them). */
export async function runVoiceDeletions(
  opts: { householdId?: string | null; limit?: number; deps?: Partial<VoiceDeletionDeps> } = {},
): Promise<VoiceDeletionSummary | null> {
  const deps = opts.deps?.service ? (opts.deps as VoiceDeletionDeps) : defaultDeps(opts.deps);
  if (!deps) return null;
  const summary: VoiceDeletionSummary = { expired: 0, claimed: 0, done: 0, pending: 0, errors: 0, overdue: null };
  try {
    summary.expired = (await rpc<number>(deps.service, "voice_consent_expire", {})) ?? 0;
  } catch (err) {
    console.error("[voice-deletion] expire", errorText(err));
  }
  const jobs = await rpc<Job[]>(deps.service, "voice_deletion_claim", {
    p_household: opts.householdId ?? null,
    p_limit: opts.limit ?? 10,
  });
  summary.claimed = jobs?.length ?? 0;
  for (const job of jobs ?? []) {
    try {
      const outcome = await runJob(deps, job);
      if (outcome === "done") summary.done++;
      else if (outcome === "pending") summary.pending++;
      else summary.errors++;
    } catch (err) {
      summary.errors++;
      console.error("[voice-deletion] job", job.id, errorText(err));
    }
  }
  try {
    summary.overdue = await rpc<number>(deps.service, "voice_deletion_overdue", {});
  } catch {
    summary.overdue = null;
  }
  return summary;
}

/** Run for at most `budgetMs`; the work continues in the background after that. */
export async function runVoiceDeletionsWithin(
  budgetMs: number,
  opts: Parameters<typeof runVoiceDeletions>[0] = {},
): Promise<VoiceDeletionSummary | null | "running"> {
  const work = runVoiceDeletions(opts).catch((err) => {
    console.error("[voice-deletion]", errorText(err));
    return null;
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"running">((resolve) => {
    timer = setTimeout(() => resolve("running"), budgetMs);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// ── Default dependencies: service role + ElevenLabs ─────────────────────────

type PoolRow = { id: string; secret: string | null };

function defaultDeps(overrides: Partial<VoiceDeletionDeps> = {}): VoiceDeletionDeps | null {
  const service = getServiceClient();
  if (!service) return null;
  return {
    service,
    async keys(voiceId) {
      const [pool, owner] = await Promise.all([
        service.rpc("get_provider_key_pool", { p_provider: "elevenlabs" }),
        service.rpc("get_provider_voice_key", { p_provider: "elevenlabs", p_voice_ref: voiceId }),
      ]);
      if (pool.error) throw new Error(`get_provider_key_pool: ${pool.error.message}`);
      const pinned = typeof owner.data === "string" ? owner.data : null;
      const rows = ((pool.data ?? []) as PoolRow[]).filter((r) => r.secret);
      const keys: DeletionKey[] = rows
        .map((r) => ({ secret: r.secret as string, pinned: r.id === pinned }))
        .sort((a, b) => Number(b.pinned) - Number(a.pinned));
      const env = (process.env.ELEVENLABS_API_KEY ?? "").trim();
      if (env && !keys.some((k) => k.secret === env)) keys.push({ secret: env, pinned: false });
      return keys;
    },
    async deleteVoice(apiKey, voiceId) {
      try {
        await elevenFetch(`/voices/${encodeURIComponent(voiceId)}`, apiKey, { method: "DELETE", signal: AbortSignal.timeout(30_000) }, "xoá giọng lỗi");
        return "deleted";
      } catch (err) {
        if (isMissingVoice(err)) return "missing";
        throw err;
      }
    },
    async purgeHistory(apiKey, voiceId, max) {
      // Deleting shifts the pages: always read the first page again until it is empty.
      let removed = 0;
      const seen = new Set<string>();
      while (removed < max) {
        const q = new URLSearchParams({ voice_id: voiceId, page_size: "100" });
        const res = await elevenFetch(`/history?${q}`, apiKey, { signal: AbortSignal.timeout(30_000) }, "lịch sử lỗi");
        const page = (await res.json()) as { history?: { history_item_id?: string; voice_id?: string }[] };
        // Never touch another voice's history (an API that ignored the filter).
        const items = (page.history ?? []).filter((h) => h.history_item_id && h.voice_id === voiceId && !seen.has(h.history_item_id));
        if (!items.length) break;
        for (const item of items.slice(0, max - removed)) {
          const id = item.history_item_id as string;
          seen.add(id);
          await elevenFetch(`/history/${encodeURIComponent(id)}`, apiKey, { method: "DELETE", signal: AbortSignal.timeout(30_000) }, "xoá lịch sử lỗi");
          removed++;
        }
      }
      return removed;
    },
    async removeFiles(bucket, names) {
      const { error } = await service.storage.from(bucket).remove(names);
      if (error) throw new Error(error.message);
    },
    ...overrides,
  };
}
