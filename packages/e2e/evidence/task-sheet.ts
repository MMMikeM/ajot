// Before/after evidence for the task sheet's rows and actions and the language of Delete. Run once
// per version of the app:
//   npx tsx evidence/task-sheet.ts --url http://localhost:5311 --out .evidence/task-sheet/before
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium, devices, type Browser, type Page } from "@playwright/test";
import { addField, startsWith, taskRow } from "../helpers/app";
import { mockApi, mockData } from "../helpers/mock-api";
import { startEventStream } from "../helpers/event-stream";

const arg = (name: string) => {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) throw new Error(`missing --${name}`);
  return process.argv[index + 1];
};
const BASE_URL = arg("url");
const OUT = arg("out");
mkdirSync(OUT, { recursive: true });

// The iPhone 14 preset defaults to WebKit; Chromium is what's installed, and it gives a coarse pointer
const { defaultBrowserType: _, ...phone } = devices["iPhone 14"];
const narrowPhone = {
  ...phone,
  viewport: { width: 320, height: 568 },
  screen: { width: 320, height: 568 },
};
const desktop = { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } };

const stream = await startEventStream();

const TIMESTAMP = "2026-09-20T09:00:00.000Z";

const data = () => {
  const d = mockData();
  const flights = d.tasks[0];
  const note = (id: string, content: string) => ({
    id,
    userId: "u-mike",
    title: null,
    content,
    taskId: flights.id,
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
  });
  d.notes = [
    note("n-1", "Window seat if possible"),
    note(
      "n-2",
      "Check the luggage allowance on the cheap fare: last time the 23kg bag cost more than the seat itself.",
    ),
  ];
  const packing = {
    ...d.tasks[6],
    id: "t-pack",
    title: "Pack for the trip",
    status: "done",
    sortOrder: "b0",
  };
  const charger = {
    ...d.tasks[6],
    id: "t-charger",
    title: "Phone charger",
    status: "done",
    parentId: "t-pack",
    sortOrder: "b1",
  };
  d.tasks.push(packing, charger);
  const extra = ["Garden", "Reading", "Errands", "Birthday party"].map((name, i) => ({
    ...d.categories[0],
    id: `c-extra-${i}`,
    name,
    color: null,
    sortOrder: `a${3 + i}`,
    collaborators: [],
  }));
  // Uncoloured, so the picker shows ghost dots beside coloured ones
  d.categories.push(...(extra as unknown as typeof d.categories));
  return d;
};

const shot = (page: Page, name: string) =>
  page.screenshot({
    path: `${OUT}/${name}.png`,
    ...(name.startsWith("desktop") && { clip: { x: 360, y: 0, width: 720, height: 900 } }),
  });

const sheet = (page: Page) => page.locator('[data-slot="drawer-content"]');

const fresh = async (
  browser: Browser,
  device: typeof phone,
  run: (page: Page) => Promise<void>,
) => {
  const context = await browser.newContext({
    ...device,
    colorScheme: "dark",
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  await mockApi(page, { data: data() });
  await stream.holdOpen(page);
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-task-id]", { timeout: 15000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(900);
  await run(page);
  await context.close();
};

const openTask = async (page: Page, title: string) => {
  await taskRow(page, title).scrollIntoViewIfNeeded();
  await taskRow(page, title)
    .getByRole("button", { name: startsWith(title) })
    .first()
    .click();
  await page.waitForTimeout(800);
};

const scrollSheet = (page: Page, to: "top" | "bottom") =>
  sheet(page)
    .locator(".overflow-y-auto")
    .first()
    .evaluate((el, to) => {
      el.scrollTop = to === "top" ? 0 : el.scrollHeight;
    }, to);

const openAdd = async (page: Page) => {
  await sheet(page)
    .getByRole("button", { name: /^(Add|Close)$/, expanded: false })
    .click();
  await page.waitForTimeout(400);
};

// A real touch swipe through CDP, so the app's own swipe handling runs
const swipe = async (page: Page, title: string) => {
  await taskRow(page, title).scrollIntoViewIfNeeded();
  const box = (await taskRow(page, title).boundingBox())!;
  const y = box.y + 20;
  const client = await page.context().newCDPSession(page);
  const touch = (type: "touchStart" | "touchMove" | "touchEnd", x: number) =>
    client.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: type === "touchEnd" ? [] : [{ x, y }],
    });
  await touch("touchStart", box.x + box.width - 20);
  for (let i = 1; i <= 12; i++) {
    await touch("touchMove", box.x + box.width - 20 - i * 22);
    await page.waitForTimeout(16);
  }
  await touch("touchEnd", 0);
  await page.waitForTimeout(500);
};

