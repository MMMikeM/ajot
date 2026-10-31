// Before/after evidence for the links under a task's details. Run once per version of the app:
//   node_modules/.bin/tsx evidence/detail-links.ts --url http://localhost:5301 --out .evidence/detail-links/before
import { mkdirSync } from "node:fs";
import { chromium, devices, type Browser, type Page } from "@playwright/test";
import { mockApi } from "../helpers/mock-api";
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

// As the context menu writes them: the selection, then the page's address
const DESCRIPTION =
  "Worth reading before the offsite, especially the part on sync (see https://en.wikipedia.org/wiki/Local-first_software).\n\nhttps://github.com/MMMikeM/ajot/pull/42";

const shot = (page: Page, name: string) =>
  page.screenshot({
    path: `${OUT}/${name}.png`,
    ...(name.startsWith("desktop") && { clip: { x: 360, y: 0, width: 720, height: 900 } }),
  });

const scene = async (browser: Browser, device: typeof phone | typeof desktop, name: string) => {
  const context = await browser.newContext({
    ...device,
    colorScheme: "dark",
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  const data = await mockApi(page);
  await stream.holdOpen(page);
  const task = data.tasks.find((t) => t.title === "Pick up dry cleaning")!;
  task.title = "Local-first software, and why it matters for Ajot";
  task.description = DESCRIPTION;
  await page.goto(`${BASE_URL}/task/${task.id}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-slot="drawer-content"]', { timeout: 15000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(900);
  await shot(page, name);
  const link = page.getByRole("link", { name: /github\.com/ });
  if (await link.count()) {
    await link.hover();
    await page.waitForTimeout(200);
    await shot(page, `${name}-hover`);
  }
  await context.close();
};

const browser = await chromium.launch();
await scene(browser, phone, "phone-01-task-with-links");
await scene(browser, desktop, "desktop-01-task-with-links");
await browser.close();
stream.close();
