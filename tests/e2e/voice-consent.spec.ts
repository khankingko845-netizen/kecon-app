/**
 * T12 · Lời đồng ý giọng nói (migration 043, docs/voice-consent.md).
 * Tiêu chí: chưa ghi mẫu / tạo giọng được khi người góp giọng chưa tự đọc câu đồng ý; bản ghi
 * câu đó được lưu riêng tư kèm phiên bản + mã băm văn bản và cách bố mẹ xác nhận (phép tính
 * hoặc PIN); /api/voice/clone cần đúng lời đồng ý đó và không nhận key riêng; rút đồng ý trong
 * Bố mẹ › Cài đặt › Đồng ý giọng nói (hoặc xoá giọng ở Giọng đọc) → giọng ngừng ngay, việc xoá
 * được xếp hàng và hiện trạng thái; giọng tạo trước khi có lời đồng ý bị tạm dừng.
 * Trạng thái nằm trong mock Supabase (tests/e2e/support/mock-voice-consent.mjs).
 */
import { createHash } from "node:crypto";
import { expect, test, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import {
  MOCK_PIN,
  MOCK_USER_ID,
  MOCK_VC_PIN_USER_ID,
  MOCK_VC_USER_ID,
  MOCK_VC_WITHDRAW_USER_ID,
  mockAccessToken,
  passParentGate,
  signInAsMockFamily,
} from "./support/fixtures";

const MOCK = "http://127.0.0.1:54321";
const SERVICE = { Authorization: "Bearer e2e-fake-service-role-key", apikey: "e2e-fake-service-role-key" };
/** Small WebM (EBML header), what the fake MediaRecorder below produces. */
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01]), Buffer.alloc(4096)]);

type Consent = {
  id: string;
  speaker_name: string;
  spoken_text: string;
  version: number;
  body_sha256: string;
  parent_method: string;
  audio_path: string | null;
  audio_sha256: string;
  audio_mime: string;
  duration_ms: number;
  provider_voice_id: string | null;
  withdrawn_at: string | null;
  withdraw_reason: string | null;
  audio_deleted_at: string | null;
};
type Job = { consent_id: string | null; provider_voice_id: string | null; reason: string; status: string; files_removed: number; last_error: string | null };
type VoiceState = { consents: Consent[]; jobs: Job[]; files: string[]; profiles: { name: string; elevenlabs_voice_id: string | null }[] };
type VoiceDoc = { id: string; version: number; body_sha256: string; spoken_text: string };

// The fixture families are shared state in the mock → one test at a time.
test.describe.configure({ mode: "serial" });

async function resetVoice(request: APIRequestContext, sub: string) {
  expect((await request.post(`${MOCK}/__e2e/voice-consent-reset`, { data: { sub } })).ok()).toBe(true);
}
async function voiceState(request: APIRequestContext, sub: string): Promise<VoiceState> {
  return (await request.get(`${MOCK}/__e2e/voice-consent-state?sub=${sub}`)).json();
}
async function voiceDoc(request: APIRequestContext, sub: string): Promise<VoiceDoc> {
  const r = await request.post(`${MOCK}/rest/v1/rpc/voice_consent_document`, {
    headers: { Authorization: `Bearer ${mockAccessToken(sub)}` },
    data: { p_locale: "vi" },
  });
  return (await r.json()).document;
}

/** Headless Chromium has no microphone: a fake stream + MediaRecorder that yields a small WebM. */
async function fakeMicrophone(context: BrowserContext) {
  await context.addInitScript(() => {
    const webm = () =>
      new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01]), new Uint8Array(4096)], { type: "audio/webm" });
    const getUserMedia = async () => ({ getTracks: () => [{ stop() {} }] });
    if (navigator.mediaDevices) Object.defineProperty(navigator.mediaDevices, "getUserMedia", { value: getUserMedia, configurable: true });
    else Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
    function FakeRecorder(this: Record<string, unknown>, _stream: unknown, opts?: { mimeType?: string }) {
      this.state = "inactive";
      this.mimeType = opts?.mimeType ?? "audio/webm";
      this.ondataavailable = null;
      this.onstop = null;
    }
    FakeRecorder.isTypeSupported = (type: string) => type.startsWith("audio/webm");
    FakeRecorder.prototype.start = function (this: Record<string, unknown>) {
      this.state = "recording";
    };
    FakeRecorder.prototype.stop = function (this: Record<string, unknown> & { ondataavailable?: ((e: { data: Blob }) => void) | null; onstop?: (() => void) | null }) {
      if (this.state === "inactive") return;
      this.state = "inactive";
      setTimeout(() => {
        this.ondataavailable?.({ data: webm() });
        this.onstop?.();
      }, 0);
    };
    Object.defineProperty(window, "MediaRecorder", { value: FakeRecorder, configurable: true });
  });
}