const log: Record<string, unknown> = {};

// Clear the Done section, then Undo: every cleared task (and its subtasks) should come back
const clearAndUndo = async (page: Page, prefix: string) => {
  await page.getByRole("button", { name: /^Done/ }).click();
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: /^Done/ }).scrollIntoViewIfNeeded();
  const before = await page.locator("[data-task-id]").count();
  await page.getByRole("button", { name: "Clear done tasks" }).click();
  await page.waitForTimeout(500);
  const toast = await page
    .locator("[data-toast-undo]")
    .first()
    .innerText()
    .catch(() => "");
  await shot(page, `${prefix}-clear-toast`);
  await page.getByRole("button", { name: "Undo" }).first().click();
  await page.waitForTimeout(800);
  const doneLabel = await page.getByRole("button", { name: /^Done/ }).getAttribute("aria-label");
  const after = await page.locator("[data-task-id]").count();
  await page.getByRole("button", { name: /^Done/ }).scrollIntoViewIfNeeded();
  await shot(page, `${prefix}-clear-undone`);
  // Done parents hide their subtasks in the list, so look for it in the parent's sheet
  await openTask(page, "Pack for the trip");
  const subtaskBack = await sheet(page).getByText("Phone charger").isVisible();
  log[prefix] = { rowsBefore: before, rowsAfterUndo: after, toast, doneLabel, subtaskBack };
};

const browser = await chromium.launch();

// Phone first
await fresh(browser, phone, async (page) => {
  await openTask(page, "Book flights");
  await shot(page, "phone-01-sheet-top");
  await scrollSheet(page, "bottom");
  await page.waitForTimeout(300);
  await shot(page, "phone-02-sheet-notes");
  await openAdd(page);
  await scrollSheet(page, "bottom");
  await page.waitForTimeout(300);
  await shot(page, "phone-03-add-open");
});
await fresh(browser, narrowPhone, async (page) => {
  await openTask(page, "Book flights");
  await scrollSheet(page, "bottom");
  await page.waitForTimeout(300);
  await shot(page, "phone-04-320-sheet-notes");
  await openAdd(page);
  await scrollSheet(page, "bottom");
  await page.waitForTimeout(300);
  await shot(page, "phone-05-320-add-open");
});
await fresh(browser, phone, async (page) => {
  await swipe(page, "Pick up dry cleaning");
  await shot(page, "phone-06-swipe-tray");
});
await fresh(browser, phone, async (page) => {
  await clearAndUndo(page, "phone-07");
});
await fresh(browser, phone, async (page) => {
  await openTask(page, "Pick up dry cleaning");
  await addField(sheet(page), "List");
  await page.waitForTimeout(500);
  await shot(page, "phone-08-list-picker");
});

await fresh(browser, desktop, async (page) => {
  await openTask(page, "Book flights");
  await shot(page, "desktop-01-sheet");
  await sheet(page).getByText("Window seat if possible").hover();
  await page.waitForTimeout(300);
  await shot(page, "desktop-02-note-hover");
  const box = await sheet(page)
    .getByText("Window seat if possible")
    .locator("xpath=..")
    .boundingBox();
  if (box)
    await page.screenshot({
      path: `${OUT}/desktop-03-note-row-zoom.png`,
      clip: { x: box.x - 12, y: box.y - 12, width: box.width + 24, height: box.height + 24 },
      scale: "device",
    });
  await sheet(page).getByText("Compare Tuesday").hover();
  await page.waitForTimeout(300);
  await shot(page, "desktop-04-subtask-hover");
  await openAdd(page);
  await shot(page, "desktop-05-add-open");
});
await fresh(browser, desktop, async (page) => {
  await taskRow(page, "Pick up dry cleaning").hover();
  await page.waitForTimeout(300);
  await shot(page, "desktop-06-row-hover-actions");
});
await fresh(browser, desktop, async (page) => {
  await openTask(page, "Pick up dry cleaning");
  await addField(sheet(page), "List");
  await page.waitForTimeout(500);
  await shot(page, "desktop-07-list-picker");
});
await fresh(browser, desktop, async (page) => {
  await clearAndUndo(page, "desktop-08");
});

writeFileSync(`${OUT}/log.json`, JSON.stringify(log, null, 2));
await browser.close();
stream.close();
console.log(`evidence written to ${OUT}`);
