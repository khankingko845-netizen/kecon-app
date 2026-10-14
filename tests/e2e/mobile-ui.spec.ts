import { expect, test, type Page } from "@playwright/test";
import { passParentGate, signInAsMockFamily, MOCK_PIN, MOCK_PIN_USER_ID } from "./support/fixtures";
import { sideOverflow } from "./support/layout";

// Mobile UI guard at the smallest common phone (360×640): on every main kid and
// parent screen there is no sideways scrolling, every control has a name a
// screen reader can announce, every tap target is at least 44×44 px and text is
// at least 12 px. Offenders are listed in the failure message.
test.use({ viewport: { width: 360, height: 640 } });

type Audit = { unnamed: string[]; small: string[]; tiny: string[] };

async function audit(page: Page): Promise<Audit> {
  await page.waitForTimeout(400); // let entrance transitions settle
  return page.evaluate(() => {
    const visible = (el: Element) => {
      const b = el.getBoundingClientRect();
      if (b.width <= 1 || b.height <= 1) return false; // sr-only file inputs, collapsed nodes
      if (el.closest("[aria-hidden=true], [inert]")) return false;
      // Content of a closed <details> is not shown, but Chromium still measures it.
      const details = el.closest("details");
      if (details && !details.open && !el.closest("summary")) return false;
      const s = getComputedStyle(el);
      return s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0;
    };
    const text = (el: Element | null) => (el ? ((el as HTMLElement).innerText || el.textContent || "").replace(/\s+/g, " ").trim() : "");
    const nameOf = (el: Element) => {
      const aria = el.getAttribute("aria-label")?.trim();
      if (aria) return aria;
      const by = el.getAttribute("aria-labelledby");
      if (by) return by.split(/\s+/).map((id) => text(document.getElementById(id))).join(" ").trim();
      if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
        const fromLabel = Array.from(el.labels ?? []).map((l) => text(l)).join(" ").trim();
        return fromLabel || el.getAttribute("placeholder")?.trim() || el.getAttribute("title")?.trim() || "";
      }
      const imgAlt = Array.from(el.querySelectorAll("img[alt]")).map((i) => i.getAttribute("alt")).join(" ").trim();
      return text(el) || el.getAttribute("title")?.trim() || imgAlt;
    };
    const describe = (el: Element) => `${el.tagName.toLowerCase()} "${nameOf(el).slice(0, 40)}"`;

    const unnamed: string[] = [];
    const small: string[] = [];
    const controls = document.querySelectorAll(
      "button, a[href], [role=button], [role=switch], [role=tab], [role=checkbox], [role=radio], select, input:not([type=hidden]), textarea",
    );
    for (const el of Array.from(controls)) {
      if (!visible(el)) continue;
      if (!nameOf(el)) unnamed.push(describe(el));
      const input = el instanceof HTMLInputElement ? el : null;
      if (input?.type === "range") continue; // sliders: the track is the target
      // A checkbox or radio inside a label is tapped through the label.
      const target = input && (input.type === "checkbox" || input.type === "radio") && input.closest("label") ? input.closest("label")! : el;
      const b = target.getBoundingClientRect();
      if (b.width < 44 - 0.5 || b.height < 44 - 0.5) small.push(`${Math.round(b.width)}×${Math.round(b.height)} ${describe(el)}`);
    }

    const tiny: string[] = [];
    for (const el of Array.from(document.body.querySelectorAll("*"))) {
      if (!visible(el)) continue;
      const own = Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim());
      if (!own) continue;
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (size < 12) tiny.push(`${size}px "${text(el).slice(0, 40)}"`);
    }
    return { unnamed, small, tiny: Array.from(new Set(tiny)) };
  });
}

