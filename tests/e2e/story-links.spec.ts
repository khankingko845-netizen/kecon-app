import { test, expect } from "@playwright/test";
import {
  signInAsMockFamily,
  passParentGate,
  MOCK_VOICE_USER_ID,
  MOCK_STORY_ID,
} from "./support/fixtures";
const publicStory = "00000000-0000-4000-8000-000000009a01";
test("public text link: issue, fragment reader, foreign revoke denied, own revoke closes visitor", async ({
  context,
  page,
  baseURL,
}) => {
  await signInAsMockFamily(context, baseURL!);
  const r = await context.request.post("/api/share/links", {
    data: { storyId: publicStory, hours: 24 },
  });
  expect(r.status()).toBe(200);
  const l = await r.json();
  expect(l.share_token).toMatch(/^[a-f0-9]{64}$/);
  await page.goto("/share#" + l.share_token);
  await expect(
    page.getByRole("heading", { name: "Truyện công khai QA" }),
  ).toBeVisible();
  await expect(page.getByText("Chú sóc cùng thỏ đọc truyện.")).toBeVisible();
  await expect(page.locator("audio")).toHaveCount(0);
  await signInAsMockFamily(context, baseURL!, { userId: MOCK_VOICE_USER_ID });
  expect(
    (
      await context.request.delete("/api/share/links", { data: { id: l.id } })
    ).status(),
  ).toBe(404);
  await signInAsMockFamily(context, baseURL!);
  expect(
    (
      await context.request.delete("/api/share/links", { data: { id: l.id } })
    ).status(),
  ).toBe(200);
  await page.reload();
  await expect(page.getByRole("alert").filter({ hasText: "Link không khả dụng" })).toContainText("hết hạn");
  expect(
    (await context.request.get("/api/share/" + l.share_token)).status(),
  ).toBe(410);
});
test("sharing UI is behind parent gate; private story stays closed and error toast is honest", async ({
  context,
  page,
  baseURL,
}) => {
  await signInAsMockFamily(context, baseURL!);
  await page.goto("/");
  await page.getByText("Sóc Nhỏ tìm hạt dẻ").first().click();
  await page.getByRole("button", { name: "Thêm tuỳ chọn" }).click();
  await page
    .getByRole("dialog", { name: "Tuỳ chọn truyện" })
    .getByRole("button", { name: "Chia sẻ", exact: true })
    .click();
  await expect(page.locator("[data-parent-gate]")).toBeVisible();
  await expect(page.getByRole("button", { name: "Tạo link mới" })).toHaveCount(
    0,
  );
  await passParentGate(page);
  await page.getByRole("button", { name: "Tạo link mới" }).click();
  await expect(
    page.getByRole("region", { name: "Thông báo thao tác" }),
  ).toContainText("truyện nền tảng công khai");
  await expect(page.getByLabel("Link đã tạo")).toHaveCount(0);
  expect(
    (
      await context.request.post("/api/share/links", {
        data: { storyId: MOCK_STORY_ID, hours: 24 },
      })
    ).status(),
  ).toBe(403);
});
test("guest cannot manage links; malformed tokens and actors cannot enter resolver/issue", async ({
  context,
}) => {
  await context.clearCookies();
  expect(
    (
      await context.request.post("/api/share/links", {
        data: { storyId: publicStory },
      })
    ).status(),
  ).toBe(401);
  expect(
    (
      await context.request.post("/api/share/resolve", {
        data: { token: "bad" },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await context.request.post("/api/share/resolve", {
        data: { token: "a".repeat(64), household_id: "foreign" },
      })
    ).status(),
  ).toBe(400);
});
