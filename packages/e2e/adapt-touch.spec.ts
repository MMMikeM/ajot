import { test, expect, type Locator, type Page, type TestInfo } from "@playwright/test";
import { dueLabel, mockApi, mockData } from "./helpers/mock-api";
import { expectTapTarget } from "./helpers/touch";

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
  // Measured once the tray has snapped into place, not partway past the row's end
  await expect
    .poll(() => target.locator("[data-swipe-tray]").evaluate((el) => el.getAnimations().length))
    .toBe(0);
};

// boundingBox() ignores an ancestor's overflow clip, which once hid the tray's right edge
const isClippedByAncestor = (el: Element) => {
  const box = el.getBoundingClientRect();
  for (let a = el.parentElement; a; a = a.parentElement) {
    if (getComputedStyle(a).overflowX === "visible") continue;
    const clip = a.getBoundingClientRect();
    if (box.left < clip.left || box.right > clip.right) return true;
  }
  return false;
};

const expectFullyOnScreen = async (page: Page, cell: Locator) => {
  await expect(cell).toBeVisible();
  const box = (await cell.boundingBox())!;
  const { width } = page.viewportSize()!;
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(width);
  expect(await cell.evaluate(isClippedByAncestor)).toBe(false);
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

  test("someone else's task offers no delete, and the tray shrinks to fit", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "the swipe tray is touch-only");
    await openList(page);
    const target = row(page, "Pick a restaurant for Friday");
    await swipeOpen(page, target);

    await expect(target.getByRole("button", { name: /^Delete/ })).toHaveCount(0);
    for (const name of ["Date", "Subtask"])
      await expectFullyOnScreen(page, target.getByRole("button", { name, exact: true }));
  });

  test("the open tray covers the row's end, leaving the start of the title in view", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "the swipe tray is touch-only");
    await openList(page);
    for (const title of ["Pick up dry cleaning", "Book flights"]) {
      const target = row(page, title);
      await swipeOpen(page, target);
      const titleBox = (await titleOf(page, title).boundingBox())!;
      const trayBox = (await target.locator("[data-swipe-tray]").boundingBox())!;
      expect(titleBox.x).toBeGreaterThanOrEqual(0);
      expect(trayBox.x - titleBox.x).toBeGreaterThanOrEqual(96);
      // The title's start still takes a tap, and the tray is drawn over the row's end
      const reaches = (locator: Locator, x: number, y: number) =>
        locator.evaluate((el, at) => el.contains(document.elementFromPoint(at.x, at.y)), { x, y });
      const y = titleBox.y + 12;
      expect(await reaches(titleOf(page, title), (titleBox.x + trayBox.x) / 2, y)).toBe(true);
      const date = target.getByRole("button", { name: "Date", exact: true });
      const dateBox = (await date.boundingBox())!;
      expect(
        await reaches(date, dateBox.x + dateBox.width / 2, dateBox.y + dateBox.height / 2),
      ).toBe(true);
    }
  });
});

const openSheet = async (page: Page, title: string) => {
  await titleOf(page, title).click();
  const sheet = page.locator('[data-slot="drawer-content"]');
  await expect(sheet).toBeVisible();
  // Measured once the sheet has slid in
  await expect
    .poll(async () => sheet.evaluate((el) => getComputedStyle(el).transform))
    .toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);
  return sheet;
};

const search = async (page: Page, query: string) => {
  await page.goto("/search", { waitUntil: "domcontentloaded" });
  const field = page.getByRole("searchbox", { name: "Search every list" });
  await field.fill(query);
  await field.blur();
  const results = page.locator("main [data-task-id]");
  await expect(results.first()).toBeVisible();
  return results;
};

test("a task's checkbox and date, and the detail sheet's checkboxes, take a 44px tap", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "the touch targets");
  await openList(page);
  const passport = row(page, "Renew passport");
  await expectTapTarget(passport.getByRole("checkbox"));
  await expectTapTarget(
    passport.getByRole("button", { name: `${await dueLabel(page, -3)}, overdue` }),
  );

  const sheet = await openSheet(page, "Book flights");
  const checkboxes = sheet.getByRole("checkbox");
  await expect(checkboxes).toHaveCount(3);
  for (const checkbox of await checkboxes.all()) await expectTapTarget(checkbox);
});

