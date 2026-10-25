// Before/after evidence for the design pass (PR #9). Run once per version of the app:
//   npx tsx evidence/critique-pass.ts --url http://localhost:5301 --out .evidence/critique-pass/before
// Each version is served by its own Vite dev server; /api is mocked, so no server or database is needed.
import { mkdirSync } from "node:fs";
import { chromium, devices, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { mockApi } from "../helpers/mock-api";
import { createTimeline, enableDemoClicks, showCaption } from "../helpers/demo";
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
const desktop = { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } };

const stream = await startEventStream();

type Task = { categoryId: string | null; status: string; parentId: string | null; title: string };

const open = async (
  browser: Browser,
  device: { viewport: { width: number; height: number } },
  video?: string,
) => {
  const context = await browser.newContext({
    ...device,
    colorScheme: "dark",
    serviceWorkers: "block",
    ...(video && { recordVideo: { dir: video, size: device.viewport } }),
  });
  const page = await context.newPage();
  const data = await mockApi(page);
  await stream.holdOpen(page);
  return { context, page, data };
};

const load = async (page: Page) => {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-task-id]", { timeout: 15000 });
  await page.waitForTimeout(800);
};

const row = (page: Page, title: string) =>
  page.locator("[data-task-id]", { hasText: title }).first();

const openTask = async (page: Page, title: string) => {
  await row(page, title).scrollIntoViewIfNeeded();
  await row(page, title)
    .getByRole("button", { name: new RegExp(`^${title}`) })
    .first()
    .click();
  await page.waitForTimeout(700);
};

const closeSheet = async (page: Page) => {
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);
};

// A real touch swipe through CDP, so the app's own swipe handling runs
const swipe = async (page: Page, title: string) => {
  await row(page, title).scrollIntoViewIfNeeded();
  const box = (await row(page, title).boundingBox())!;
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

/** Only one open task in the Inbox, so ticking it clears the list. */
const oneOpenInboxTask = async (page: Page, data: { tasks: Task[] }) => {
  const kept = data.tasks.filter(
    (t) => t.categoryId !== null || t.status === "done" || t.title === "Pick up dry cleaning",
  );
  await page.route("**/api/tasks", (route) =>
    route.request().method() === "GET" ? route.fulfill({ json: kept }) : route.fallback(),
  );
};

// Desktop shots keep the notepad, not the empty desk around it
const shot = (page: Page, name: string) =>
  page.screenshot({
    path: `${OUT}/${name}.png`,
    ...(name.startsWith("desktop") && { clip: { x: 360, y: 0, width: 720, height: 900 } }),
  });

const fresh = async (
  browser: Browser,
  device: typeof phone,
  run: (page: Page, context: BrowserContext) => Promise<void>,
) => {
  const { context, page } = await open(browser, device);
  await load(page);
  await run(page, context);
  await context.close();
};

const browser = await chromium.launch();

// Phone first
await fresh(browser, phone, async (page) => {
  await shot(page, "phone-01-list");
  await swipe(page, "Pick up dry cleaning");
  await shot(page, "phone-02-swipe-your-task");
});
await fresh(browser, phone, async (page) => {
  await swipe(page, "Pick a restaurant for Friday");
  await shot(page, "phone-03-swipe-someone-elses-task");
});
await fresh(browser, phone, async (page) => {
  await openTask(page, "Pick up dry cleaning");
  await shot(page, "phone-04-detail-empty-task");
  await closeSheet(page);
  await openTask(page, "Book flights");
  await shot(page, "phone-05-detail-rich-task");
  await closeSheet(page);
  await openTask(page, "Pick a restaurant for Friday");
  await shot(page, "phone-06-detail-shared-with-you");
});
await fresh(browser, phone, async (page, context) => {
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await page.waitForTimeout(1500);
  await shot(page, "phone-07-offline");
});
await fresh(browser, phone, async (page) => {
  await page.getByRole("button", { name: /^Done/ }).click();
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: /^Done/ }).scrollIntoViewIfNeeded();
  await shot(page, "phone-08-done-open");
});
await fresh(browser, phone, async (page) => {
  await page.getByTestId("category-nav-trigger").click();
  await page.waitForTimeout(500);
  await shot(page, "phone-09-lists-sheet");
  await page
    .getByRole("button", { name: /^(List|Category) options$/ })
    .first()
    .click();
  await page.waitForTimeout(500);
  await shot(page, "phone-10-list-options");
});
{
  const { context, page, data } = await open(browser, phone);
  await oneOpenInboxTask(page, data as unknown as { tasks: Task[] });
  await load(page);
  await row(page, "Pick up dry cleaning").getByRole("checkbox").click();
  await page.waitForTimeout(1600);
  await shot(page, "phone-11-cleared-list");
  await context.close();
}

// Then desktop
await fresh(browser, desktop, async (page) => {
  await shot(page, "desktop-01-list");
  await openTask(page, "Book flights");
  await shot(page, "desktop-02-detail-rich-task");
  await closeSheet(page);
  await openTask(page, "Pick a restaurant for Friday");
  await shot(page, "desktop-03-detail-shared-with-you");
});
await fresh(browser, desktop, async (page) => {
  const pill = page
    .getByTestId("category-sidebar")
    .locator("div")
    .filter({ has: page.getByRole("button", { name: /^Work/ }) })
    .last();
  await pill.hover();
  await page
    .getByRole("button", { name: /^(List|Category) options$/ })
    .first()
    .click({ force: true });
  await page.waitForTimeout(500);
  await shot(page, "desktop-04-list-options");
});

// Short clips of the two interactions that a still can't show
const clip = async (
  name: string,
  run: (page: Page, timeline: ReturnType<typeof createTimeline>) => Promise<void>,
  setup?: (page: Page, data: { tasks: Task[] }) => Promise<void>,
) => {
  const dir = `${OUT}/${name}`;
  mkdirSync(dir, { recursive: true });
  const { context, page, data } = await open(browser, phone, dir);
  const timeline = createTimeline(`${dir}/timeline.json`);
  await enableDemoClicks(page);
  await setup?.(page, data as unknown as { tasks: Task[] });
  await load(page);
  await run(page, timeline);
  timeline.save();
  const video = page.video();
  await context.close();
  await video?.saveAs(`${dir}/video.webm`);
};

await clip("clip-swipe", async (page, timeline) => {
  await showCaption(page, "1. Swipe one of your tasks");
  timeline.show();
  await page.waitForTimeout(800);
  await swipe(page, "Pick up dry cleaning");
  await page.waitForTimeout(1800);
  timeline.hide();
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-task-id]");
  await page.waitForTimeout(800);
  await showCaption(page, "2. Swipe a task Sarah shared with you");
  timeline.show();
  await page.waitForTimeout(800);
  await swipe(page, "Pick a restaurant for Friday");
  await page.waitForTimeout(2200);
});

await clip(
  "clip-clear-list",
  async (page, timeline) => {
    await showCaption(page, "Tick the last open task in the Inbox");
    timeline.show();
    await page.waitForTimeout(800);
    await row(page, "Pick up dry cleaning").getByRole("checkbox").click();
    await page.mouse.move(195, 60);
    await page.waitForTimeout(3000);
  },
  oneOpenInboxTask,
);

await browser.close();
stream.close();
console.log(`evidence written to ${OUT}`);
