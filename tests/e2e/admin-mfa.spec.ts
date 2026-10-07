import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { MOCK_MFA_USER_ID, signInAsMockFamily } from "./support/fixtures";
test("A05 · enroll TOTP, reject wrong code, gate API, idle lock and reverify", async ({
  page,
  context,
  baseURL,
}) => {
  await signInAsMockFamily(context, baseURL!, {
    userId: MOCK_MFA_USER_ID,
    adminReady: false,
  });
  await page.goto("/admin/settings");
  await expect(
    page.getByRole("heading", { name: "Xác thực quản trị", exact: true }),
  ).toBeVisible();
  await expect(page.locator("[data-admin-shell]")).toHaveCount(0);
  const blocked = await context.request.get("/api/admin/voice-catalog");
  expect(blocked.status()).toBe(403);
  expect(await blocked.json()).toMatchObject({ code: "admin_mfa_required" });
  await page.getByRole("button", { name: "Thiết lập MFA bằng TOTP" }).click();
  await expect(
    page.getByAltText("Mã QR thiết lập TOTP riêng của tài khoản"),
  ).toBeVisible();
  await page.getByLabel("Mã xác thực 6 chữ số").fill("000000");
  await page.getByRole("button", { name: "Xác thực và mở quản trị" }).click();
  await expect(
    page.getByRole("alert", { name: "Lỗi xác thực quản trị" }),
  ).toContainText("Mã không đúng");
  await expect(page.locator("[data-admin-shell]")).toHaveCount(0);
  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(axe.violations).toEqual([]);
  await page.getByLabel("Mã xác thực 6 chữ số").fill("123456");
  await page.getByRole("button", { name: "Xác thực và mở quản trị" }).click();
  await expect(
    page.getByRole("navigation", { name: "Quản trị", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Cài Đặt Hệ Thống", exact: true }),
  ).toBeVisible();
  const cookies = await context.cookies();
  const value = cookies.find((c) => c.name === "sb-127-auth-token")!.value;
  const session = JSON.parse(
    Buffer.from(value.replace("base64-", ""), "base64url").toString(),
  );
  const claims = JSON.parse(
    Buffer.from(session.access_token.split(".")[1], "base64url").toString(),
  );
  expect(claims.aal).toBe("aal2");
  await page.evaluate(
    (p) => sessionStorage.setItem("mfa-test-second", String(p)),
    claims.amr.find(
      (a: { method: string; timestamp: number }) => a.method === "totp",
    ).timestamp,
  );
  const expired = await context.request.post(
    "http://127.0.0.1:54321/__e2e/mfa-expire",
    { data: { session_id: claims.session_id } },
  );
  expect((await expired.json()).ok).toBe(true);
  const denied = await context.request.get("/api/admin/voice-catalog");
  expect(denied.status()).toBe(403);
  expect(await denied.json()).toMatchObject({ code: "admin_session_expired" });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByRole("heading", { name: "Xác thực quản trị", exact: true }),
  ).toBeVisible();
  await expect(page.locator("[data-admin-shell]")).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByText(
      "Phiên quản trị đã khoá sau 30 phút không hoạt động. Xác thực lại để tiếp tục.",
    ),
  ).toBeVisible();
  // A new challenge, not token refresh or reload, reopens the lease.
  await page.waitForFunction(
    () =>
      Math.floor(Date.now() / 1000) >
      Number(sessionStorage.getItem("mfa-test-second") ?? 0),
  );
  await page.getByLabel("Mã xác thực 6 chữ số").fill("123456");
  await page.getByRole("button", { name: "Xác thực và mở quản trị" }).click();
  await expect(
    page.getByRole("navigation", { name: "Quản trị", exact: true }),
  ).toBeVisible();
  // Delay a successful touch until after close; it must never remount admin.
  let release!: () => void;
  let seen!: () => void;
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  const touched = new Promise<void>((resolve) => {
    seen = resolve;
  });
  await page.route("**/rest/v1/rpc/touch_admin_session", async (route) => {
    const response = await route.fetch();
    expect((await response.json()).state).toBe("ready");
    seen();
    await delayed;
    await route.fulfill({ response });
  });
  await page.evaluate(() =>
    window.dispatchEvent(new PointerEvent("pointerdown")),
  );
  await touched;
  await page
    .getByRole("button", { name: "Khoá quản trị", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Xác thực quản trị", exact: true }),
  ).toBeVisible();
  await expect(page.locator("[data-admin-shell]")).toHaveCount(0);
  const late = page.waitForResponse((r) =>
    r.url().endsWith("/rpc/touch_admin_session"),
  );
  release();
  await late;
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(
    page.getByRole("heading", { name: "Xác thực quản trị", exact: true }),
  ).toBeVisible();
  await expect(page.locator("[data-admin-shell]")).toHaveCount(0);
});