test("the detail sheet's header and add lines take a 44px tap", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "the touch targets");
  await openList(page);
  const sheet = await openSheet(page, "Pick up dry cleaning");
  await expectTapTarget(sheet.getByRole("combobox", { name: "List" }));
  await expectTapTarget(sheet.getByRole("button", { name: "Delete task" }));
  for (const line of ["Add a date", "Share", "Add a subtask", "Add a note"])
    await expectTapTarget(sheet.getByRole("button", { name: line, exact: true }));
});

test("a search result's checkbox takes a 44px tap, a subtask's too", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "the touch targets");
  await mockApi(page);
  // A subtask and its parent, then tasks from two lists
  for (const query of ["fares", "passport"]) {
    const checkboxes = (await search(page, query)).getByRole("checkbox");
    for (const checkbox of await checkboxes.all()) await expectTapTarget(checkbox);
  }
});

// Where a tap or click on the first letter of `text` lands: its first line, half a pixel in
const firstLetterOf = (text: Locator) =>
  text.evaluate((el) => {
    if (el instanceof HTMLTextAreaElement) {
      const box = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return {
        x: box.left + parseFloat(style.paddingLeft) + 0.5,
        y: box.top + parseFloat(style.paddingTop) + parseFloat(style.lineHeight) / 2,
      };
    }
    const first = document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode()!;
    const range = document.createRange();
    range.setStart(first, 0);
    range.setEnd(first, 1);
    const box = range.getBoundingClientRect();
    return { x: box.left + 0.5, y: box.top + box.height / 2 };
  });

// Where the checkbox's target is drawn over the text, it takes a press on the text
const firstLetterBeside = async (checkbox: Locator, text: Locator) => {
  await text.scrollIntoViewIfNeeded();
  const at = await firstLetterOf(text);
  expect(
    await checkbox.evaluate((el, { x, y }) => el.contains(document.elementFromPoint(x, y)), at),
  ).toBe(false);
  return at;
};

const press = (page: Page, testInfo: TestInfo, { x, y }: Point) =>
  testInfo.project.name === "mobile" ? page.touchscreen.tap(x, y) : page.mouse.click(x, y);

const pressFirstLetter = async (page: Page, testInfo: TestInfo, text: Locator, checkbox: Locator) =>
  press(page, testInfo, await firstLetterBeside(checkbox, text));

test.describe("a press on the first letter of text beside a checkbox", () => {
  test("a task's or a subtask's title opens it rather than ticking it", async ({
    page,
  }, testInfo) => {
    await openList(page);
    for (const title of ["Renew passport", "Compare Tuesday and Wednesday fares"]) {
      const checkbox = page.getByRole("checkbox", { name: title, exact: true });
      await pressFirstLetter(
        page,
        testInfo,
        titleOf(page, title).locator("span").first(),
        checkbox,
      );
      await expect(page.locator('[data-slot="drawer-content"]')).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.locator('[data-slot="drawer-content"]')).toHaveCount(0);
      await expect(checkbox).not.toBeChecked();
    }
  });

  test("a search result's title opens it rather than ticking it", async ({ page }, testInfo) => {
    await mockApi(page);
    for (const [query, title] of [
      ["fares", "Compare Tuesday and Wednesday fares"],
      ["passport", "Renew passport"],
    ] as const) {
      const result = (await search(page, query)).filter({ hasText: title }).first();
      const checkbox = result.getByRole("checkbox", { name: title, exact: true });
      await pressFirstLetter(
        page,
        testInfo,
        result.locator("[data-search-result] span").first(),
        checkbox,
      );
      await expect(page.locator('[data-slot="drawer-content"]')).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.locator('[data-slot="drawer-content"]')).toHaveCount(0);
      await expect(checkbox).not.toBeChecked();
    }
  });

  test("the detail sheet's title takes the focus rather than ticking the task", async ({
    page,
  }, testInfo) => {
    await openList(page);
    const sheet = await openSheet(page, "Book flights");
    const title = sheet.getByRole("textbox", { name: "Title" });
    const done = sheet.getByRole("checkbox", { name: "Mark done" });
    await pressFirstLetter(page, testInfo, title, done);
    await expect(title).toBeFocused();
    await expect(done).not.toBeChecked();
  });

  test("the detail sheet's subtask title edits it rather than ticking it", async ({
    page,
  }, testInfo) => {
    await openList(page);
    const sheet = await openSheet(page, "Book flights");
    const subtask = "Compare Tuesday and Wednesday fares";
    const checkbox = sheet.getByRole("checkbox", { name: subtask, exact: true });
    await pressFirstLetter(page, testInfo, sheet.getByText(subtask, { exact: true }), checkbox);
    await expect(sheet.getByRole("textbox", { name: "Subtask" })).toBeFocused();
    await expect(checkbox).not.toBeChecked();
  });
});

