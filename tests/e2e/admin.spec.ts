/**
 * Admin v2 · A-01 — trang quản trị là route riêng `/admin`, guard phía server.
 * Tiêu chí: chưa đăng nhập / user thường nhận 404 kể cả gõ URL; admin vào được
 * layout desktop có thanh bên; Trang chủ của bé không còn ô "Quản trị".
 * A-02 — vai trò hẹp (Biên tập) chỉ thấy / mở được mục mình có quyền.
 * A-03 — màn "Nhật ký" (super admin / admin) lọc theo người / hành động / thời gian.
 * A-04 — API key chỉ-ghi: màn Cài đặt chỉ hiện "Đã đặt · …abcd", key không bao giờ quay lại trình duyệt.
 * A-04b — kho nhiều key ElevenLabs / Fish Audio: thêm, kiểm tra credit, tắt, xoá; chỉ thấy 4 ký tự cuối.
 */
import { expect, test, type Page } from "@playwright/test";
import {
  MOCK_ADMIN_USER_ID,
  MOCK_EDITOR_USER_ID,
  passParentGate,
  signInAsMockFamily,
} from "./support/fixtures";

const ADMIN_URLS = ["/admin", "/admin/users", "/admin/settings"];
const ALL_SECTIONS = [
  "Tổng quan",
  "Truyện",
  "Người dùng",
  "Thống kê",
  "Danh mục",
  "Mẫu truyện",
  "Cài đặt hệ thống",
  "Nhật ký",
];
const EDITOR_SECTIONS = ["Tổng quan", "Truyện", "Danh mục", "Mẫu truyện"];
const kidNav = (page: Page) =>
  page.getByRole("navigation", { name: "Điều hướng chính" });
const adminNav = (page: Page) =>
  page.getByRole("navigation", { name: "Quản trị" });

async function expectNotFound(page: Page, url: string) {
  const res = await page.goto(url);
  expect(res?.status(), url).toBe(404);
  await expect(
    page.getByRole("heading", { level: 1, name: "Không tìm thấy trang" }),
  ).toBeVisible();
  await expect(page.locator("[data-admin-shell]")).toHaveCount(0);
  await expect(adminNav(page)).toHaveCount(0);
  // Nothing in the response hints that a console exists (title, labels, data).
  expect(await page.title()).not.toContain("Quản trị");
  expect(await page.content()).not.toContain("Quản trị hệ thống");
}

async function openParentArea(page: Page) {
  await kidNav(page)
    .getByRole("button", { name: "Bố mẹ", exact: true })
    .click();
  await passParentGate(page);
  await expect(
    page.getByRole("heading", { level: 1, name: "Bố mẹ", exact: true }),
  ).toBeVisible();
}

test.describe("A-01 · /admin ẩn với người không phải admin", () => {
  test("chưa đăng nhập: mọi URL /admin → 404", async ({ page }) => {
    for (const url of ADMIN_URLS) await expectNotFound(page, url);
  });

  test("user thường: 404 kể cả gõ URL; Trang chủ và khu Bố mẹ không có lối vào", async ({
    page,
    context,
    baseURL,
  }) => {
    await signInAsMockFamily(context, baseURL!);
    for (const url of ADMIN_URLS) await expectNotFound(page, url);

    await page.goto("/");
    await expect(page.getByTestId("home-explore")).toBeVisible();
    await expect(page.getByText("Quản trị")).toHaveCount(0);
    await openParentArea(page);
    await expect(
      page.getByRole("button", { name: /Trang quản trị/ }),
    ).toHaveCount(0);
  });
});

