/**
 * Admin v2 · A-04b — xoay vòng nhiều key giọng nói + tự bù key (src/lib/key-pool.ts),
 * client Fish Audio, mã lỗi ElevenLabs và nút "Kiểm tra" (credit).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classifyProviderError, createKeyPool, KeyPoolError, type KeyPoolDeps, type PoolKey } from "@/lib/key-pool";
import {
  ProviderHttpError,
  providerCreditText,
  providerHttpError,
  providerKeyStatusText,
  providerVoiceRef,
  voiceProviderOf,
  VOICE_ID_PATTERN,
} from "@/lib/provider-keys";
import { fishGetCredit, fishTextToSpeech } from "@/lib/fishaudio";
import { textToSpeech } from "@/lib/elevenlabs";
import { checkProviderKey } from "@/lib/provider-key-check";

const el = (status: number, code: string | null = null, message = "x") => new ProviderHttpError("elevenlabs", status, code, `ElevenLabs ${status}: ${message}`);
const fish = (status: number, message = "x") => new ProviderHttpError("fishaudio", status, null, `Fish Audio ${status}: ${message}`);

function key(n: number, extra: Partial<PoolKey> = {}): PoolKey {
  return { id: `k${n}`, label: `Key ${n}`, last4: `000${n}`, secret: `sk_secret-key-number-${n}-000${n}`, status: "active", cooldownUntil: null, ...extra };
}

function setup(keys: PoolKey[], over: Partial<KeyPoolDeps> = {}) {
  let now = 1_000_000;
  const base = {
    loadKeys: vi.fn(async () => keys.map((k) => ({ ...k }))),
    envKey: vi.fn(() => ""),
    report: vi.fn(async () => {}),
    recordUsage: vi.fn(async () => {}),
    voiceOwner: vi.fn(async () => null as string | null),
    bindVoice: vi.fn(async () => {}),
    now: () => now,
  };
  const deps = { ...base, ...over } as typeof base;
  const pool = createKeyPool(deps, { flushMs: 60_000 });
  return { pool, deps, advance: (ms: number) => (now += ms) };
}

/** op that records which key served the call and fails for the given keys. */
function recorder(fail: Record<string, unknown> = {}) {
  const used: string[] = [];
  const op = vi.fn(async (secret: string) => {
    const id = /number-(\d+)/.exec(secret)?.[1] ?? secret;
    used.push(`k${id}`);
    const err = fail[`k${id}`];
    if (err) throw err;
    return `audio-from-k${id}`;
  });
  return { op, used };
}

describe("classifyProviderError", () => {
  it("ElevenLabs: hết credit / key sai / thiếu quyền / giọng không có / quá tải / lỗi request", () => {
    expect(classifyProviderError("elevenlabs", el(401, "quota_exceeded"))).toBe("exhausted");
    expect(classifyProviderError("elevenlabs", el(402, "payment_required"))).toBe("exhausted");
    expect(classifyProviderError("elevenlabs", el(401, "invalid_api_key"))).toBe("invalid");
    expect(classifyProviderError("elevenlabs", el(401, "detected_unusual_activity"))).toBe("invalid");
    expect(classifyProviderError("elevenlabs", el(401, "missing_permissions"))).toBe("skip");
    expect(classifyProviderError("elevenlabs", el(404, "voice_not_found"))).toBe("voice_missing");
    expect(classifyProviderError("elevenlabs", el(400, "voice_not_found"))).toBe("voice_missing");
    expect(classifyProviderError("elevenlabs", el(404), { voice: true })).toBe("voice_missing");
    expect(classifyProviderError("elevenlabs", el(429, "too_many_concurrent_requests"))).toBe("rate_limited");
    expect(classifyProviderError("elevenlabs", el(503))).toBe("transient");
    expect(classifyProviderError("elevenlabs", el(0, "network"))).toBe("transient");
    expect(classifyProviderError("elevenlabs", new TypeError("fetch failed"))).toBe("transient");
    expect(classifyProviderError("elevenlabs", el(422, "invalid_parameters"))).toBe("fatal");
    expect(classifyProviderError("elevenlabs", el(400, "max_character_limit_exceeded"))).toBe("fatal");
  });

  it("Fish Audio: 401 sai · 402 hết credit · 403/404 giọng không thuộc key · 429 · 5xx · 400", () => {
    expect(classifyProviderError("fishaudio", fish(401, "Invalid Token"))).toBe("invalid");
    expect(classifyProviderError("fishaudio", fish(402, "Insufficient credits"))).toBe("exhausted");
    expect(classifyProviderError("fishaudio", fish(403), { voice: true })).toBe("voice_missing");
    expect(classifyProviderError("fishaudio", fish(404), { voice: true })).toBe("voice_missing");
    expect(classifyProviderError("fishaudio", fish(403))).toBe("skip");
    expect(classifyProviderError("fishaudio", fish(400, "reference_id model not found"), { voice: true })).toBe("voice_missing");
    expect(classifyProviderError("fishaudio", fish(400, "text is required"), { voice: true })).toBe("fatal");
    expect(classifyProviderError("fishaudio", fish(429))).toBe("rate_limited");
    expect(classifyProviderError("fishaudio", fish(500))).toBe("transient");
  });
});

