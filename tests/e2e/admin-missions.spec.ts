import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { signInAsMockFamily, MOCK_A15_ADMIN_ID } from "./support/fixtures";

// G-08 (docs/g08-missions-admin.md): staff edit mission copy / pause character
// cards with a reason; the client blocks result praise before any request.
// One worker shares the mock's state, so the specs run in order.
test.describe.configure({ mode: "serial" });

// clientWidth is the layout viewport; with mobile emulation innerWidth grows
// to fit overflowing content, so comparing against it would hide a blow-out.
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const axe = async (page: Page, include: string) =>
  (await new AxeBuilder({ page }).include(include).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations.map((v) => v.id);

test("G-08 · sửa mẫu nhiệm vụ: chặn lời khen kết quả trước khi gửi, cần lý do, lưu xong có phiên bản mới", async ({ page, context, baseURL }) => {
  await signInAsMockFamily(context, baseURL!, { userId: MOCK_A15_ADMIN_ID });
  const writes: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/rpc/admin_update_mission_template")) writes.push(r.postData() ?? "");
  });
  await page.goto("/admin/missions");
  await expect(page.locator("main h1")).toHaveText("Nhiệm vụ & thẻ nhân vật");
  const habit = page.getByTestId("mission-tu-cat-do-choi");
  await expect(habit).toContainText("Thói quen tốt · xong 5 lần · phiên bản 1");
  await expect(habit).toContainText("Truyện: Đồ chơi muốn về nhà");
  await expect(page.getByTestId("mission-nghe-het-truyen")).toContainText("Luôn bật");
  expect(await noSideScroll(page)).toBe(true);
  expect(await axe(page, "main")).toEqual([]);

  await habit.getByRole("button", { name: "Sửa nhiệm vụ Tự cất đồ chơi" }).click();
  const drawer = page.getByRole("dialog", { name: "Sửa: Tự cất đồ chơi" });
  await expect(drawer).toBeVisible();
  const praise = drawer.getByLabel("Lời Đóm khen");
  await praise.fill("Bé giỏi quá, Đóm thích lắm!");
  await drawer.getByRole("button", { name: "Lưu thay đổi" }).click();
  await expect(drawer).toContainText("Bỏ từ “giỏi”");
  await expect(drawer).toContainText("Lý do cần 10–500 ký tự");
  await expect(praise).toBeFocused(); // first problem gets focus (scrolls into view on a phone)
  expect(writes).toHaveLength(0); // nothing reaches the server
  expect(await axe(page, "dialog[open]")).toEqual([]);
  if (process.env.G08_QA) await page.screenshot({ path: "/data/g08/admin-missions-drawer.png" });

  await praise.fill("Bé đã tự đưa từng món đồ chơi về nhà. Đóm thấy bé chăm chỉ lắm!");
  await drawer.getByLabel(/Lý do thay đổi/).fill("Sửa câu khen theo góp ý của phụ huynh beta");
  await drawer.getByRole("button", { name: "Lưu thay đổi" }).click();
  await expect(page.getByText("Đã lưu “Tự cất đồ chơi” · phiên bản 2.")).toBeVisible();
  await expect(drawer).toBeHidden();
  await expect(habit).toContainText("phiên bản 2");
  await expect(habit).toContainText("Bé đã tự đưa từng món đồ chơi về nhà.");
  expect(writes).toHaveLength(1);
  expect(JSON.parse(writes[0])).toMatchObject({
    p_id: "tu-cat-do-choi",
    p_expected_version: 1,
    p_patch: { praise: "Bé đã tự đưa từng món đồ chơi về nhà. Đóm thấy bé chăm chỉ lắm!" },
    p_reason: "Sửa câu khen theo góp ý của phụ huynh beta",
  });

  // Kindness is thanked with words only: the server rule is explained plainly.
  await page.getByRole("button", { name: "Sửa nhiệm vụ Chia sẻ, chờ đến lượt" }).click();
  const kind = page.getByRole("dialog", { name: "Sửa: Chia sẻ, chờ đến lượt" });
  await kind.getByLabel("Lời Đóm khen").fill("Bé chia sẻ với bạn rồi!");
  await kind.getByLabel(/Lý do thay đổi/).fill("Thử đổi câu cảm ơn cho việc tốt");
  await kind.getByRole("button", { name: "Lưu thay đổi" }).click();
  await expect(kind).toContainText("câu cần bắt đầu bằng “Cảm ơn”");
  expect(writes).toHaveLength(1);
  await kind.getByRole("button", { name: "Huỷ" }).click();
  await expect(kind).toBeHidden();
});