test("People's empty state isn't clipped", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "the touch layout scrolls the page itself");
  const data = mockData();
  data.contacts = [];
  await mockApi(page, { data });
  await page.goto("/people", { waitUntil: "domcontentloaded" });
  const empty = page.getByText(/^No contacts yet/);
  await expect(empty).toBeVisible();
  const invite = (await page.getByRole("button", { name: "Invite someone" }).boundingBox())!;
  const text = (await empty.boundingBox())!;
  expect(text.x).toBe(invite.x);
  const scroller = empty.locator("..");
  expect(await scroller.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
});

type Point = { x: number; y: number };

const centreOf = async (locator: Locator): Promise<Point> => {
  const b = (await locator.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};

const titleOf = (page: Page, title: string) =>
  row(page, title).getByRole("button", { name: title }).first();

const isAbove = async (page: Page, above: string, below: string) => {
  const order = await page.locator("li > [data-task-id]").allTextContents();
  return order.findIndex((t) => t.includes(above)) < order.findIndex((t) => t.includes(below));
};

const mockIdOf = (title: string) => mockData().tasks.find((t) => t.title.startsWith(title))!.id;
const FLIGHTS = mockIdOf("Book flights");
const FARES = mockIdOf("Compare Tuesday");
const BAGGAGE = "t-baggage";
const byId = (page: Page, id: string) => page.locator(`[data-task-id="${id}"]`);
const subtaskOrder = (page: Page) =>
  byId(page, FLIGHTS)
    .locator("[data-task-id]")
    .evaluateAll((rows) => rows.map((r) => r.getAttribute("data-task-id")));

// The mock's flights task has one open subtask; reordering needs two
const withSecondSubtask = () => {
  const data = mockData();
  const fares = data.tasks.find((t) => t.id === FARES)!;
  data.tasks.push({
    ...fares,
    id: BAGGAGE,
    title: "Check the baggage allowance",
    sortOrder: "a0z",
  });
  return data;
};

// Holds past dnd-kit's 250ms touch delay, then moves in small steps, as a finger would
const longPressDrag = async (page: Page, from: Point, to: Point) => {
  const { send } = await touch(page);
  await send("touchStart", from.x, from.y);
  await page.waitForTimeout(400);
  const steps = Math.ceil(Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y)) / 8);
  for (let i = 1; i <= steps; i++) {
    await send(
      "touchMove",
      from.x + ((to.x - from.x) * i) / steps,
      from.y + ((to.y - from.y) * i) / steps,
    );
    await page.waitForTimeout(16);
  }
  await send("touchEnd");
};