describe("createKeyPool · chọn key", () => {
  it("round-robin: lần lượt từng key, quay vòng", async () => {
    const { pool } = setup([key(1), key(2), key(3)]);
    const { op, used } = recorder();
    for (let i = 0; i < 5; i++) await pool.run("elevenlabs", op);
    expect(used).toEqual(["k1", "k2", "k3", "k1", "k2"]);
  });

  it("request song song được rải sang key đang rảnh (ít request nhất)", async () => {
    const { pool } = setup([key(1), key(2), key(3)]);
    const started: string[] = [];
    const gates: Array<() => void> = [];
    const op = (secret: string) =>
      new Promise<string>((resolve) => {
        started.push(secret.slice(-4));
        gates.push(() => resolve(secret));
      });
    const runs = [pool.run("fishaudio", op), pool.run("fishaudio", op), pool.run("fishaudio", op)];
    await vi.waitFor(() => expect(started).toHaveLength(3));
    expect(new Set(started).size).toBe(3);
    expect(pool._inflight.get("k1")).toBe(1);
    gates.forEach((g) => g());
    await Promise.all(runs);
    expect([...pool._inflight.values()]).toEqual([0, 0, 0]);
  });

  it("kho đọc 1 lần trong 30 s; invalidate() đọc lại", async () => {
    const { pool, deps, advance } = setup([key(1)]);
    const { op } = recorder();
    await pool.run("elevenlabs", op);
    await pool.run("elevenlabs", op);
    expect(deps.loadKeys).toHaveBeenCalledTimes(1);
    advance(31_000);
    await pool.run("elevenlabs", op);
    expect(deps.loadKeys).toHaveBeenCalledTimes(2);
    pool.invalidate("elevenlabs");
    await pool.configured("elevenlabs");
    expect(deps.loadKeys).toHaveBeenCalledTimes(3);

    // An empty pool is not cached: a key the admin has just added works right away.
    const empty = setup([]);
    expect(await empty.pool.configured("fishaudio")).toBe(false);
    expect(await empty.pool.configured("fishaudio")).toBe(false);
    expect(empty.deps.loadKeys).toHaveBeenCalledTimes(2);
  });
});

