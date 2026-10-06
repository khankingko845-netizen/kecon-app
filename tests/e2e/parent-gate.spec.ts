/**
 * T19 / UI-10 · Cổng phụ huynh + giới hạn thời gian/ngày.
 * Tiêu chí: bé không vào được tab Bố mẹ (cài đặt, thanh toán…) khi không có
 * PIN / không trả lời được câu hỏi người lớn; hết giờ thì màn của bé khoá lại.
 */
import { expect, test, type Page } from "@playwright/test";
import { MOCK_PIN, MOCK_PIN_USER_ID, passParentGate, signInAsMockFamily } from "./support/fixtures";

const nav = (page: Page) => page.getByRole("navigation", { name: "Điều hướng chính" });
const openParentTab = (page: Page) => nav(page).getByRole("button", { name: "Bố mẹ", exact: true }).click();
const gate = (page: Page) => page.locator("[data-parent-gate]");

test.describe("Cổng phụ huynh — chưa đặt PIN (câu hỏi người lớn)", () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await signInAsMockFamily(context, baseURL!);
  });

  test("tab Bố mẹ bị chặn; trả lời sai → câu mới; đúng → vào; về tab bé → khoá lại", async ({ page }) => {
    await page.goto("/");
    await openParentTab(page);

    await expect(page.getByRole("heading", { level: 1, name: "Khu vực của bố mẹ" })).toBeVisible();
    await expect(gate(page)).toHaveAttribute("data-parent-gate", "math");
    // Không lộ nội dung phụ huynh trước khi mở khoá
    await expect(page.getByRole("heading", { level: 1, name: "Bố mẹ", exact: true })).toHaveCount(0);
    await expect(page.getByText("Đăng xuất")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Kiểm soát phụ huynh/ })).toHaveCount(0);

    const challenge = gate(page).locator("[data-challenge]");
    const first = await challenge.getAttribute("data-challenge");
    const [a, b] = (first ?? "").split("×").map((n) => Number(n.trim()));
    await gate(page).getByLabel("Kết quả phép tính").fill(String(a * b + 1));
    await gate(page).getByRole("button", { name: "Mở khoá" }).click();
    await expect(gate(page).getByRole("alert")).toContainText("Chưa đúng");
    await expect(page.getByRole("heading", { level: 1, name: "Bố mẹ", exact: true })).toHaveCount(0);

    await passParentGate(page);
    await expect(page.getByRole("heading", { level: 1, name: "Bố mẹ", exact: true })).toBeVisible();

    // Trong vùng phụ huynh: vào Kiểm soát phụ huynh không bị hỏi lại
    await page.getByRole("button", { name: /Kiểm soát phụ huynh/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Kiểm soát phụ huynh" })).toBeVisible();
    await expect(page.getByText("Chưa đặt", { exact: true })).toBeVisible();
    await expect(nav(page).getByRole("button", { name: "Bố mẹ", exact: true })).toHaveAttribute("aria-current", "page");

    // Sang tab của bé rồi quay lại → phải mở khoá lại
    await nav(page).getByRole("button", { name: "Trang chủ", exact: true }).click();
    await openParentTab(page);
    await expect(gate(page)).toBeVisible();
  });

  test("bàn phím số dùng được; nút ← đưa bé về Trang chủ", async ({ page }) => {
    await page.goto("/");
    await openParentTab(page);
    await expect(gate(page)).toHaveAttribute("data-parent-gate", "math");
    const field = gate(page).getByLabel("Kết quả phép tính");
    await gate(page).getByRole("button", { name: "4", exact: true }).click();
    await gate(page).getByRole("button", { name: "2", exact: true }).click();
    await expect(field).toHaveValue("42");
    await gate(page).getByRole("button", { name: "Xoá số cuối" }).click();
    await expect(field).toHaveValue("4");

    await page.getByRole("button", { name: "Về trang chủ" }).click();
    await expect(gate(page)).toHaveCount(0);
    await expect(nav(page).getByRole("button", { name: "Trang chủ", exact: true })).toHaveAttribute("aria-current", "page");
  });

  test("sai 3 lần → tạm khoá, không đoán liên tục được", async ({ page }) => {
    await page.goto("/");
    await openParentTab(page);
    await expect(gate(page)).toHaveAttribute("data-parent-gate", "math");
    for (let i = 0; i < 3; i++) {
      await gate(page).getByLabel("Kết quả phép tính").fill("1");
      await gate(page).getByRole("button", { name: "Mở khoá" }).click();
    }
    await expect(gate(page).getByRole("alert")).toContainText("Đợi một chút");
    await expect(gate(page).getByLabel("Kết quả phép tính")).toBeDisabled();
  });
});