async function expectMobileFriendly(page: Page, screen: string) {
  const r = await audit(page);
  const side = await sideOverflow(page); // layout viewport, not innerWidth (see support/layout.ts)
  // Soft: one run lists every offender on every screen instead of stopping at the first.
  expect.soft(side.overflow, `${screen}: cuộn ngang ${side.offenders.join(" | ")}`).toBeLessThanOrEqual(1);
  expect.soft(r.unnamed, `${screen}: nút không có tên`).toEqual([]);
  expect.soft(r.small, `${screen}: vùng bấm nhỏ hơn 44×44`).toEqual([]);
  expect.soft(r.tiny, `${screen}: chữ nhỏ hơn 12px`).toEqual([]);
}

const tabBar = (page: Page) => page.getByRole("navigation", { name: "Điều hướng chính" });

test("màn của bé dùng tốt ở 360×640", async ({ page, context, baseURL }) => {
  await signInAsMockFamily(context, baseURL!);
  await page.goto("/");
  await page.getByTestId("home-topics").waitFor();
  await expectMobileFriendly(page, "Trang chủ");
  for (const [tab, screen] of [["Thư viện", "Thư viện"], ["Giọng đọc", "Giọng đọc"], ["Tạo", "Tạo truyện"]] as const) {
    await tabBar(page).getByRole("button", { name: tab, exact: true }).click();
    await page.waitForTimeout(800);
    await expectMobileFriendly(page, screen);
  }
  // The Create wizard hides the tab bar; start again from Home.
  await page.goto("/");
  await page.getByTestId("home-topics").waitFor();
  await page.getByTestId("week-sky-chip").click();
  await expect(page.getByRole("heading", { name: "Bầu trời của Đóm", level: 1 })).toBeVisible();
  await expectMobileFriendly(page, "Bầu trời của Đóm");
});

test("màn của bố mẹ dùng tốt ở 360×640", async ({ page, context, baseURL }) => {
  test.setTimeout(90_000);
  await signInAsMockFamily(context, baseURL!, { userId: MOCK_PIN_USER_ID });
  await page.goto("/");
  await page.getByTestId("home-topics").waitFor();
  await tabBar(page).getByRole("button", { name: "Bố mẹ", exact: true }).click();
  await passParentGate(page, MOCK_PIN);
  await expect(page.getByRole("button", { name: /Thống kê của bé/ })).toBeVisible();
  await expectMobileFriendly(page, "Bố mẹ");
  for (const row of ["Tuần của bé", "Hồ sơ gia đình", "Kiểm soát phụ huynh", "Thống kê của bé", "Thông báo", "Gói cước"]) {
    await page.getByRole("button", { name: new RegExp(row) }).first().click();
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await expectMobileFriendly(page, row);
    await page.getByRole("button", { name: "Quay lại", exact: true }).first().click();
    await expect(page.getByRole("button", { name: /Thống kê của bé/ })).toBeVisible();
  }
});

test("player: tên truyện là tiêu đề, giọng và chủ đề nằm trên một dòng", async ({ page, context, baseURL }) => {
  await signInAsMockFamily(context, baseURL!);
  await page.goto("/");
  await page.getByText("Sóc Nhỏ tìm hạt dẻ").first().click();
  await expect(page.getByTestId("story-book")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Sóc Nhỏ tìm hạt dẻ" })).toBeVisible();
  await expectMobileFriendly(page, "Player");
  const meta = page.getByTestId("player-meta");
  const voice = meta.getByRole("button", { name: /^Giọng:/ });
  // A long voice name truncates instead of pushing the topic to a second line.
  await voice.locator("span").first().evaluate((el) => (el.textContent = "Giọng: Giọng của bà ngoại kể chuyện cổ tích thật dài"));
  const box = await meta.boundingBox();
  expect(box!.height).toBeLessThanOrEqual(44);
  const last = meta.locator(":scope > span").last();
  if (await last.count()) await expect(last).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole("button", { name: /Thích truyện|Bỏ thích/ })).toHaveCSS("width", "44px");
});