const nav = (page: Page) => page.getByRole("navigation", { name: "Điều hướng chính" });

async function openRecording(page: Page) {
  await page.goto("/");
  await nav(page).getByRole("button", { name: "Giọng đọc", exact: true }).click();
  await page.getByRole("button", { name: /Ghi giọng bố mẹ/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Ghi giọng bố mẹ" })).toBeVisible();
}

/** Step 1: name, the sentence aloud (≥ 3 s), then the parent confirms. */
async function recordConsent(page: Page, speaker: string, pin?: string) {
  const step = page.getByTestId("voice-consent-step");
  const record = step.getByRole("button", { name: "Ghi câu đồng ý" });
  const save = step.getByRole("button", { name: "Bố mẹ xác nhận & lưu lời đồng ý" });
  await expect(record).toBeDisabled();
  await step.getByLabel("Tên người góp giọng").fill(speaker);
  await expect(step.getByTestId("voice-consent-sentence")).toContainText(`Tôi là ${speaker}. Tôi đồng ý để KểCon dùng giọng nói của tôi`);
  await expect(save).toBeDisabled();
  await record.click();
  await expect(step.getByRole("timer")).toBeVisible();
  await page.waitForTimeout(3_300);
  await step.getByRole("button", { name: "Dừng ghi" }).click();
  await expect(step.getByRole("button", { name: /^Nghe lại \(0:0[3-4]\)$/ })).toBeVisible();
  await save.click();
  await expect(page.getByRole("heading", { level: 1, name: "Bố mẹ xác nhận lời đồng ý" })).toBeVisible();
  await passParentGate(page, pin);
  await expect(page.getByTestId("voice-consent-saved")).toContainText(`Đã lưu lời đồng ý của ${speaker} (bản 1). Bước 2/2: ghi âm mẫu.`);
  await expect(step).toHaveCount(0);
}

test("bước 1 trước khi ghi mẫu: người góp giọng đọc câu đồng ý, bố mẹ xác nhận → lưu riêng tư kèm phiên bản + mã băm; clone cần đúng lời đồng ý đó", async ({
  page,
  context,
  baseURL,
  request,
}) => {
  await resetVoice(request, MOCK_VC_USER_ID);
  await signInAsMockFamily(context, baseURL!, { userId: MOCK_VC_USER_ID });
  await fakeMicrophone(context);
  // The hermetic suite has no ElevenLabs key: report one so the clone button calls the API.
  await page.route("**/api/system/status", async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, json: { ...(await res.json()), hasElevenLabs: true } });
  });
  await openRecording(page);

  const step = page.getByTestId("voice-consent-step");
  await expect(step).toContainText("Bước 1/2 · Lời đồng ý");
  await expect(step.getByRole("heading", { name: "Đồng ý cho KểCon dùng giọng nói" })).toBeVisible();
  await expect(step).toContainText("Bản 1");
  // Nothing to record a sample with before the consent exists.
  await expect(page.getByRole("button", { name: "Bắt đầu ghi âm" })).toHaveCount(0);
  await step.getByRole("button", { name: "Đọc toàn văn lời đồng ý" }).click();
  await expect(step.getByText("Câu đồng ý cần đọc to")).toBeVisible();
  await step.getByRole("button", { name: "Thu gọn toàn văn" }).click();

  // The API refuses a clone without a consent and any personal key (before quota / provider).
  const sample = { name: "sample.webm", mimeType: "audio/webm", buffer: WEBM };
  let r = await page.request.post("/api/voice/clone", { multipart: { name: "Bà Lan", language: "vi", audio: sample } });
  expect(r.status()).toBe(403);
  expect((await r.json()).code).toBe("voice_consent_missing");
  r = await page.request.post("/api/voice/clone", {
    multipart: { name: "Bà Lan", language: "vi", consentId: "00000000-0000-4000-8000-0000000000aa", apiKey: "sk_personal_key_1234", audio: sample },
  });
  expect(r.status()).toBe(400);
  expect((await r.json()).code).toBe("byo_clone_disabled");

  await recordConsent(page, "Bà Lan");
  const doc = await voiceDoc(request, MOCK_VC_USER_ID);
  let vs = await voiceState(request, MOCK_VC_USER_ID);
  expect(vs.consents).toHaveLength(1);
  const consent = vs.consents[0];
  expect(consent).toMatchObject({
    speaker_name: "Bà Lan",
    spoken_text: doc.spoken_text.replace("{ten}", "Bà Lan"),
    version: doc.version,
    body_sha256: doc.body_sha256,
    parent_method: "account_holder",
    audio_mime: "audio/webm",
    audio_path: `${MOCK_VC_USER_ID}/${consent.id}.webm`,
    provider_voice_id: null,
  });
  expect(consent.duration_ms).toBeGreaterThanOrEqual(3_000);
  expect(vs.files).toEqual([`voice-consents/${consent.audio_path}`]);
  // The family can listen to it again; the stored bytes are the ones hashed in the record.
  const audio = await page.request.get(`/api/voice/consent/${consent.id}/audio`);
  expect(audio.status()).toBe(200);
  expect(audio.headers()["cache-control"]).toBe("private, no-store");
  expect(createHash("sha256").update(await audio.body()).digest("hex")).toBe(consent.audio_sha256);

  // Step 2: the sample, then the clone with exactly this consent (the provider call is stubbed:
  // the route itself is covered by tests/unit/voice-clone-binding-route.test.ts).
  await page.getByRole("button", { name: "Bắt đầu ghi âm" }).click();
  await page.waitForTimeout(1_200);
  await page.getByRole("button", { name: "Dừng ghi âm" }).click();
  // The voice is named after the contributor of the consent.
  await expect(page.getByPlaceholder("Tên giọng nói (VD: Mẹ Lan)")).toHaveValue("Bà Lan");
  let cloneForm = "";
  let bound: unknown = null;
  await page.route("**/api/voice/clone", async (route) => {
    cloneForm = route.request().postDataBuffer()?.toString("utf8") ?? "";
    // What the server does once ElevenLabs returned the voice: bind it to the consent.
    const bind = await request.post(`${MOCK}/rest/v1/rpc/voice_consent_bind`, {
      headers: SERVICE,
      data: { p_user: MOCK_VC_USER_ID, p_consent: consent.id, p_voice: "e2eClonedLan" },
    });
    bound = await bind.json();
    await route.fulfill({ json: { voice_id: "e2eClonedLan", name: "Bà Lan" } });
  });
  await page.getByRole("button", { name: "Clone Giọng Nói (ElevenLabs)" }).click();
  await expect(page.getByText("Giọng nói đã sẵn sàng để kể chuyện")).toBeVisible();
  expect(cloneForm).toMatch(new RegExp(`name="consentId"\\r\\n\\r\\n${consent.id}\\r\\n`));
  expect(cloneForm).not.toContain('name="apiKey"');
  expect(bound).toEqual({ ok: true, consent_id: consent.id });
  vs = await voiceState(request, MOCK_VC_USER_ID);
  expect(vs.consents[0].provider_voice_id).toBe("e2eClonedLan");
  expect(vs.profiles.map((p) => [p.name, p.elevenlabs_voice_id])).toEqual([["Bà Lan", "e2eClonedLan"]]);

  // Giọng đọc: the new voice has its consent (no "paused" badge).
  await page.getByRole("button", { name: "Hoàn Tất" }).click();
  await expect(page.getByRole("heading", { name: "Bà Lan" })).toBeVisible();
  await expect(page.getByTestId("voice-needs-consent")).toHaveCount(0);
});