test.describe("A-01 · admin", () => {
  test.use({
    viewport: { width: 1280, height: 800 },
    isMobile: false,
    hasTouch: false,
  });

  test.beforeEach(async ({ context, baseURL }) => {
    await signInAsMockFamily(context, baseURL!, { userId: MOCK_ADMIN_USER_ID });
  });

  test("layout desktop có thanh bên; mỗi mục một URL (tải lại, nút Back vẫn đúng)", async ({
    page,
  }) => {
    const res = await page.goto("/admin");
    expect(res?.status()).toBe(200);
    await expect(page).toHaveTitle("Tổng quan · Quản trị KểCon");
    await expect(adminNav(page)).toBeVisible();
    await expect(
      adminNav(page).getByRole("link", { name: "Tổng quan" }),
    ).toHaveAttribute("aria-current", "page");
    await expect(
      page.getByRole("heading", { name: "Quản Trị", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("e2e-admin@kecon.test")).toBeVisible();
    // Desktop: the sidebar is a full-height column beside the content, no kid tab bar.
    const aside = await page.locator("aside").boundingBox();
    expect(aside!.width).toBeLessThan(300);
    expect(aside!.height).toBeGreaterThanOrEqual(790);
    await expect(kidNav(page)).toHaveCount(0);
    // A-02: legacy "admin" keeps every section.
    await expect(adminNav(page).getByRole("link")).toHaveText(ALL_SECTIONS);
    await expect(page.getByText("Admin (đầy đủ)")).toBeVisible();

    await adminNav(page).getByRole("link", { name: "Người dùng" }).click();
    await expect(page).toHaveURL(/\/admin\/users$/);
    await expect(
      page.getByRole("heading", { name: "Người dùng", exact: true }),
    ).toBeVisible();
    await expect(
      adminNav(page).getByRole("link", { name: "Người dùng" }),
    ).toHaveAttribute("aria-current", "page");
    await expect(page).toHaveTitle("Người dùng · Quản trị KểCon");

    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Người dùng", exact: true }),
    ).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/admin$/);
    await expect(
      page.getByRole("heading", { name: "Quản Trị", exact: true }),
    ).toBeVisible();

    await page.getByRole("link", { name: "Về app KểCon" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("home-explore")).toBeVisible();
  });

  test("URL lạ → 404; Trang chủ bé không còn ô Quản trị; lối vào nằm trong khu Bố mẹ", async ({
    page,
  }) => {
    await expectNotFound(page, "/admin/khong-co");
    await expectNotFound(page, "/admin/users/1");

    await page.goto("/");
    await expect(page.getByTestId("home-explore")).toBeVisible();
    await expect(
      page.getByTestId("home-explore").getByText("Quản trị"),
    ).toHaveCount(0);

    await openParentArea(page);
    await page.getByRole("button", { name: /Trang quản trị/ }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await expect(adminNav(page)).toBeVisible();
  });
});

test.describe("A-03 · Nhật ký thao tác", () => {
  test.use({
    viewport: { width: 1280, height: 800 },
    isMobile: false,
    hasTouch: false,
  });

  test.beforeEach(async ({ context, baseURL }) => {
    await signInAsMockFamily(context, baseURL!, { userId: MOCK_ADMIN_USER_ID });
  });

  test("admin xem nhật ký mới nhất trước; lọc theo hành động, người, ngày", async ({
    page,
  }) => {
    const res = await page.goto("/admin/audit");
    expect(res?.status()).toBe(200);
    await expect(page).toHaveTitle("Nhật ký · Quản trị KểCon");
    await expect(
      adminNav(page).getByRole("link", { name: "Nhật ký" }),
    ).toHaveAttribute("aria-current", "page");
    const entries = page
      .getByRole("list", { name: "Nhật ký thao tác" })
      .locator(":scope > li");
    await expect(entries).toHaveCount(4);

    const newest = entries.first();
    await expect(newest).toContainText("Đổi vai trò");
    await expect(newest).toContainText("e2e-admin@kecon.test · Admin (đầy đủ)");
    await expect(newest).toContainText("role: user → editor");
    await expect(newest).toContainText("IP 203.0.113.7");
    // API key changes are logged without the key itself; SQL / system changes have no actor.
    await expect(entries.nth(2)).toContainText("Đổi API key");
    await expect(entries.nth(2)).toContainText("value: [đã ẩn] → [đã ẩn]");
    await expect(entries.nth(3)).toContainText("Hệ thống / SQL");

    await page.getByLabel("Hành động").selectOption({ label: "Sửa truyện" });
    await expect(entries).toHaveCount(1);
    await expect(entries.first()).toContainText(
      "title: Thỏ con → Thỏ con và Rùa",
    );
    await page.getByRole("button", { name: "Xoá bộ lọc" }).click();
    await expect(entries).toHaveCount(4);

    await page.getByLabel("Người thực hiện").fill("EDITOR@");
    await expect(entries).toHaveCount(1);
    await expect(entries.first()).toContainText(
      "e2e-editor@kecon.test · Biên tập",
    );
    await page.getByLabel("Người thực hiện").fill("");
    await expect(entries).toHaveCount(4);

    await page.getByLabel("Từ ngày").fill("2026-03-01");
    await expect(entries).toHaveCount(2);
    await page.getByLabel("Đến ngày").fill("2026-03-03");
    await expect(entries).toHaveCount(1);
    await page.getByLabel("Hành động").selectOption({ label: "Đổi vai trò" });
    await expect(
      page.getByText("Không có thao tác nào khớp bộ lọc"),
    ).toBeVisible();

    // Read-only screen: no edit / delete controls for log entries.
    await page.getByRole("button", { name: "Xoá bộ lọc" }).click();
    await expect(entries).toHaveCount(4);
    await expect(
      page.getByRole("button", { name: /Sửa|Xoá(?! bộ lọc)/ }),
    ).toHaveCount(0);
  });

  test("ô Nhật ký trên Tổng quan mở /admin/audit", async ({ page }) => {
    await page.goto("/admin");
    await page
      .getByRole("main")
      .getByRole("button", { name: "Nhật ký" })
      .click();
    await expect(page).toHaveURL(/\/admin\/audit$/);
    await expect(
      page.getByRole("heading", { name: "Nhật ký", exact: true }),
    ).toBeVisible();
  });
});

test.describe("A-04 · API key chỉ-ghi (Cài đặt hệ thống)", () => {
  test.use({
    viewport: { width: 1280, height: 800 },
    isMobile: false,
    hasTouch: false,
  });
  const STORED_CLAUDE = "sk-ant-e2e-stored-claude-x9Qz"; // mock Vault — must never reach the browser
  const NEW_OPENAI = "sk-e2e-new-openai-key-7777";

  test.beforeEach(async ({ context, baseURL }) => {
    await signInAsMockFamily(context, baseURL!, { userId: MOCK_ADMIN_USER_ID });
  });

  test("hiện trạng thái + 4 ký tự cuối; đặt key mới rồi xoá; key không quay lại trình duyệt", async ({
    page,
  }) => {
    const bodies: Promise<string>[] = [];
    page.on("response", (r) => bodies.push(r.text().catch(() => "")));

    await page.goto("/admin/settings");
    await page.getByRole("button", { name: "Claude", exact: true }).click();
    const claude = page.getByTestId("secret-status-anthropic_api_key");
    await expect(claude).toContainText("Đã đặt · …x9Qz");
    await expect(claude).toContainText("e2e-admin@kecon.test");
    await expect(page.getByLabel("API key Claude")).toHaveValue("");
    await expect(page.getByLabel("API key Claude")).toHaveAttribute(
      "placeholder",
      /Nhập key mới để thay/,
    );

    await page.getByRole("button", { name: "OpenAI", exact: true }).click();
    const openai = page.getByTestId("secret-status-openai_api_key");
    await expect(openai).toHaveText("Chưa đặt");
    await page.getByLabel("API key OpenAI").fill(NEW_OPENAI);
    const saved = page.waitForResponse((r) =>
      r.url().includes("/rest/v1/rpc/set_system_secret"),
    );
    await page.getByRole("button", { name: "Lưu Cài Đặt" }).click();
    expect(await (await saved).text()).not.toContain(NEW_OPENAI); // write-only: only the status comes back
    await expect(openai).toContainText("Đã đặt · …7777");
    await expect(page.getByLabel("API key OpenAI")).toHaveValue("");
    await expect(
      page.getByRole("button", { name: "Đã lưu thành công!" }),
    ).toBeVisible();

    await openai.getByRole("button", { name: "Xoá key" }).click();
    const confirm = page.getByRole("dialog", { name: "Xoá API key OpenAI?" });
    await confirm
      .getByLabel("Lý do thao tác")
      .fill("Xoá key thử nghiệm trong E2E");
    await confirm.getByRole("button", { name: "Xoá key", exact: true }).click();
    await expect(openai).toHaveText("Chưa đặt");

    const all = (await Promise.all(bodies)).join("\n");
    expect(all).not.toContain(STORED_CLAUDE);
    expect(all).not.toContain(NEW_OPENAI);
  });
});

test.describe("A-04b · kho nhiều key giọng nói (ElevenLabs + Fish Audio)", () => {
  test.use({
    viewport: { width: 1280, height: 800 },
    isMobile: false,
    hasTouch: false,
  });
  // mock pool (mock-supabase.mjs) — secrets must never reach the browser
  const POOL_SECRETS = [
    "sk_e2e-stored-elevenlabs-x9Qz",
    "sk_e2e-pool-elevenlabs-quota-Ab12",
  ];
  const NEW_FISH = "e2e-fish-new-account-key-5555";

  test.beforeEach(async ({ context, baseURL }) => {
    await signInAsMockFamily(context, baseURL!, { userId: MOCK_ADMIN_USER_ID });
  });

  test("hiện kho key + credit; thêm key Fish → tự kiểm tra; tắt / xoá; key không quay lại trình duyệt", async ({
    page,
  }) => {
    const bodies: Promise<string>[] = [];
    page.on("response", (r) => bodies.push(r.text().catch(() => "")));

    await page.goto("/admin/settings");
    const eleven = page.getByTestId("key-pool-elevenlabs");
    await expect(eleven).toContainText("2 key · 1 đang dùng");
    const main = eleven.getByRole("listitem").filter({ hasText: "…x9Qz" });
    await expect(main).toContainText("Key chính (chuyển từ A-04)");
    await expect(main).toContainText("Đang dùng");
    await expect(main).toContainText("Còn 8.500 / 10.000 ký tự");
    const spare = eleven.getByRole("listitem").filter({ hasText: "…Ab12" });
    await expect(spare).toContainText("Hết credit · thử lại 15/01"); // cooldown_until 2099-01-15 → date + time
    await expect(spare).toContainText("exceeds your quota");
    await expect(spare.getByRole("button", { name: "Bật lại" })).toBeVisible();

    // "Kiểm tra" runs on the server against the provider (mocked) — status + credit only.
    const checked = page.waitForResponse((r) =>
      r.url().includes("/api/admin/provider-keys/check"),
    );
    await main.getByRole("button", { name: "Kiểm tra", exact: true }).click();
    const checkBody = await (await checked).json();
    expect(checkBody.results).toEqual([
      expect.objectContaining({ ok: true, status: "active" }),
    ]);
    await expect(main).toContainText("Đang dùng");

    // Add a Fish Audio key → it is checked right away.
    const fish = page.getByTestId("key-pool-fishaudio");
    await expect(fish).toContainText("Chưa có key nào");
    await page.getByLabel("Tên key Fish Audio mới").fill("Tài khoản Fish 1");
    await page.getByLabel("API key Fish Audio mới").fill(NEW_FISH);
    await fish.getByRole("button", { name: "Thêm key" }).click();
    await expect(fish).toContainText("Đã thêm key …5555 · kiểm tra OK");
    const added = fish.getByRole("listitem").filter({ hasText: "…5555" });
    await expect(added).toContainText("Tài khoản Fish 1");
    await expect(added).toContainText("Số dư $5.50");
    await expect(page.getByLabel("API key Fish Audio mới")).toHaveValue("");

    // The same key twice → refused.
    await page.getByLabel("API key Fish Audio mới").fill(NEW_FISH);
    await fish.getByRole("button", { name: "Thêm key" }).click();
    await expect(fish).toContainText(
      "Key này đã có trong kho Fish Audio (…5555)",
    );
    await page.getByLabel("API key Fish Audio mới").fill("");

    await added.getByRole("button", { name: "Tắt" }).click();
    await expect(added).toContainText("Đã tắt");
    await added.getByRole("button", { name: "Xoá" }).click();
    const removal = page.getByRole("dialog");
    await removal
      .getByLabel("Lý do thao tác")
      .fill("Xoá key QA sau khi kiểm thử");
    await removal.getByRole("button", { name: "Xoá key", exact: true }).click();
    await expect(fish).toContainText("Chưa có key nào");

    const all = (await Promise.all(bodies)).join("\n");
    for (const secret of [...POOL_SECRETS, NEW_FISH])
      expect(all).not.toContain(secret);
  });
});

test.describe("A-02 · biên tập (vai trò hẹp)", () => {
  test.use({
    viewport: { width: 1280, height: 800 },
    isMobile: false,
    hasTouch: false,
  });

  test.beforeEach(async ({ context, baseURL }) => {
    await signInAsMockFamily(context, baseURL!, {
      userId: MOCK_EDITOR_USER_ID,
    });
  });

  test("thanh bên chỉ có mục của biên tập; mục khác → 404 kể cả gõ URL", async ({
    page,
  }) => {
    const res = await page.goto("/admin");
    expect(res?.status()).toBe(200);
    await expect(adminNav(page).getByRole("link")).toHaveText(EDITOR_SECTIONS);
    await expect(page.getByText("Biên tập", { exact: true })).toBeVisible();
    // Dashboard tiles only link to sections the editor may open.
    await expect(page.getByText("Tạo truyện mới").first()).toBeVisible();

    await adminNav(page).getByRole("link", { name: "Danh mục" }).click();
    await expect(page).toHaveURL(/\/admin\/categories$/);
    await expect(
      adminNav(page).getByRole("link", { name: "Danh mục" }),
    ).toHaveAttribute("aria-current", "page");

    for (const url of [
      "/admin/settings",
      "/admin/users",
      "/admin/analytics",
      "/admin/audit",
    ])
      await expectNotFound(page, url);
  });

  test("lối vào Trang quản trị trong khu Bố mẹ", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("home-explore")).toBeVisible();
    await openParentArea(page);
    await page.getByRole("button", { name: /Trang quản trị/ }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await expect(adminNav(page).getByRole("link")).toHaveText(EDITOR_SECTIONS);
  });
});