test("đo cuộn ngang theo layout viewport: một khối quá rộng bị bắt và chỉ đích danh", async ({ page, context, baseURL }) => {
  await signInAsMockFamily(context, baseURL!);
  await page.goto("/");
  await page.getByTestId("home-topics").waitFor();
  expect((await sideOverflow(page)).overflow).toBeLessThanOrEqual(1);
  // Regression guard for the measurement itself: with mobile emulation the old
  // `scrollWidth <= innerWidth` check passed even when content overflowed.
  await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.dataset.testid = "wide-probe";
    probe.style.cssText = "width:420px;height:8px";
    document.body.appendChild(probe);
  });
  const side = await sideOverflow(page);
  expect(side.overflow).toBeGreaterThan(1);
  expect(side.offenders.join(" ")).toContain("wide-probe");
});

test("màn phụ của bé dùng tốt ở 360×640: Khám phá thêm, ghi giọng, tuỳ chọn truyện, Ru ngủ", async ({ page, context, baseURL }) => {
  test.setTimeout(120_000);
  await signInAsMockFamily(context, baseURL!);
  const openExplore = async (label: string) => {
    await page.goto("/");
    const explore = page.getByTestId("home-explore");
    // Flag-gated items appear once feature flags load; wait for the one we need.
    await explore.getByRole("button", { name: label }).click();
    await expect(explore).toHaveCount(0);
    await page.waitForTimeout(600);
    await expectMobileFriendly(page, label);
    if (process.env.MOBILE_QA) await page.screenshot({ path: `/data/g59/${label.replace(/\s+/g, "-")}-360.png` });
  };
  // The mock child is 4 (band 3–5): Khám phá thêm shows only these three.
  for (const label of ["Yêu thích", "Vẽ truyện", "Chụp sách"]) await openExplore(label);
  // Band 6–8 shows every item: serve the same profile with child_age 7.
  await page.route("**/rest/v1/profiles*", async (route) => {
    const res = await route.fetch();
    const body: unknown = await res.json().catch(() => null);
    const older = (p: unknown) => (p && typeof p === "object" ? { ...p, child_age: 7 } : p);
    await route.fulfill({ response: res, json: Array.isArray(body) ? body.map(older) : older(body) });
  });
  await openExplore("Bộ sưu tập");
  await page.unroute("**/rest/v1/profiles*");

  await page.goto("/");
  await page.getByTestId("home-topics").waitFor();
  await tabBar(page).getByRole("button", { name: "Giọng đọc", exact: true }).click();
  await page.getByRole("button", { name: /Ghi giọng bố mẹ/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Ghi giọng bố mẹ" })).toBeVisible();
  await expectMobileFriendly(page, "Ghi giọng bố mẹ");

  await page.goto("/");
  await page.getByText("Sóc Nhỏ tìm hạt dẻ").first().click();
  await expect(page.getByTestId("story-book")).toBeVisible();
  await page.getByRole("button", { name: "Thêm tuỳ chọn", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Tuỳ chọn truyện" });
  await expect(sheet).toBeVisible();
  await expectMobileFriendly(page, "Tuỳ chọn truyện");
  await sheet.getByRole("button", { name: /Ru ngủ/ }).click();
  await expect(page.getByRole("heading", { name: "Ru ngủ cùng Đóm" })).toBeVisible();
  await expectMobileFriendly(page, "Ru ngủ");
});

test("màn chưa đăng nhập dùng tốt ở 360×640: giới thiệu, đăng nhập, tạo tài khoản", async ({ page }) => {
  // Short phones: the main button, “Đăng nhập” and “Bỏ qua” are on screen without scrolling.
  const allOnScreen = async (label: string, main: RegExp) => {
    expect.soft(await page.evaluate(() => window.scrollY), `${label}: trang đã bị cuộn`).toBe(0);
    for (const button of [page.getByRole("button", { name: main }), page.getByRole("button", { name: "Đăng nhập", exact: true }), page.getByRole("button", { name: "Bỏ qua" })])
      await expect.soft(button, `${label}: phải cuộn mới thấy nút`).toBeInViewport({ ratio: 1 });
    if (process.env.MOBILE_QA) await page.screenshot({ path: `/data/g59/${label.replace(/\s+/g, "-")}-360.png` });
  };
  await page.goto("/");
  const start = page.getByRole("button", { name: /Bắt đầu nào!/ });
  await start.waitFor();
  await expectMobileFriendly(page, "Giới thiệu 1");
  await allOnScreen("Giới thiệu 1", /Bắt đầu nào!/);
  await start.click();
  await expect(page.getByRole("heading", { level: 1, name: /Nghe truyện bằng giọng bố mẹ/ })).toBeVisible();
  await expectMobileFriendly(page, "Giới thiệu 2");
  await allOnScreen("Giới thiệu 2", /Tiếp tục/);
  await page.getByRole("button", { name: /Tiếp tục/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: /An toàn, không quảng cáo/ })).toBeVisible();
  await expectMobileFriendly(page, "Giới thiệu 3");
  await allOnScreen("Giới thiệu 3", /Tạo tài khoản cho bé/);
  // Before this fix the intro needed ~850 px: only 390×844 and taller showed “Đăng nhập”.
  for (const size of [{ width: 360, height: 740 }, { width: 390, height: 664 }, { width: 390, height: 750 }]) {
    await page.setViewportSize(size);
    await page.goto("/");
    const at = `${size.width}×${size.height}`;
    await allOnScreen(`Giới thiệu 1 ${at}`, /Bắt đầu nào!/);
    await page.getByRole("button", { name: /Bắt đầu nào!/ }).click();
    await allOnScreen(`Giới thiệu 2 ${at}`, /Tiếp tục/);
    await page.getByRole("button", { name: /Tiếp tục/ }).click();
    await allOnScreen(`Giới thiệu 3 ${at}`, /Tạo tài khoản cho bé/);
  }
  await page.setViewportSize({ width: 360, height: 640 });
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(page.getByPlaceholder("name@email.com")).toBeVisible();
  await expectMobileFriendly(page, "Đăng nhập");
  if (process.env.MOBILE_QA) await page.screenshot({ path: "/data/g59/Dang-nhap-360.png" });

  await page.goto("/");
  await page.getByRole("button", { name: "Bỏ qua" }).click();
  await expect(page.getByRole("heading", { name: "Tạo tài khoản" })).toBeVisible();
  await expectMobileFriendly(page, "Tạo tài khoản");
});

test("màn mới mở từ đầu trang, Quay lại về đúng chỗ đang xem, không lệch ngang khi chuyển màn", async ({ page, context, baseURL }) => {
  await signInAsMockFamily(context, baseURL!);
  await page.goto("/");
  await page.getByTestId("home-topics").waitFor();
  // A long library/settings page in real families: make every screen tall so an
  // inherited offset cannot hide behind a short mock screen.
  await page.addStyleTag({ content: "#main-content { min-height: 2400px; }" });
  const explore = page.getByTestId("home-explore");
  await explore.scrollIntoViewIfNeeded();
  const y = await page.evaluate(() => window.scrollY);
  expect(y).toBeGreaterThan(200);

  // Sample sideways overflow every frame while the next screen slides in.
  const during = page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        let worst = 0;
        const t0 = performance.now();
        const tick = () => {
          worst = Math.max(worst, document.documentElement.scrollWidth - document.documentElement.clientWidth);
          if (performance.now() - t0 < 450) requestAnimationFrame(tick);
          else resolve(worst);
        };
        tick();
      }),
  );
  await explore.getByRole("button", { name: "Vẽ truyện" }).click();
  await expect(page.getByRole("group", { name: "Màu bút" })).toBeVisible();
  expect(await during, "cuộn ngang trong lúc màn trượt vào").toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => window.scrollY), "Vẽ truyện mở giữa trang").toBe(0);

  await page.getByRole("button", { name: "Quay lại", exact: true }).click();
  await expect(page.getByTestId("home-explore")).toBeInViewport();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(y - 3);
  expect(await page.evaluate(() => window.scrollY)).toBeLessThan(y + 3);

  await tabBar(page).getByRole("button", { name: "Thư viện", exact: true }).click();
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.scrollY), "Thư viện mở giữa trang").toBe(0);
});
