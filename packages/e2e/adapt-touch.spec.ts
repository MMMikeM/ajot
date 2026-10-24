import { test, expect, type Locator, type Page } from "@playwright/test";
import { mockApi } from "./helpers/mock-api";

// Touch layout of the task list: swipe tray, drag, and the input bar's list chip.

// A production build registers sw.js, which would answer /api before the mocks see it
test.use({ serviceWorkers: "block" });

const openList = async (page: Page) => {
  await mockApi(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-task-id]", { timeout: 15000 });
};

const row = (page: Page, title: string) =>
  page.locator("[data-task-id]", { hasText: title }).first();

// Real touch events: the swipe hook listens for touchmove, which Playwright's touchscreen can't send
const touch = async (page: Page) => {
  const cdp = await page.context().newCDPSession(page);
  const send = (type: "touchStart" | "touchMove" | "touchEnd", x = 0, y = 0) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: type === "touchEnd" ? [] : [{ x, y }],
    });
  return { send };
};

const swipeOpen = async (page: Page, target: Locator) => {
  await target.scrollIntoViewIfNeeded();
  const box = (await target.locator(".group\\/task").first().boundingBox())!;
  const { send } = await touch(page);
  const y = box.y + 20;
  let x = box.x + box.width - 20;
  await send("touchStart", x, y);
  for (let i = 0; i < 12; i++) await send("touchMove", (x -= 20), y);
  await send("touchEnd");
  await expect(target.locator("[inert]")).toHaveCount(0);
};

const expectFullyOnScreen = async (page: Page, cell: Locator) => {
  await expect(cell).toBeVisible();
  const box = (await cell.boundingBox())!;
  const { width } = page.viewportSize()!;
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(width);
  // The label fits its cell rather than overflowing it
  expect(await cell.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
};

test.describe("swipe tray", () => {
  test("your own task's three actions fit on screen", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "the swipe tray is touch-only");
    await openList(page);
    const target = row(page, "Pick up dry cleaning");
    await swipeOpen(page, target);

    for (const name of ["Date", "Subtask", "Delete"])
      await expectFullyOnScreen(page, target.getByRole("button", { name, exact: true }));
  });

  test("someone else's task says whose it is instead of offering delete", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "the swipe tray is touch-only");
    await openList(page);
    const target = row(page, "Pick a restaurant for Friday");
    await swipeOpen(page, target);

    await expect(target.getByRole("button", { name: /^Delete/ })).toHaveCount(0);
    for (const name of ["Date", "Subtask"])
      await expectFullyOnScreen(page, target.getByRole("button", { name, exact: true }));

    const owner = target.locator("p", { hasText: "Sarah's" });
    await expectFullyOnScreen(page, owner);
    await expect(owner).toContainText("Only Sarah Murray can delete it");
  });
});

type Box = { x: number; y: number; width: number; height: number };

const inflate = (b: Box, dx: number, dy: number): Box => ({
  x: b.x - dx,
  y: b.y - dy,
  width: b.width + 2 * dx,
  height: b.height + 2 * dy,
});

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test.describe("dragging", () => {
  test("on touch the grip's hit area stays clear of the checkbox and the date", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "touch layout");
    await openList(page);
    const target = row(page, "Call the plumber");

    const grip = (await target.getByLabel("Drag to reorder").boundingBox())!;
    expect(grip.height).toBeGreaterThanOrEqual(44);
    // boundingBox() leaves out the ::after hit areas: the checkbox's -inset-3, the date's -inset-x-1.5
    const checkbox = inflate((await target.getByRole("checkbox").boundingBox())!, 12, 12);
    const date = inflate(
      (await target.getByRole("button", { name: "Today", exact: true }).boundingBox())!,
      6,
      10,
    );
    expect(overlaps(grip, checkbox)).toBe(false);
    expect(overlaps(grip, date)).toBe(false);
  });

  test("the desktop grip and the checkbox don't overlap", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "the grip shows on desktop");
    await openList(page);
    const target = row(page, "Renew passport");
    await target.hover();

    const grip = (await target.getByLabel("Drag to reorder").boundingBox())!;
    const checkbox = (await target.getByRole("checkbox").boundingBox())!;
    expect(overlaps(grip, checkbox)).toBe(false);
  });

  test("a long press on the grip drags the task", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "long-press is the touch gesture");
    await openList(page);
    const positionOf = async (title: string) =>
      (await page.locator("li > [data-task-id]").allTextContents()).findIndex((t) =>
        t.includes(title),
      );
    expect(await positionOf("Renew passport")).toBeGreaterThan(
      await positionOf("Call the plumber"),
    );

    const from = (await row(page, "Renew passport").getByLabel("Drag to reorder").boundingBox())!;
    const to = (await row(page, "Call the plumber").boundingBox())!;
    const { send } = await touch(page);
    const x = from.x + from.width / 2;
    let y = from.y + from.height / 2;
    await send("touchStart", x, y);
    // Past dnd-kit's 250ms touch delay
    await page.waitForTimeout(400);
    while (y > to.y) {
      await send("touchMove", x, (y -= 8));
      await page.waitForTimeout(16);
    }
    await send("touchEnd");

    await expect
      .poll(
        async () => (await positionOf("Renew passport")) < (await positionOf("Call the plumber")),
      )
      .toBe(true);
  });
});

test("mobile: the input chip says it's where new tasks go", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "the chip is touch-only");
  await openList(page);
  const chip = page.getByTestId("category-input-chip");

  await expect(chip.getByText("Adding to", { exact: true })).toBeVisible();
  await expect(chip).toContainText("Inbox");
});
