import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { signInAsMockFamily, MOCK_A15_ADMIN_ID } from "./support/fixtures";
import { noSideScroll } from "./support/layout";

// Admin › Sao lưu (docs/admin-backup.md): status, "Sao lưu ngay", schedule + retention,
// GitHub token. The mock keeps one shared backup state → reset before each spec, run in order.
test.describe.configure({ mode: "serial" });
const MOCK = "http://127.0.0.1:54321";
const axe = async (page: Page, include: string) =>
  (await new AxeBuilder({ page }).include(include).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations.map((v) => v.id);

test.beforeEach(async ({ request, context, baseURL }) => {
  await request.post(`${MOCK}/__e2e/backup-reset`);
  await signInAsMockFamily(context, baseURL!, { userId: MOCK_A15_ADMIN_ID });
});

test("trạng thái ổn, đọc được trên điện thoại; Sao lưu ngay cần lý do rồi chờ máy chủ nhận", async ({ page }) => {
  const writes: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/rpc/admin_request_backup")) writes.push(r.postData() ?? "");
  });
  await page.goto("/admin/backup");
  await expect(page.locator("main h1")).toHaveText("Sao lưu");
  await expect(page.getByRole("navigation", { name: "Quản trị" }).getByRole("link", { name: "Sao lưu" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("Ổn:", { exact: false })).toBeVisible();
  const lastOk = page.getByRole("region", { name: "Lần thành công gần nhất" });
  await expect(lastOk).toContainText("40 truyện · 683 file media");
  await expect(lastOk).toContainText("Khôi phục thử: đạt (91 bảng, 0 lỗi · Vault 3/3 khớp)");
  await expect(page.getByRole("region", { name: "Máy chủ sao lưu" })).toContainText("khankingko845-netizen/kecon-backup");
  await expect(page.getByTestId("backup-token")).toContainText("Đẩy được, repo riêng tư");
  await expect(page.getByRole("region", { name: /Bản chụp cơ sở dữ liệu/ })).toContainText("db-");
  expect(await noSideScroll(page)).toBe(true);
  expect(await axe(page, "main")).toEqual([]);

  // Cancel sends nothing.
  await page.getByRole("button", { name: "Sao lưu ngay" }).click();
  const dialog = page.getByRole("dialog", { name: "Sao lưu ngay?" });
  await expect(dialog).toBeVisible();
  expect(await axe(page, "dialog[open]")).toEqual([]);
  await dialog.getByRole("button", { name: "Huỷ" }).click();
  await expect(dialog).toBeHidden();
  expect(writes).toHaveLength(0);

  await page.getByRole("button", { name: "Sao lưu ngay" }).click();
  await dialog.getByLabel("Lý do thao tác").fill("Sao lưu trước khi nâng cấp máy chủ");
  await dialog.getByRole("button", { name: "Sao lưu ngay" }).click();
  await expect(page.getByText("Đã gửi yêu cầu.", { exact: false }).first()).toBeVisible();
  await expect(page.getByTestId("backup-progress")).toContainText("Đang chờ máy chủ nhận yêu cầu");
  await expect(page.getByRole("button", { name: "Sao lưu ngay" })).toBeDisabled();
  await expect(page.getByText("“Sao lưu ngay” đang tắt: Đang có một lần sao lưu chờ hoặc đang chạy.")).toBeVisible();
  expect(writes.map((w) => JSON.parse(w))).toEqual([{ p_reason: "Sao lưu trước khi nâng cấp máy chủ" }]);
  if (process.env.BACKUP_QA) await page.screenshot({ path: "/data/admin-backup/e2e-request.png", fullPage: true });
});

test("giảm số bản giữ lại: báo trước bản bị xoá vĩnh viễn, cần xác nhận + lý do; lưu đúng phiên bản", async ({ page }) => {
  const writes: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/rpc/admin_update_backup_settings")) writes.push(r.postData() ?? "");
  });
  await page.goto("/admin/backup");
  const form = page.getByRole("region", { name: "Lịch & số bản giữ lại" });
  await expect(form.getByLabel("Giờ chạy hằng ngày (giờ VN)")).toHaveValue("03:15");
  await expect(form.getByTestId("retention-estimate")).toContainText("khoảng");
  await form.getByLabel("Giờ chạy hằng ngày (giờ VN)").fill("04:30");
  await form.getByLabel("Bản theo ngày").fill("3");
  await form.getByLabel("Bản theo tuần").fill("0");
  await form.getByLabel("Bản theo tháng").fill("0");
  await expect(form.getByTestId("retention-drop")).toContainText("sẽ xoá 4 bản chụp cũ");
  await form.getByRole("button", { name: "Lưu lịch sao lưu" }).click();
  await expect(form).toContainText("Cần xác nhận trước khi lưu.");
  await expect(form).toContainText("Lý do cần 10–500 ký tự");
  expect(writes).toHaveLength(0);
  expect(await axe(page, "main")).toEqual([]);

  await form.getByLabel("Tôi hiểu các bản này sẽ bị xoá vĩnh viễn").check();
  await form.getByLabel(/Lý do thay đổi/).fill("Giảm dung lượng repo sao lưu khi chạy thử");
  await form.getByRole("button", { name: "Lưu lịch sao lưu" }).click();
  await expect(page.getByText("Đã lưu: chạy lúc 04:30 hằng ngày, giữ 3 ngày + 0 tuần + 0 tháng.")).toBeVisible();
  expect(writes.map((w) => JSON.parse(w))).toEqual([
    { p_expected_version: 1, p_schedule_time: "04:30", p_keep_daily: 3, p_keep_weekly: 0, p_keep_monthly: 0, p_reason: "Giảm dung lượng repo sao lưu khi chạy thử" },
  ]);
  await expect(page.getByRole("region", { name: "Lần chạy tới" })).toContainText("Mỗi ngày lúc 04:30");
  await expect(form.getByTestId("retention-drop")).toHaveCount(0);
});

