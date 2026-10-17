import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { MOCK_KIDS_NEW_USER_ID, MOCK_KIDS_USER_ID, mockAccessToken, passParentGate, signInAsMockFamily } from "./support/fixtures";

/**
 * T10 · Hồ sơ bé (migration 044, docs/child-profiles.md): 1–5 bé mỗi gia đình (tên gọi,
 * năm sinh, sở thích). Bé đang chọn trên thiết bị quyết định lời chào, nhóm tuổi của giao
 * diện và truyện được tạo cho ai. Mock Supabase giữ hồ sơ trong bộ nhớ → chạy tuần tự.
 */
test.describe.configure({ mode: "serial" });

const MOCK = "http://127.0.0.1:54321";
const VN_YEAR = Number(new Intl.DateTimeFormat("en", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric" }).format(new Date()));
type Kid = { id: string; display_name: string; birth_year: number | null; interests: string[] };

const auth = (uid: string, email: string) => ({ Authorization: `Bearer ${mockAccessToken(uid, email)}` });
const KIDS = auth(MOCK_KIDS_USER_ID, "e2e-kids@kecon.test");
const NEW = auth(MOCK_KIDS_NEW_USER_ID, "e2e-kids-new@kecon.test");

async function kidsOf(request: APIRequestContext, headers: Record<string, string>): Promise<Kid[]> {
  const res = await request.get(`${MOCK}/rest/v1/child_profiles?select=id,display_name,birth_year,interests&order=created_at.asc,id.asc`, { headers });
  expect(res.ok()).toBe(true);
  return res.json();
}
async function resetKids(request: APIRequestContext, headers: Record<string, string>, seed: { display_name: string; birth_year: number }[]) {
  expect((await request.delete(`${MOCK}/rest/v1/child_profiles?id=not.is.null`, { headers })).ok()).toBe(true);
  for (const row of seed) expect((await request.post(`${MOCK}/rest/v1/child_profiles`, { headers, data: { ...row, interests: [] } })).status()).toBe(201);
}

const tabBar = (page: Page) => page.getByRole("navigation", { name: "Điều hướng chính" });
const html = (page: Page) => page.locator("html");
const card = (page: Page, name: string) => page.getByRole("article", { name: `Hồ sơ bé ${name}` });

async function openChildProfiles(page: Page) {
  await tabBar(page).getByRole("button", { name: "Bố mẹ", exact: true }).click();
  await passParentGate(page);
  await page.getByRole("button", { name: /Hồ sơ bé/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Hồ sơ bé" })).toBeVisible();
}

test("thêm bé thứ hai, đổi bé trên Trang chủ → lời chào + nhóm tuổi đổi; tạo truyện gửi đúng hồ sơ; sửa, xoá", async ({ page, context, baseURL, request }) => {
  test.setTimeout(120_000);
  await resetKids(request, KIDS, [{ display_name: "Bông", birth_year: VN_YEAR - 5 }]);
  await signInAsMockFamily(context, baseURL!, { userId: MOCK_KIDS_USER_ID });
  // Tạo truyện (cuối bài): có nhà cung cấp AI, nhưng không tạo thật — chỉ đọc yêu cầu gửi lên.
  await page.route("**/api/system/status", (r) => r.fulfill({ json: { hasStoryProvider: true, hasElevenLabs: false, defaultStoryProvider: "custom" } }));
  let generated: Record<string, unknown> | null = null;
  await page.route("**/api/story/generate", (r) => {
    generated = r.request().postDataJSON();
    return r.fulfill({ status: 422, json: { error: "Không tạo truyện trong ca thử" } });
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Chào bé Bông!" })).toBeVisible();
  await expect(page.getByTestId("child-switch")).toHaveCount(0); // một bé: không có nút đổi
  await expect(html(page)).toHaveAttribute("data-age", "3-5");

  // ── Bố mẹ → Hồ sơ bé → Thêm bé ──
  await tabBar(page).getByRole("button", { name: "Bố mẹ", exact: true }).click();
  await passParentGate(page);
  await expect(page.getByRole("button", { name: /Hồ sơ bé/ })).toContainText("Bông · Mầm · 3–5 tuổi");
  await page.getByRole("button", { name: /Hồ sơ bé/ }).click();
  await expect(card(page, "Bông")).toContainText("Đang nghe");
  await expect(card(page, "Bông")).toContainText("5 tuổi · Mầm · 3–5 tuổi");

  await page.getByRole("button", { name: "Thêm bé", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Thêm bé" })).toBeVisible();
  // Chưa nhập tên → báo lỗi tại chỗ, không gửi
  await page.getByRole("button", { name: "Thêm bé", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Nhập tên gọi của bé" })).toBeVisible();
  await page.getByLabel("Tên gọi", { exact: true }).fill("  Na  ");
  await page.getByLabel("Năm sinh", { exact: true }).selectOption(String(VN_YEAR - 7));
  await expect(page.getByTestId("age-band-summary")).toHaveAttribute("data-band", "6-8");
  await expect(page.getByTestId("age-band-summary")).toContainText("Chồi · 6–8 tuổi");
  await page.getByRole("button", { name: "Khủng long", exact: true }).click();
  await page.getByRole("button", { name: "Vũ trụ", exact: true }).click();
  await page.getByLabel("Sở thích khác").fill("Làm bánh");
  await page.getByRole("button", { name: "Thêm", exact: true }).click();
  await expect(page.getByRole("button", { name: "Làm bánh", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("3/5")).toBeVisible();
  await page.getByRole("button", { name: "Thêm bé", exact: true }).click();

  await expect(card(page, "Na")).toContainText("7 tuổi · Chồi · 6–8 tuổi");
  await expect(card(page, "Na").getByRole("listitem")).toHaveText(["Khủng long", "Vũ trụ", "Làm bánh"]);
  await expect(card(page, "Bông")).toContainText("Đang nghe"); // thêm bé không tự đổi bé đang nghe
  const [bong, na] = await kidsOf(request, KIDS);
  expect(na).toMatchObject({ display_name: "Na", birth_year: VN_YEAR - 7, interests: ["Khủng long", "Vũ trụ", "Làm bánh"] });

  // Chọn Na trên thiết bị này → nhóm tuổi 6–8
  await card(page, "Na").getByRole("button", { name: "Chọn bé này" }).click();
  await expect(card(page, "Na")).toContainText("Đang nghe");
  await expect(html(page)).toHaveAttribute("data-age", "6-8");

  // ── Trang chủ: lời chào là nút đổi bé ──
  await page.getByRole("button", { name: "Quay lại", exact: true }).first().click();
  await tabBar(page).getByRole("button", { name: "Trang chủ" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Chào bé Na!" })).toBeVisible();
  await page.getByTestId("child-switch").click();
  const picker = page.getByRole("dialog", { name: "Ai đang nghe truyện?" });
  await expect(picker).toBeVisible();
  await expect(picker.getByRole("button", { name: /Na/ })).toHaveAttribute("aria-pressed", "true");
  await picker.getByRole("button", { name: /Bông/ }).click();
  await expect(picker).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: "Chào bé Bông!" })).toBeVisible();
  await expect(html(page)).toHaveAttribute("data-age", "3-5");
  // Escape đóng hộp chọn, không đổi bé
  await page.getByTestId("child-switch").click();
  await page.keyboard.press("Escape");
  await expect(picker).toHaveCount(0);
  // Chọn lại Na cho phần tạo truyện
  await page.getByTestId("child-switch").click();
  await picker.getByRole("button", { name: /Na/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Chào bé Na!" })).toBeVisible();
  // Lựa chọn giữ sau khi tải lại trang (lưu trên thiết bị)
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Chào bé Na!" })).toBeVisible();
  // Máy hẹp 360px: tên bé xuống dòng chứ không bị cắt ("Chào bé N…"): mọi dòng chữ nằm trong khung
  await page.setViewportSize({ width: 360, height: 740 });
  const greetingText = page.getByTestId("child-switch").locator("span").first();
  const greetingFit = () =>
    greetingText.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(el);
      const rects = [...range.getClientRects()];
      return {
        lines: new Set(rects.map((r) => Math.round(r.top))).size <= 2,
        // glyph boxes are taller than the 1.1 line height, so a line counts as shown when its middle is inside
        inside: rects.every((r) => r.left >= box.left - 1 && r.right <= box.right + 1 && (r.top + r.bottom) / 2 <= box.bottom),
        noEllipsis: getComputedStyle(el).textOverflow !== "ellipsis" || el.scrollWidth <= el.clientWidth + 1,
      };
    });
  await expect.poll(greetingFit).toEqual({ lines: true, inside: true, noEllipsis: true });
  await page.setViewportSize({ width: 412, height: 839 });

  // ── Tạo truyện: mặc định cho bé đang chọn; đổi sang Bông → gửi hồ sơ + nhóm tuổi của Bông ──
  await tabBar(page).getByRole("button", { name: "Tạo", exact: true }).click();
  await page.getByRole("button", { name: "Tiếp tục", exact: true }).click();
  await page.getByRole("switch", { name: /Bé là nhân vật chính/ }).click();
  const heroPick = page.getByRole("group", { name: "Bé nào là nhân vật chính?" });
  await expect(heroPick.getByRole("button", { name: "Na", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Tên của bé trong truyện")).toHaveCount(0);
  await page.getByRole("button", { name: "Tiếp tục", exact: true }).click();
  // Bước 3: nhóm tuổi theo bé đang chọn (Na 7 tuổi)
  await expect(page.getByRole("button", { name: "6–8 tuổi", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Tiếp tục", exact: true }).click();
  const forChild = page.getByRole("group", { name: "Truyện cho bé" });
  await expect(forChild.getByRole("button", { name: "Na", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Na · 6–8 tuổi")).toBeVisible();
  await forChild.getByRole("button", { name: "Bông", exact: true }).click();
  await expect(page.getByText("Bông · 3–5 tuổi")).toBeVisible(); // đổi bé → đổi cả nhóm tuổi
  await page.getByRole("button", { name: /Tạo truyện cùng Đóm/ }).click();
  await expect.poll(() => generated).not.toBeNull();
  expect(generated).toMatchObject({ childProfileId: bong.id, childName: "Bông", age: "3-5" });
  expect((generated as unknown as { characters: { name: string }[] }).characters[0]).toMatchObject({ name: "Bông" });
  await expect(page.getByText("Không tạo truyện trong ca thử")).toBeVisible();
  // "Bé khác" → tên gõ tay, không gửi hồ sơ
  generated = null;
  await forChild.getByRole("button", { name: "Bé khác", exact: true }).click();
  await page.getByLabel("Tên bé").fill("Tũn");
  await page.getByRole("button", { name: /Tạo truyện cùng Đóm/ }).click();
  await expect.poll(() => generated).not.toBeNull();
  expect(generated).toMatchObject({ childName: "Tũn" });
  expect(generated).not.toHaveProperty("childProfileId");

  // ── Sửa + xoá ──
  await page.goto("/");
  await openChildProfiles(page);
  await card(page, "Na").getByRole("button", { name: "Sửa hồ sơ Na" }).click();
  await expect(page.getByLabel("Tên gọi", { exact: true })).toHaveValue("Na");
  await expect(page.getByLabel("Năm sinh", { exact: true })).toHaveValue(String(VN_YEAR - 7));
  await page.getByLabel("Tên gọi", { exact: true }).fill("Na Na");
  await page.getByRole("button", { name: "Vũ trụ", exact: true }).click(); // bỏ một sở thích
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  await expect(card(page, "Na Na")).toBeVisible();
  expect((await kidsOf(request, KIDS))[1]).toMatchObject({ id: na.id, display_name: "Na Na", interests: ["Khủng long", "Làm bánh"] });

  await card(page, "Na Na").getByRole("button", { name: "Xoá hồ sơ Na Na" }).click();
  await expect(page.getByText("Truyện đã tạo vẫn được giữ trong thư viện.")).toBeVisible();
  await page.getByRole("button", { name: "Huỷ", exact: true }).click();
  await expect(card(page, "Na Na")).toBeVisible();
  await card(page, "Na Na").getByRole("button", { name: "Xoá hồ sơ Na Na" }).click();
  await page.getByRole("button", { name: "Đồng Ý", exact: true }).click();
  await expect(card(page, "Na Na")).toHaveCount(0);
  await expect(card(page, "Bông")).toContainText("Đang nghe"); // bé đang nghe bị xoá → về bé đầu tiên
  expect((await kidsOf(request, KIDS)).map((k) => k.display_name)).toEqual(["Bông"]);
});

test("tối đa 5 bé: nút Thêm bé khoá + máy chủ từ chối bé thứ 6; tên/năm sinh sai bị chặn ở máy chủ", async ({ page, context, baseURL, request }) => {
  await resetKids(
    request,
    KIDS,
    ["Bông", "Na", "Mít", "Tí", "Su"].map((name, i) => ({ display_name: name, birth_year: VN_YEAR - 3 - i })),
  );
  const sixth = await request.post(`${MOCK}/rest/v1/child_profiles`, { headers: KIDS, data: { display_name: "Tèo", birth_year: VN_YEAR - 2 } });
  expect(sixth.status()).toBe(400);
  expect(await sixth.json()).toMatchObject({ message: "child_profile_limit" });
  await signInAsMockFamily(context, baseURL!, { userId: MOCK_KIDS_USER_ID });
  await page.goto("/");
  await openChildProfiles(page);
  await expect(page.getByTestId("child-card")).toHaveCount(5);
  await expect(page.getByRole("button", { name: "Thêm bé", exact: true })).toBeDisabled();
  await expect(page.getByText("Đã đủ 5 hồ sơ bé.")).toBeVisible();

  await resetKids(request, KIDS, [{ display_name: "Bông", birth_year: VN_YEAR - 5 }]);
  const old = await request.post(`${MOCK}/rest/v1/child_profiles`, { headers: KIDS, data: { display_name: "Ông", birth_year: VN_YEAR - 30 } });
  expect(await old.json()).toMatchObject({ message: "invalid_birth_year" });
  const blank = await request.post(`${MOCK}/rest/v1/child_profiles`, { headers: KIDS, data: { display_name: "   " } });
  expect(await blank.json()).toMatchObject({ message: "invalid_child_name" });
});

test("gia đình mới: tên bé lúc đăng ký chỉ thành hồ sơ sau khi bố mẹ đồng ý; chưa có bé → thẻ Thêm hồ sơ bé", async ({ page, context, baseURL, request }) => {
  test.setTimeout(90_000);
  expect((await request.post(`${MOCK}/__e2e/consent-reset`, { data: { sub: MOCK_KIDS_NEW_USER_ID, current: 1, accepted: null } })).ok()).toBe(true);
  await resetKids(request, NEW, []);
  await signInAsMockFamily(context, baseURL!, { userId: MOCK_KIDS_NEW_USER_ID });
  // Màn Đăng ký giữ tên/năm sinh của bé trên thiết bị (kecon-pending-child:<uid>) đến khi có đồng ý.
  await context.addInitScript(
    ([uid, year]) => {
      if (!sessionStorage.getItem("e2e-draft-planted")) {
        localStorage.setItem(`kecon-pending-child:${uid}`, JSON.stringify({ displayName: "Su", birthYear: year }));
        sessionStorage.setItem("e2e-draft-planted", "1");
      }
    },
    [MOCK_KIDS_NEW_USER_ID, VN_YEAR - 2] as const,
  );
  await page.goto("/");
  await expect(page.locator("[data-consent-gate]")).toBeVisible();
  expect(await kidsOf(request, NEW)).toEqual([]); // chưa đồng ý → chưa có gì trên máy chủ

  await page.getByRole("checkbox", { name: /Tôi là bố\/mẹ hoặc người giám hộ/ }).check();
  await page.getByRole("button", { name: "Đồng ý và tiếp tục" }).click();
  await passParentGate(page);
  await expect(page.getByRole("heading", { level: 1, name: "Chào bé Su!" })).toBeVisible();
  await expect.poll(async () => (await kidsOf(request, NEW)).map((k) => [k.display_name, k.birth_year])).toEqual([["Su", VN_YEAR - 2]]);
  expect(await page.evaluate((uid) => localStorage.getItem(`kecon-pending-child:${uid}`), MOCK_KIDS_NEW_USER_ID)).toBeNull();

  // Không còn bé nào → Trang chủ mời thêm hồ sơ bé (qua cổng phụ huynh)
  await resetKids(request, NEW, []);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Chào bé!" })).toBeVisible();
  await page.getByTestId("add-child-card").click();
  await passParentGate(page);
  await expect(page.getByRole("heading", { level: 1, name: "Hồ sơ bé" })).toBeVisible();
  await expect(page.getByText("Chưa có hồ sơ bé nào")).toBeVisible();
});

test("đăng ký: tên + năm sinh của bé không gửi lên máy chủ, chỉ giữ trên thiết bị chờ bố mẹ đồng ý", async ({ page }) => {
  const NEW_UID = "00000000-0000-4000-8000-00000000e2b9";
  let signupBody: { email?: string; data?: Record<string, unknown> } | null = null;
  await page.route("**/auth/v1/signup*", (r) => {
    signupBody = r.request().postDataJSON();
    // Email confirmation on → GoTrue answers with the user only (no session).
    return r.fulfill({
      json: { id: NEW_UID, aud: "authenticated", role: "authenticated", email: "e2e-signup@kecon.test", user_metadata: signupBody?.data ?? {}, identities: [{ id: NEW_UID }], created_at: new Date().toISOString() },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Bỏ qua" }).click();
  await expect(page.getByRole("heading", { name: "Tạo tài khoản" })).toBeVisible();
  await page.locator('input[name="familyName"]').fill("Gia đình Thử");
  await page.locator('input[name="email"]').fill("e2e-signup@kecon.test");
  await page.locator('input[name="password"]').fill("matkhau-e2e-123");
  await page.getByLabel("Tên con").fill("  Su  ");
  await page.getByLabel("Năm sinh của con").selectOption(String(VN_YEAR - 2));
  await page.getByRole("button", { name: "Tạo tài khoản", exact: true }).click();
  await expect(page.getByText("Tài khoản đã tạo!", { exact: false })).toBeVisible();

  expect(signupBody).not.toBeNull();
  const sent = signupBody as unknown as { email: string; data: Record<string, unknown> };
  expect(sent.email).toBe("e2e-signup@kecon.test");
  expect(sent.data).toEqual({ family_name: "Gia đình Thử", display_name: "Gia đình Thử" });
  expect(Object.keys(sent).filter((k) => /child/i.test(k))).toEqual([]);
  const draft = await page.evaluate((uid) => localStorage.getItem(`kecon-pending-child:${uid}`), NEW_UID);
  expect(JSON.parse(draft ?? "null")).toEqual({ displayName: "Su", birthYear: VN_YEAR - 2 });
});
