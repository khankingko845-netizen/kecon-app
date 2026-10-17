import { test, expect } from "@playwright/test";
import {
  signInAsMockFamily,
  MOCK_USER_ID,
  MOCK_VOICE_USER_ID,
} from "./support/fixtures";
test("unknown and foreign household voice IDs fail before quota/provider work in TTS and preview", async ({
  context,
  baseURL,
}) => {
  await signInAsMockFamily(context, baseURL!, { userId: MOCK_USER_ID });
  for (const voiceId of ["familyGrandma", "unregistered-legacy-id"]) {
    const t = await context.request.post("/api/voice/tts", {
      data: { voiceId, text: "Xin chào", language: "vi" },
    });
    expect(t.status()).toBe(403);
    expect((await t.json()).code).toBe("voice_unavailable");
    const p = await context.request.post("/api/voice/preview", {
      data: { voiceId, language: "vi" },
    });
    expect(p.status()).toBe(403);
  }
  await signInAsMockFamily(context, baseURL!, { userId: MOCK_VOICE_USER_ID });
  const own = await context.request.post("/api/voice/tts", {
    data: { voiceId: "familyGrandma", text: "Xin chào", language: "vi" },
  });
  // Hermetic non-paid suite has no configured provider keys: authorization succeeds,
  // then key configuration reports 400. This is not a pronunciation/paid synthesis eval.
  expect(own.status()).toBe(400);
  expect((await own.json()).code).not.toBe("voice_unavailable");
});
test("unauthenticated TTS cannot authorize or consume voice credit", async ({
  context,
}) => {
  await context.clearCookies();
  const r = await context.request.post("/api/voice/tts", {
    data: { voiceId: "familyGrandma", text: "Xin chào", language: "vi" },
  });
  expect(r.status()).toBe(401);
});
