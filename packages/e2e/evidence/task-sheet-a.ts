// Before/after evidence for the task sheet's direction A: everything adds where it lives. Run once
// per version of the app:
//   node_modules/.bin/tsx evidence/task-sheet-a.ts --url http://localhost:5321 --out .evidence/task-sheet-a/before
import { mkdirSync } from "node:fs";
import { chromium, devices, type Browser, type Page } from "@playwright/test";
import { MOCK_SARAH, mockApi, noteOn, shareWith } from "../helpers/mock-api";
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

// An hour ago, so the note reads as written today on either version
const WRITTEN = new Date(Date.now() - 60 * 60 * 1000).toISOString();

const scene = async (
  browser: Browser,
  device: typeof phone | typeof desktop,
  taskId: string,
  name: string,
) => {
  const context = await browser.newContext({
    ...device,
    colorScheme: "dark",
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  const data = await mockApi(page);
  await stream.holdOpen(page);

  const flights = data.tasks[0]!;
  flights.categoryId = "c-work";
  flights.shares = [shareWith(flights.id, MOCK_SARAH)];
  data.notes.push(
    noteOn(flights, "Window seat if possible, and check the luggage allowance on the cheap fare", {
      createdAt: WRITTEN,
      updatedAt: WRITTEN,
    }),
  );

  await page.goto(`${BASE_URL}/task/${taskId}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-slot="drawer-content"]', { timeout: 15000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(900);
  await shot(page, name);

  const scroller = page.locator('[data-slot="drawer-content"] > [class*="overflow-y-auto"]');
  if (await scroller.evaluate((el) => el.scrollHeight > el.clientHeight + 1)) {
    await scroller.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
    await page.waitForTimeout(300);
    await shot(page, `${name}-end`);
  }
  await context.close();
};

// Desktop shots keep the notepad, not the empty desk around it
const shot = (page: Page, name: string) =>
  page.screenshot({
    path: `${OUT}/${name}.png`,
    ...(name.startsWith("desktop") && { clip: { x: 360, y: 0, width: 720, height: 900 } }),
  });

const browser = await chromium.launch();

const scenes = [
  ["t-0", "task-with-subtasks-note-sharing"],
  ["t-2", "subtask"],
  ["t-6", "empty-task"],
] as const;

for (const [i, [taskId, what]] of scenes.entries())
  await scene(browser, phone, taskId, `phone-0${i + 1}-${what}`);
for (const [i, [taskId, what]] of scenes.entries())
  await scene(browser, desktop, taskId, `desktop-0${i + 1}-${what}`);

await browser.close();
stream.close();