test.describe("dragging on touch", () => {
  // eslint-disable-next-line no-empty-pattern
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "long press is the touch gesture");
  });

  test("a long press anywhere on a task drags it", async ({ page }) => {
    await openList(page);
    expect(await isAbove(page, "Call the plumber", "Renew passport")).toBe(true);

    const to = (await row(page, "Call the plumber").boundingBox())!;
    await longPressDrag(page, await centreOf(titleOf(page, "Renew passport")), {
      x: to.x + to.width / 2,
      y: to.y,
    });

    await expect.poll(() => isAbove(page, "Renew passport", "Call the plumber")).toBe(true);
  });

  test("a tap still opens the task", async ({ page }) => {
    await openList(page);
    await titleOf(page, "Renew passport").tap();
    await expect(page.locator('[data-slot="drawer-content"]')).toBeVisible();
  });

  test("a long press let go in place neither opens nor moves the task", async ({ page }) => {
    await openList(page);
    const { send } = await touch(page);
    const at = await centreOf(titleOf(page, "Renew passport"));
    await send("touchStart", at.x, at.y);
    await page.waitForTimeout(400);
    await send("touchEnd");

    await page.waitForTimeout(300);
    await expect(page.locator('[data-slot="drawer-content"]')).toHaveCount(0);
    expect(await isAbove(page, "Call the plumber", "Renew passport")).toBe(true);
  });

  test("a quick flick doesn't drag", async ({ page }) => {
    await openList(page);
    const { send } = await touch(page);
    const at = await centreOf(titleOf(page, "Renew passport"));
    await send("touchStart", at.x, at.y);
    for (let i = 1; i <= 10; i++) await send("touchMove", at.x, at.y - i * 12);
    await send("touchEnd");

    await page.waitForTimeout(300);
    expect(await isAbove(page, "Call the plumber", "Renew passport")).toBe(true);
  });

  test("a sideways drag moves the task without opening its swipe tray", async ({ page }) => {
    await openList(page);
    const to = (await row(page, "Call the plumber").boundingBox())!;
    const from = await centreOf(titleOf(page, "Renew passport"));
    await longPressDrag(page, from, { x: from.x - 120, y: to.y });

    await expect.poll(() => isAbove(page, "Renew passport", "Call the plumber")).toBe(true);
    await expect(row(page, "Renew passport").locator("[data-swipe-tray]")).toHaveAttribute("inert");
  });

  test("a long press drags a subtask within its parent", async ({ page }) => {
    await mockApi(page, { data: withSecondSubtask() });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(byId(page, BAGGAGE)).toBeVisible({ timeout: 15000 });
    expect(await subtaskOrder(page)).toEqual([FARES, BAGGAGE]);

    const to = (await byId(page, FARES).boundingBox())!;
    await longPressDrag(page, await centreOf(byId(page, BAGGAGE)), {
      x: to.x + to.width / 2,
      y: to.y,
    });

    await expect.poll(() => subtaskOrder(page)).toEqual([BAGGAGE, FARES]);
  });

  test("a subtask dragged among the tasks stays under its parent", async ({ page }) => {
    await mockApi(page, { data: withSecondSubtask() });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(byId(page, BAGGAGE)).toBeVisible({ timeout: 15000 });

    await longPressDrag(
      page,
      await centreOf(byId(page, FARES)),
      await centreOf(row(page, "Renew passport")),
    );

    // On its way out it passes its sibling, which may swap them; it just mustn't leave
    await page.waitForTimeout(300);
    expect(new Set(await subtaskOrder(page))).toEqual(new Set([FARES, BAGGAGE]));
    await expect(page.locator(`li > [data-task-id="${FARES}"]`)).toHaveCount(0);
  });
});

// Presses and moves in small steps; dnd-kit picks the row up once it has moved 5px
const mouseDrag = async (page: Page, from: Point, to: Point) => {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
};

test.describe("dragging with a mouse", () => {
  // eslint-disable-next-line no-empty-pattern
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "mouse gestures");
  });

  test("dragging a task's row moves it", async ({ page }) => {
    await openList(page);
    const to = (await row(page, "Call the plumber").boundingBox())!;
    await mouseDrag(page, await centreOf(titleOf(page, "Renew passport")), {
      x: to.x + to.width / 2,
      y: to.y,
    });

    await expect.poll(() => isAbove(page, "Renew passport", "Call the plumber")).toBe(true);
  });

  test("a click still opens the task", async ({ page }) => {
    await openList(page);
    await titleOf(page, "Renew passport").click();
    await expect(page.locator('[data-slot="drawer-content"]')).toBeVisible();
    expect(await isAbove(page, "Call the plumber", "Renew passport")).toBe(true);
  });

  test("dragging a subtask moves it within its parent", async ({ page }) => {
    await mockApi(page, { data: withSecondSubtask() });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(byId(page, BAGGAGE)).toBeVisible({ timeout: 15000 });

    const to = (await byId(page, FARES).boundingBox())!;
    await mouseDrag(page, await centreOf(byId(page, BAGGAGE)), {
      x: to.x + to.width / 2,
      y: to.y,
    });

    await expect.poll(() => subtaskOrder(page)).toEqual([BAGGAGE, FARES]);
  });
});