test("token GitHub: ô mật khẩu, kiểm tra định dạng trước khi gửi, báo lỗi GitHub rõ ràng, lưu xong chỉ còn 4 ký tự cuối", async ({ page }) => {
  const TOKEN = "github_pat_11E2ETEST00" + "q".repeat(58) + "Wxyz";
  const sent: unknown[] = [];
  let answer = 0;
  await page.route("**/api/admin/backup/token", async (route) => {
    sent.push(route.request().postDataJSON());
    answer += 1;
    if (answer === 1) return route.fulfill({ status: 422, json: { error: "Token chỉ đọc được repo. Cần quyền Contents: Read and write cho repo sao lưu.", code: "token_no_push" } });
    return route.fulfill({ json: { ok: true, last4: "Wxyz", kind: "fine_grained", set_at: new Date().toISOString(), expires_at: "2027-01-14T00:00:00.000Z", warnings: [] } });
  });
  await page.goto("/admin/backup");
  const card = page.getByTestId("backup-token");
  const input = card.getByLabel("Token mới");
  await expect(input).toHaveAttribute("type", "password");
  await expect(card.getByRole("link", { name: /tạo token trên GitHub/ })).toHaveAttribute("href", "https://github.com/settings/personal-access-tokens/new");

  await input.fill("gho_không-hợp-lệ");
  await card.getByRole("button", { name: "Kiểm tra & lưu token" }).click();
  await expect(card).toContainText("Token phải bắt đầu bằng github_pat_");
  await expect(card).toContainText("Lý do cần 10–500 ký tự");
  expect(sent).toHaveLength(0);

  await input.fill(TOKEN);
  await card.getByLabel(/^Lý do/).fill("Thay token sắp hết hạn của máy chủ");
  await card.getByRole("button", { name: "Kiểm tra & lưu token" }).click();
  await expect(card.getByRole("alert")).toContainText("Token chỉ đọc được repo");
  await expect(input).toHaveValue(TOKEN);

  await card.getByRole("button", { name: "Kiểm tra & lưu token" }).click();
  await expect(card.getByRole("status")).toContainText("Đã lưu token …Wxyz (fine-grained, hết hạn 14/01/2027)");
  await expect(input).toHaveValue("");
  expect(sent).toEqual([
    { token: TOKEN, reason: "Thay token sắp hết hạn của máy chủ" },
    { token: TOKEN, reason: "Thay token sắp hết hạn của máy chủ" },
  ]);
  await expect(page.locator("main")).not.toContainText(TOKEN.slice(11, 30));
  expect(await axe(page, "main")).toEqual([]);
});