test.describe("Cổng phụ huynh — có PIN + giới hạn 30 phút/ngày", () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await signInAsMockFamily(context, baseURL!, { userId: MOCK_PIN_USER_ID });
  });

  test("PIN sai → báo còn lượt; PIN đúng (bàn phím) → vào tab Bố mẹ", async ({ page }) => {
    await page.goto("/");
    await openParentTab(page);
    await expect(gate(page)).toHaveAttribute("data-parent-gate", "pin");
    await gate(page).getByLabel("Mã PIN phụ huynh").fill("1111");
    await gate(page).getByRole("button", { name: "Mở khoá" }).click();
    await expect(gate(page).getByRole("alert")).toContainText("Mã PIN chưa đúng. Còn 4 lần thử");

    await passParentGate(page, MOCK_PIN);
    await expect(page.getByRole("heading", { level: 1, name: "Bố mẹ", exact: true })).toBeVisible();
  });

  test("Quên mã PIN → phải nhập mật khẩu tài khoản; sai mật khẩu bị từ chối", async ({ page }) => {
    await page.goto("/");
    await openParentTab(page);
    await expect(gate(page)).toHaveAttribute("data-parent-gate", "pin");
    await gate(page).getByRole("button", { name: "Quên mã PIN?" }).click();
    await expect(gate(page).getByText("e2e-pin@kecon.test")).toBeVisible();
    await gate(page).getByLabel("Mật khẩu tài khoản").fill("sai-mat-khau");
    await gate(page).getByRole("button", { name: "Xác minh & đặt lại PIN" }).click();
    await expect(gate(page).getByRole("alert")).toContainText("Mật khẩu chưa đúng");
    await expect(page.getByRole("heading", { level: 1, name: "Bố mẹ", exact: true })).toHaveCount(0);

    await gate(page).getByRole("button", { name: "Quay lại nhập mã PIN" }).click();
    await expect(gate(page)).toHaveAttribute("data-parent-gate", "pin");
  });

  test("hết 30 phút → màn bé khoá, không có thanh tab; bố mẹ nhập PIN cho thêm 15 phút", async ({ page }) => {
    await page.addInitScript(() => {
      const d = new Date();
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      if (!sessionStorage.getItem("seeded")) {
        sessionStorage.setItem("seeded", "1");
        localStorage.setItem("kecon-screen-time-v1", JSON.stringify({ date: key, seconds: 31 * 60, grantUntil: 0 }));
      }
    });
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Hết giờ nghe truyện hôm nay rồi!" })).toBeVisible();
    await expect(page.locator('[data-mascot="sleepy"]')).toBeVisible();
    await expect(nav(page)).toHaveCount(0);

    await page.getByRole("button", { name: "Bố mẹ mở thêm giờ" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Bố mẹ mở thêm giờ" })).toBeVisible();
    await passParentGate(page, MOCK_PIN);
    await page.getByRole("button", { name: "15 phút", exact: true }).click();

    await expect(page.locator("[data-screen-time-lock]")).toHaveCount(0);
    await expect(nav(page).getByRole("button", { name: "Trang chủ", exact: true })).toHaveAttribute("aria-current", "page");
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("kecon-screen-time-v1") ?? "{}"));
    expect(stored.grantUntil).toBeGreaterThan(Date.now() + 14 * 60_000);

    // Tải lại vẫn giữ thời gian được cho thêm
    await page.reload();
    await expect(nav(page)).toBeVisible();
    await expect(page.locator("[data-screen-time-lock]")).toHaveCount(0);
  });
});
