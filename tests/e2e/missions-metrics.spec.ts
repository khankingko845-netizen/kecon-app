import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { signInAsMockFamily, MOCK_A15_ADMIN_ID } from "./support/fixtures";

// G-10 (docs/g10-missions-metrics.md): staff see weekly aggregates of the
// missions loop and its guardrails; small samples hide the nights histogram.
test("G-10 số liệu tuần: tuần đủ làm tiêu đề, bảng vòng lặp + giới hạn an toàn, đổi số tuần, lỗi hiện rõ", async ({ page, context, baseURL }) => {
  await signInAsMockFamily(context, baseURL!, { userId: MOCK_A15_ADMIN_ID });
  await page.goto("/admin/analytics");
  const panel = page.getByRole("region", { name: "Số liệu Bầu trời của Đóm" });
  await expect(panel.getByRole("heading", { name: "Tuần 05/10–11/10" })).toBeVisible();
  await expect(panel.getByText("6 / 9", { exact: true })).toBeVisible();
  await expect(panel.getByText("75%", { exact: true })).toBeVisible();
  // Vietnamese decimals, never "2.5".
  await expect(panel.getByText("2,5", { exact: true })).toHaveCount(2); // headline + table row
  await expect(panel.getByText("2.5", { exact: true })).toHaveCount(0);
  await expect(panel.getByRole("list", { name: "Số gia đình theo số tối trong tuần" }).getByRole("listitem")).toHaveCount(7);
  const loop = panel.getByRole("region", { name: "Bảng vòng lặp theo tuần" });
  await expect(loop.getByRole("rowheader")).toHaveText(["12/10–18/10 (đang chạy)", "05/10–11/10", "28/09–04/10"]);
  await expect(loop.getByRole("row", { name: /28\/09/ })).toContainText("9 → 8 (89%) *");
  const guard = panel.getByRole("region", { name: "Bảng giới hạn an toàn theo tuần" });
  await expect(guard.getByRole("row", { name: /28\/09/ })).toContainText("chưa đo");
  await expect(guard.getByRole("row", { name: /05\/10/ })).toContainText("9 / 1 / 2");
  await expect(panel).toContainText("phiên chưa xong đã bị dọn sau 7 ngày");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const a = await new AxeBuilder({ page }).include('section[aria-label="Số liệu Bầu trời của Đóm"]').withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(a.violations).toEqual([]);
  if (process.env.G10_QA === "1") await panel.screenshot({ path: "/data/g10/admin-metrics-mobile.png" });

  const four = page.waitForRequest((r) => r.url().includes("/api/admin/missions-metrics?weeks=4"));
  await panel.getByLabel("Số tuần").selectOption("4");
  await four;
  await expect(loop.getByRole("rowheader")).toHaveCount(3);

  await page.route("**/api/admin/missions-metrics?*", (r) => r.fulfill({ status: 503, json: { error: "unavailable" } }));
  await panel.getByLabel("Số tuần").selectOption("12");
  await expect(panel.getByRole("alert")).toContainText("Không tải được số liệu");
});

test("G-10 API: chỉ nhân viên có analytics.view; số tuần 1–12", async ({ context, baseURL }) => {
  await signInAsMockFamily(context, baseURL!);
  expect((await context.request.get(baseURL! + "/api/admin/missions-metrics?weeks=8")).status()).toBe(403);
  await signInAsMockFamily(context, baseURL!, { userId: MOCK_A15_ADMIN_ID });
  expect((await context.request.get(baseURL! + "/api/admin/missions-metrics?weeks=13")).status()).toBe(400);
  expect((await context.request.get(baseURL! + "/api/admin/missions-metrics?weeks=0")).status()).toBe(400);
  const ok = await context.request.get(baseURL! + "/api/admin/missions-metrics?weeks=2");
  expect(ok.status()).toBe(200);
  expect(ok.headers()["cache-control"]).toContain("no-store");
  expect((await ok.json()).weeks).toHaveLength(2);
});