describe("createKeyPool · bù key khi lỗi", () => {
  it("key hết credit → bù key kế tiếp ngay; báo DB 'exhausted' + giờ thử lại; bỏ qua tới khi hết hạn chờ", async () => {
    const { pool, deps, advance } = setup([key(1), key(2)]);
    const { op, used } = recorder({ k1: el(401, "quota_exceeded", "This request exceeds your quota") });
    await expect(pool.run("elevenlabs", op, { chars: 120 })).resolves.toBe("audio-from-k2");
    expect(used).toEqual(["k1", "k2"]);
    expect(deps.report).toHaveBeenCalledWith("k1", {
      status: "exhausted",
      error: "ElevenLabs 401: This request exceeds your quota",
      cooldownUntil: 1_000_000 + 3600_000,
    });
    used.length = 0;
    await pool.run("elevenlabs", op);
    await pool.run("elevenlabs", op);
    expect(used).toEqual(["k2", "k2"]);

    // An hour later the key is probed again; credit is back → active.
    advance(3600_001);
    pool.invalidate();
    deps.loadKeys.mockResolvedValueOnce([key(1, { status: "exhausted", cooldownUntil: 1_000_000 + 3600_000 }), key(2)]);
    const ok = recorder();
    await pool.run("elevenlabs", ok.op, { chars: 50 });
    expect(ok.used).toEqual(["k1"]);
    expect(deps.recordUsage).toHaveBeenCalledWith("k1", 1, 50); // flushed at once: the DB flips it back to 'active'
  });

  it("key sai → báo 'invalid', rời kho; quá tải (429) / lỗi máy chủ → nghỉ ngắn, không ghi DB", async () => {
    const { pool, deps, advance } = setup([key(1), key(2), key(3)]);
    const first = recorder({ k1: fish(401, "Invalid Token"), k2: fish(429, "Too many requests") });
    await expect(pool.run("fishaudio", first.op)).resolves.toBe("audio-from-k3");
    expect(deps.report).toHaveBeenCalledTimes(1);
    expect(deps.report).toHaveBeenCalledWith("k1", { status: "invalid", error: "Fish Audio 401: Invalid Token" });

    const next = recorder();
    await pool.run("fishaudio", next.op);
    expect(next.used).toEqual(["k3"]); // k1 gone, k2 resting
    advance(5_001);
    await pool.run("fishaudio", next.op);
    expect(next.used).toEqual(["k3", "k2"]);
  });

  it("lỗi của chính request (400/422) → trả lỗi luôn, không thử key khác, không đánh dấu key; lọc key khỏi thông báo", async () => {
    const k1 = key(1);
    const { pool, deps } = setup([k1, key(2)]);
    const { op, used } = recorder({ k1: el(422, "invalid_parameters", `bad request for ${k1.secret}`) });
    const err = await pool.run("elevenlabs", op).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderHttpError);
    expect(err.status).toBe(422);
    expect(err.message).not.toContain(k1.secret);
    expect(used).toEqual(["k1"]);
    expect(deps.report).not.toHaveBeenCalled();
  });

  it("mọi key đều lỗi → KeyPoolError 503, thông báo không chứa key; hết key dùng được → all_unavailable", async () => {
    const keys = [key(1), key(2)];
    const { pool } = setup(keys);
    const { op } = recorder({ k1: el(401, "quota_exceeded"), k2: el(402) });
    const err = await pool.run("elevenlabs", op).catch((e) => e);
    expect(err).toBeInstanceOf(KeyPoolError);
    expect(err).toMatchObject({ code: "all_failed", httpStatus: 503 });
    expect(err.attempts).toEqual([
      { key: "…0001", outcome: "exhausted", status: 401 },
      { key: "…0002", outcome: "exhausted", status: 402 },
    ]);
    for (const k of keys) expect(JSON.stringify({ m: err.message, a: err.attempts })).not.toContain(k.secret);
    await expect(pool.run("elevenlabs", op)).rejects.toMatchObject({ code: "all_unavailable", httpStatus: 503 });
  });

  it("chưa có key nào → no_keys (400); biến môi trường là key dự phòng cuối, không ghi DB", async () => {
    const empty = setup([]);
    await expect(empty.pool.run("fishaudio", async () => "x")).rejects.toMatchObject({ code: "no_keys", httpStatus: 400 });
    expect(await empty.pool.configured("fishaudio")).toBe(false);

    const { pool, deps } = setup([key(1)], { envKey: vi.fn(() => "sk_env-fallback-key-9999") });
    const seen: string[] = [];
    const op = async (secret: string) => {
      seen.push(secret);
      if (secret.includes("number-1")) throw el(401, "quota_exceeded");
      return "ok";
    };
    await expect(pool.run("elevenlabs", op)).resolves.toBe("ok");
    expect(seen).toEqual([key(1).secret, "sk_env-fallback-key-9999"]);
    await pool.flushUsage();
    expect(deps.report).toHaveBeenCalledTimes(1); // only k1
    expect(deps.recordUsage).not.toHaveBeenCalled(); // env key isn't in the DB
  });
});