test("G-08 · thẻ nhân vật: huỷ không gửi gì; tạm dừng cần lý do; tìm theo tên; vừa màn hình điện thoại", async ({ page, context, baseURL }) => {
  await signInAsMockFamily(context, baseURL!, { userId: MOCK_A15_ADMIN_ID });
  const writes: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/rpc/admin_set_mission_sticker")) writes.push(r.postData() ?? "");
  });
  await page.goto("/admin/missions");
  const card = page.getByTestId("sticker-00000000-0000-4000-8000-00000000c801");
  await expect(card).toContainText("Đã tặng 4");
  await expect(card).toContainText("Đang tặng");
  await expect(page.getByTestId("sticker-00000000-0000-4000-8000-00000000c803")).toContainText("chưa xuất bản");

  await card.getByRole("button", { name: "Tạm dừng thẻ Chiếc xe tải đỏ" }).click();
  const confirm = page.getByRole("dialog", { name: "Tạm dừng thẻ “Chiếc xe tải đỏ”?" });
  await expect(confirm).toContainText("Thẻ các bé đã có vẫn giữ nguyên");
  await confirm.getByRole("button", { name: "Huỷ" }).click();
  await expect(confirm).toBeHidden();
  expect(writes).toHaveLength(0);

  await card.getByRole("button", { name: "Tạm dừng thẻ Chiếc xe tải đỏ" }).click();
  await confirm.getByLabel(/Lý do thao tác/).fill("Ảnh bìa đang được vẽ lại, tạm dừng thẻ");
  await confirm.getByRole("button", { name: "Tạm dừng thẻ" }).click();
  await expect(page.getByText("Đã tạm dừng thẻ “Chiếc xe tải đỏ”.")).toBeVisible();
  await expect(card).toContainText("Tạm dừng");
  await expect(card.getByRole("button", { name: "Bật lại thẻ Chiếc xe tải đỏ" })).toBeVisible();
  expect(writes).toHaveLength(1);
  expect(JSON.parse(writes[0])).toMatchObject({ p_enabled: false, p_expected: true, p_reason: "Ảnh bìa đang được vẽ lại, tạm dừng thẻ" });

  await page.getByLabel("Tìm theo tên truyện").fill("đồ chơi");
  await expect(page.getByRole("list", { name: "Thẻ nhân vật" }).getByRole("listitem")).toHaveCount(1);
  for (const width of [390, 360, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    expect(await noSideScroll(page), `no side scroll at ${width}px`).toBe(true);
  }
  // Every control on the page is at least 44×44 at phone width.
  await page.setViewportSize({ width: 360, height: 800 });
  const small = await page.evaluate(() =>
    [...document.querySelectorAll("main button, main input, main select, main textarea")]
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width > 0 && (r.height < 44 || r.width < 44)).length,
  );
  expect(small).toBe(0);
  if (process.env.G08_QA) {
    await page.getByLabel("Tìm theo tên truyện").fill("");
    for (const close of await page.getByRole("button", { name: "Đóng thông báo" }).all()) await close.click();
    await page.screenshot({ path: "/data/g08/admin-missions-mobile.png", fullPage: true });
  }
});

test("G-08 · gia đình không mở được /admin/missions", async ({ page, context, baseURL }) => {
  await signInAsMockFamily(context, baseURL!);
  const res = await page.goto("/admin/missions");
  expect(res?.status()).toBe(404);
});