test("gia đình có PIN: lưu lời đồng ý cần mã PIN; API không nhận khi thiếu bằng chứng của bố mẹ", async ({ page, context, baseURL, request }) => {
  await resetVoice(request, MOCK_VC_PIN_USER_ID);
  await signInAsMockFamily(context, baseURL!, { userId: MOCK_VC_PIN_USER_ID });
  await fakeMicrophone(context);
  await page.goto("/");
  const doc = await voiceDoc(request, MOCK_VC_PIN_USER_ID);
  const consentForm = (extra: Record<string, string> = {}) => ({
    documentId: doc.id,
    bodySha256: doc.body_sha256,
    speakerName: "Bố Nam",
    durationMs: "4000",
    ...extra,
    audio: { name: "consent", mimeType: "audio/webm", buffer: WEBM },
  });
  let r = await page.request.post("/api/voice/consent", { multipart: consentForm() });
  expect(r.status()).toBe(403);
  expect((await r.json()).code).toBe("voice_consent_parent_proof_required");
  // An older text (wrong hash) is refused too: the parent must read the current version.
  r = await page.request.post("/api/voice/consent", { multipart: consentForm({ bodySha256: "0".repeat(64), proof: "f".repeat(64) }) });
  expect(r.status()).toBe(409);
  expect((await r.json()).code).toBe("voice_consent_stale");
  // Not audio at all.
  r = await page.request.post("/api/voice/consent", {
    multipart: { ...consentForm(), audio: { name: "consent", mimeType: "audio/webm", buffer: Buffer.from("this is not audio at all") } },
  });
  expect(r.status()).toBe(400);
  expect((await r.json()).code).toBe("voice_consent_invalid_audio");
  expect((await voiceState(request, MOCK_VC_PIN_USER_ID)).consents).toHaveLength(0);

  await openRecording(page);
  await recordConsent(page, "Bố Nam", MOCK_PIN);
  const vs = await voiceState(request, MOCK_VC_PIN_USER_ID);
  expect(vs.consents.map((c) => [c.speaker_name, c.parent_method])).toEqual([["Bố Nam", "parent_pin"]]);
});