describe("createKeyPool · giọng nhân bản theo tài khoản", () => {
  it("dùng key 'chủ' của giọng trước; tài khoản không có giọng → thử key khác và nhớ 30 phút", async () => {
    const { pool, deps } = setup([key(1), key(2), key(3)], { voiceOwner: vi.fn(async () => "k3") });
    const { op, used } = recorder();
    await pool.run("elevenlabs", op, { voiceRef: "clonedVoice" });
    expect(used).toEqual(["k3"]);
    expect(deps.voiceOwner).toHaveBeenCalledWith("elevenlabs", "clonedVoice");

    deps.voiceOwner.mockResolvedValue(null);
    const lib = recorder({ k1: el(404, "voice_not_found") });
    await pool.run("elevenlabs", lib.op, { voiceRef: "libraryVoice" });
    expect(lib.used).toEqual(["k1", "k2"]);
    lib.used.length = 0;
    for (let i = 0; i < 3; i++) await pool.run("elevenlabs", lib.op, { voiceRef: "libraryVoice" });
    expect(lib.used).not.toContain("k1"); // remembered: k1's account doesn't have it
    expect(deps.report).not.toHaveBeenCalled();
  });

  it("không tài khoản nào có giọng → KeyPoolError voice_missing (404)", async () => {
    const { pool } = setup([key(1), key(2)]);
    const { op } = recorder({ k1: fish(404), k2: fish(403) });
    await expect(pool.run("fishaudio", op, { voiceRef: "ghost" })).rejects.toMatchObject({ code: "voice_missing", httpStatus: 404 });
  });

  it("clone giọng → gắn giọng mới với key đã tạo; lượt dùng gom lại rồi ghi một lần", async () => {
    const { pool, deps } = setup([key(1), key(2)]);
    const clone = vi.fn(async (secret: string) => ({ voice_id: `voice-of-${secret.slice(-4)}` }));
    await pool.run("elevenlabs", clone, { bindVoiceFrom: (r) => r.voice_id });
    expect(deps.bindVoice).toHaveBeenCalledWith("elevenlabs", "voice-of-0001", "k1");

    const { op } = recorder();
    await pool.run("elevenlabs", op, { chars: 100 });
    await pool.run("elevenlabs", op, { chars: 30 });
    await pool.run("elevenlabs", op, { chars: 70 });
    expect(deps.recordUsage).not.toHaveBeenCalled();
    await pool.flushUsage();
    // clone (0 ký tự) dùng k1; sau đó quay vòng k2 (100) → k1 (30) → k2 (70)
    expect(deps.recordUsage).toHaveBeenCalledTimes(2);
    expect(deps.recordUsage).toHaveBeenCalledWith("k1", 2, 30);
    expect(deps.recordUsage).toHaveBeenCalledWith("k2", 2, 170);
  });
});

describe("provider-keys helpers", () => {
  it("id giọng: ElevenLabs hoặc fish:<id>", () => {
    expect(voiceProviderOf("pNInz6obpgDQGcFmaJgB")).toBe("elevenlabs");
    expect(voiceProviderOf("fish:9a9cf47702da476aa4629e2506d4a857")).toBe("fishaudio");
    expect(providerVoiceRef("fish:9a9cf47702da476aa4629e2506d4a857")).toBe("9a9cf47702da476aa4629e2506d4a857");
    expect(VOICE_ID_PATTERN.test("fish:abc-123")).toBe(true);
    expect(VOICE_ID_PATTERN.test("fish:../x")).toBe(false);
    expect(VOICE_ID_PATTERN.test("x:abc")).toBe(false);
  });

  it("đọc lỗi ElevenLabs {detail} và Fish Audio {message}", async () => {
    const e1 = await providerHttpError(
      "elevenlabs",
      new Response(JSON.stringify({ detail: { status: "quota_exceeded", message: "Hết quota" } }), { status: 401 }),
      "TTS lỗi"
    );
    expect(e1).toMatchObject({ status: 401, code: "quota_exceeded", message: "ElevenLabs TTS lỗi 401: Hết quota" });
    const e2 = await providerHttpError("fishaudio", new Response(JSON.stringify({ message: "Invalid Token", status: 401 }), { status: 401 }), "TTS lỗi");
    expect(e2).toMatchObject({ status: 401, code: null, message: "Fish Audio TTS lỗi 401: Invalid Token" });
    const e3 = await providerHttpError("fishaudio", new Response("<html>bad gateway</html>", { status: 502 }), "TTS lỗi");
    expect(e3.message).toBe("Fish Audio TTS lỗi 502");
  });

  it("trạng thái + credit hiển thị", () => {
    expect(providerKeyStatusText({ enabled: false, status: "active", cooldown_until: null })).toEqual({ text: "Đã tắt", tone: "off" });
    expect(providerKeyStatusText({ enabled: true, status: "invalid", cooldown_until: null }).tone).toBe("error");
    expect(providerKeyStatusText({ enabled: true, status: "exhausted", cooldown_until: null }).text).toBe("Hết credit · sẽ thử lại");
    const now = new Date(2026, 9, 6, 10, 0).getTime();
    expect(providerKeyStatusText({ enabled: true, status: "exhausted", cooldown_until: new Date(2026, 9, 6, 11, 5).toISOString() }, now).text).toBe(
      "Hết credit · thử lại 11:05"
    );
    expect(providerKeyStatusText({ enabled: true, status: "exhausted", cooldown_until: new Date(2026, 10, 1, 7, 0).toISOString() }, now).text).toBe(
      "Hết credit · thử lại 01/11 07:00"
    );
    expect(providerKeyStatusText({ enabled: true, status: "active", cooldown_until: null }).text).toBe("Đang dùng");
    expect(providerCreditText({ unit: "characters", used: 1500, limit: 10000, remaining: 8500, reset_at: null })).toBe("Còn 8.500 / 10.000 ký tự");
    expect(providerCreditText({ unit: "usd", balance: 5 })).toBe("Số dư $5.00");
    expect(providerCreditText(null)).toBeNull();
  });
});

describe("client Fish Audio / ElevenLabs", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("Fish TTS: Bearer key, model ở header, reference_id + mp3; bỏ thẻ cảm xúc", async () => {
    fetchMock.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    const blob = await fishTextToSpeech("fish-key-123456789", "abc123", "[vui] Xin chào bé", { model: "s2.1-pro-free" });
    expect(blob.size).toBe(3);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.fish.audio/v1/tts");
    expect(init.headers).toMatchObject({ Authorization: "Bearer fish-key-123456789", model: "s2.1-pro-free", "Content-Type": "application/json" });
    expect(JSON.parse(init.body)).toMatchObject({ text: "Xin chào bé", reference_id: "abc123", format: "mp3" });
    expect(init.redirect).toBe("error");
  });

  it("Fish: 402 → ProviderHttpError 402; lỗi mạng → status 0; FISH_AUDIO_API_BASE đổi được host", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ message: "Insufficient credits", status: 402 }), { status: 402 }));
    await expect(fishTextToSpeech("k".repeat(20), "abc", "x")).rejects.toMatchObject({ provider: "fishaudio", status: 402 });
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(fishGetCredit("k".repeat(20))).rejects.toMatchObject({ status: 0, code: "network" });
    vi.stubEnv("FISH_AUDIO_API_BASE", "http://127.0.0.1:9/fish/");
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ credit: "12.5" }), { status: 200 }));
    await expect(fishGetCredit("k".repeat(20))).resolves.toEqual({ balance: 12.5, hasFreeCredit: false });
    expect(fetchMock.mock.calls[2][0]).toBe("http://127.0.0.1:9/fish/wallet/self/api-credit");
  });

  it("ElevenLabs TTS lỗi → mã detail.status (quota_exceeded) để kho key nhận ra hết credit", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: { status: "quota_exceeded", message: "This request exceeds your quota of 10000" } }), { status: 401 })
    );
    const err = await textToSpeech("sk_" + "x".repeat(20), "voice1", "Xin chào").catch((e) => e);
    expect(err).toMatchObject({ provider: "elevenlabs", status: 401, code: "quota_exceeded" });
    expect(classifyProviderError("elevenlabs", err)).toBe("exhausted");
  });

  it("Kiểm tra key ElevenLabs: credit ký tự; key giới hạn quyền → thử /voices", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ tier: "starter", character_count: 2500, character_limit: 30000, next_character_count_reset_unix: 1_800_000_000 }), { status: 200 })
    );
    await expect(checkProviderKey("elevenlabs", "sk_" + "a".repeat(20))).resolves.toMatchObject({
      status: "active",
      credit: { unit: "characters", used: 2500, limit: 30000, remaining: 27500, reset_at: new Date(1_800_000_000_000).toISOString() },
    });

    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: { status: "missing_permissions", message: "missing user_read" } }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ voices: [] }), { status: 200 }));
    await expect(checkProviderKey("elevenlabs", "sk_" + "b".repeat(20))).resolves.toMatchObject({ status: "active", credit: { unit: "unknown" } });

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ character_count: 10000, character_limit: 10000 }), { status: 200 }));
    await expect(checkProviderKey("elevenlabs", "sk_" + "c".repeat(20))).resolves.toMatchObject({ status: "exhausted" });

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ detail: { status: "invalid_api_key", message: "Invalid API key" } }), { status: 401 }));
    await expect(checkProviderKey("elevenlabs", "sk_" + "d".repeat(20))).resolves.toMatchObject({ status: "invalid" });
  });

  it("Kiểm tra key Fish Audio: số dư $0 → hết credit, trừ khi dùng model miễn phí; mạng lỗi → giữ nguyên trạng thái", async () => {
    const zero = () => new Response(JSON.stringify({ credit: "0", has_free_credit: null }), { status: 200 });
    fetchMock.mockResolvedValueOnce(zero());
    await expect(checkProviderKey("fishaudio", "f".repeat(30), { fishModel: "s2.1-pro" })).resolves.toMatchObject({
      status: "exhausted", credit: { unit: "usd", balance: 0 },
    });
    fetchMock.mockResolvedValueOnce(zero());
    await expect(checkProviderKey("fishaudio", "f".repeat(30), { fishModel: "s2.1-pro-free" })).resolves.toMatchObject({ status: "active" });
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(checkProviderKey("fishaudio", "f".repeat(30))).resolves.toMatchObject({ status: null });
  });
});