test("Cài đặt › Đồng ý giọng nói: nghe lại bản ghi, rút đồng ý → giọng ngừng ngay và được xếp hàng xoá; giọng cũ chưa có lời đồng ý bị tạm dừng", async ({
  page,
  context,
  baseURL,
  request,
  browser,
}) => {
  const W = MOCK_VC_WITHDRAW_USER_ID;
  await resetVoice(request, W);
  await signInAsMockFamily(context, baseURL!, { userId: W });
  await page.goto("/");
  await expect(nav(page)).toBeVisible();
  const tts = async (voiceId: string) => {
    const res = await page.request.post("/api/voice/tts", { data: { voiceId, text: "Xin chào", language: "vi" } });
    return { status: res.status(), code: ((await res.json().catch(() => ({}))) as { code?: string }).code };
  };
  // Authorized (this suite has no provider key → 400 after authorization) vs. paused legacy voice.
  expect((await tts("familyGrandpa")).status).toBe(400);
  expect(await tts("legacyVoice")).toEqual({ status: 403, code: "voice_consent_required" });

  await nav(page).getByRole("button", { name: "Giọng đọc", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Ông của bé" })).toBeVisible();
  const paused = page.getByTestId("voice-needs-consent");
  await expect(paused).toHaveCount(1);
  await expect(paused.locator("..")).toContainText("Giọng cũ");

  await nav(page).getByRole("button", { name: "Bố mẹ", exact: true }).click();
  await passParentGate(page);
  await page.getByRole("button", { name: /Đồng ý giọng nói/ }).click();
  const panel = page.getByTestId("voice-consent-panel");
  const item = panel.getByRole("region", { name: "Lời đồng ý của Ông Tư" });
  await expect(item).toContainText("Đang dùng");
  await expect(item).toContainText("Giọng: Ông của bé");
  await expect(item).toContainText("bản 1 · người giữ tài khoản xác nhận");
  await expect(item).toContainText("“Tôi là Ông Tư. Tôi đồng ý để KểCon dùng giọng nói của tôi");
  await expect(panel.getByTestId("voice-legacy-item")).toContainText("Giọng cũ");

  // Listening: streamed from the private bucket, never cached; another family gets nothing.
  const consentId = (await voiceState(request, W)).consents[0].id;
  const [played] = await Promise.all([
    page.waitForResponse((res) => res.url().endsWith(`/api/voice/consent/${consentId}/audio`)),
    item.getByRole("button", { name: "Nghe bản ghi lời đồng ý" }).click(),
  ]);
  expect(played.status()).toBe(200);
  expect(played.headers()["cache-control"]).toBe("private, no-store");
  expect(played.headers()["content-type"]).toBe("audio/wav");
  await expect(panel.getByRole("alert")).toHaveCount(0);
  const other = await browser.newContext({ baseURL });
  await signInAsMockFamily(other, baseURL!, { userId: MOCK_USER_ID });
  expect((await other.request.get(`/api/voice/consent/${consentId}/audio`)).status()).toBe(404);
  await other.close();

  // Withdraw: two steps ("Giữ giọng" keeps it).
  await item.getByRole("button", { name: "Rút đồng ý & xoá giọng" }).click();
  const confirm = item.getByRole("group", { name: "Xác nhận rút đồng ý" });
  await expect(confirm).toContainText("Rút đồng ý và xoá giọng Ông của bé?");
  await confirm.getByRole("button", { name: "Giữ giọng" }).click();
  await expect(confirm).toHaveCount(0);
  await item.getByRole("button", { name: "Rút đồng ý & xoá giọng" }).click();
  await confirm.getByRole("button", { name: "Xác nhận rút & xoá" }).click();
  await expect(panel.getByText(/Đã rút đồng ý: giọng Ông của bé ngừng được dùng ngay\. Giọng và các bản ghi được xoá hẳn trước/)).toBeVisible();
  await expect(item).toContainText("Đã rút");
  await expect(item.getByTestId("voice-deletion-status")).toContainText("Đang xoá · đang xoá giọng ở ElevenLabs · xong trước");
  await expect(item.getByRole("button", { name: "Nghe bản ghi lời đồng ý" })).toHaveCount(0);
  await expect(item.getByRole("button", { name: "Rút đồng ý & xoá giọng" })).toHaveCount(0);

  // The voice stops at once; the recording is already gone; the provider deletion is queued
  // (no ElevenLabs key in this suite → the 15-minute timer retries it).
  expect(await tts("familyGrandpa")).toEqual({ status: 403, code: "voice_unavailable" });
  let vs = await voiceState(request, W);
  expect(vs.consents[0]).toMatchObject({ withdraw_reason: "withdrawn", withdrawn_at: expect.any(String), audio_deleted_at: expect.any(String) });
  expect(vs.files).toEqual([]);
  expect(vs.profiles.map((p) => p.name)).toEqual(["Giọng cũ"]);
  expect(vs.jobs).toHaveLength(1);
  expect(vs.jobs[0]).toMatchObject({ consent_id: consentId, provider_voice_id: "familyGrandpa", reason: "withdrawn", status: "pending", files_removed: 1 });
  expect(vs.jobs[0].last_error).toContain("no_keys");

  // Giọng đọc › Xoá giọng (a kid tab): confirm, a parent checks, then the same withdrawal.
  await nav(page).getByRole("button", { name: "Giọng đọc", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Giọng cũ" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ông của bé" })).toHaveCount(0);
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Xóa giọng" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Xác nhận xoá giọng" })).toBeVisible();
  await passParentGate(page);
  await expect(page.getByText("Đã xoá giọng. Dữ liệu giọng được xoá hẳn trong vòng 24 giờ.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Giọng cũ" })).toHaveCount(0);
  vs = await voiceState(request, W);
  expect(vs.profiles).toEqual([]);
  expect(vs.jobs.map((j) => j.provider_voice_id).sort()).toEqual(["familyGrandpa", "legacyVoice"]);
  expect(await tts("legacyVoice")).toEqual({ status: 403, code: "voice_unavailable" });
});
