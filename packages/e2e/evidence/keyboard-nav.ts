// Before/after evidence for keyboard navigation in search results and the task list. Run once per
// version of the app:
//   npx tsx evidence/keyboard-nav.ts --url http://localhost:5314 --out .evidence/keyboard-nav/before
import { mkdirSync } from "node:fs";
import { chromium, devices, type Browser, type Page } from "@playwright/test";
import { mockApi } from "../helpers/mock-api";
import { createTimeline, showCaption } from "../helpers/demo";
import { startEventStream } from "../helpers/event-stream";

const arg = (name: string) => {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) throw new Error(`missing --${name}`);
  return process.argv[index + 1];
};
const BASE_URL = arg("url");
const OUT = arg("out");
mkdirSync(OUT, { recursive: true });

const { defaultBrowserType: _, ...phone } = devices["iPhone 14"];
const desktop = { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } };
type Device = typeof phone | typeof desktop;

const stream = await startEventStream();

const shot = (page: Page, name: string) =>
  page.screenshot({
    path: `${OUT}/${name}.png`,
    ...(name.startsWith("desktop") && { clip: { x: 360, y: 0, width: 720, height: 900 } }),
  });

const open = async (browser: Browser, device: Device, video?: string) => {
  const context = await browser.newContext({
    ...device,
    colorScheme: "dark",
    serviceWorkers: "block",
    ...(video && { recordVideo: { dir: video, size: device.viewport } }),
  });
  const page = await context.newPage();
  await mockApi(page);
  await stream.holdOpen(page);
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-task-id]", { timeout: 15000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(900);
  return { context, page };
};

const searchFor = async (page: Page, query: string, isDesk: boolean) => {
  if (isDesk) {
    await page.keyboard.press("/");
  } else {
    await page.getByTestId("category-nav-trigger").click();
    await page.getByRole("button", { name: "Search all lists" }).click();
  }
  await page.waitForURL("**/search");
  await page.getByRole("searchbox", { name: "Search every list" }).fill(query);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
};

// What has focus, so a viewer can read where each key press went
const FOCUSED = `(() => {
  const el = document.activeElement;
  if (!el || el === document.body) return "nothing";
  const name = el.getAttribute("aria-label") || el.getAttribute("title") || el.textContent || "";
  const role = el.getAttribute("role") || el.tagName.toLowerCase();
  return role + " “" + name.trim().slice(0, 40) + "”";
})()`;

const press = async (page: Page, key: string, label = key) => {
  await page.keyboard.press(key);
  await page.waitForTimeout(150);
  const focused = await page.evaluate<string>(FOCUSED);
  await showCaption(page, `${label} → ${focused}`);
  await page.waitForTimeout(650);
};

const browser = await chromium.launch();

// Phone: touch shows the same list and results as before; nothing here is keyboard-only
{
  const { context, page } = await open(browser, phone);
  await shot(page, "phone-01-list");
  await searchFor(page, "the", false);
  await shot(page, "phone-02-search-results");
  await context.close();
}

{
  const { context, page } = await open(browser, desktop);
  await searchFor(page, "the", true);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(300);
  await shot(page, "desktop-01-search-after-down-down");
  await context.close();
}
{
  const { context, page } = await open(browser, desktop);
  await page.keyboard.press("Tab");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(300);
  await shot(page, "desktop-02-list-after-tab-down-down");
  await context.close();
}

const clip = async (
  name: string,
  run: (page: Page, timeline: ReturnType<typeof createTimeline>) => Promise<void>,
) => {
  const dir = `${OUT}/${name}`;
  mkdirSync(dir, { recursive: true });
  const { context, page } = await open(browser, desktop, dir);
  const timeline = createTimeline(`${dir}/timeline.json`);
  await run(page, timeline);
  timeline.save();
  const video = page.video();
  await context.close();
  await video?.saveAs(`${dir}/video.webm`);
};

await clip("clip-desktop-search-keys", async (page, timeline) => {
  await searchFor(page, "the", true);
  await showCaption(page, "Search “the”, then the arrow keys");
  await page.waitForTimeout(1000);
  timeline.show();
  await page.waitForTimeout(900);
  await press(page, "ArrowDown", "↓");
  await press(page, "ArrowDown", "↓");
  await press(page, "ArrowDown", "↓");
  await press(page, "ArrowUp", "↑");
  await press(page, "Escape", "Esc");
  await page.waitForTimeout(1200);
  timeline.hide();
});

await clip("clip-desktop-search-enter", async (page, timeline) => {
  await searchFor(page, "plumber", true);
  await showCaption(page, "Search “plumber”, then Enter in the field");
  await page.waitForTimeout(1000);
  timeline.show();
  await page.waitForTimeout(900);
  await page.keyboard.press("Enter");
  // Waits up to 3s; a build where Enter doesn't open the sheet times out here
  await page
    .waitForSelector('[data-slot="drawer-content"]', { timeout: 3000 })
    .catch(() => undefined);
  await page.waitForTimeout(400);
  await showCaption(
    page,
    `Enter → ${await page.evaluate<string>(FOCUSED)} (${new URL(page.url()).pathname})`,
  );
  await page.waitForTimeout(1200);
  timeline.hide();
});

await clip("clip-desktop-list-keys", async (page, timeline) => {
  await showCaption(page, "From the capture input: Tab, then the arrow keys");
  await page.waitForTimeout(1000);
  timeline.show();
  await page.waitForTimeout(900);
  await press(page, "Tab");
  await press(page, "Tab");
  await press(page, "ArrowDown", "↓");
  await press(page, "ArrowDown", "↓");
  await press(page, "j");
  await press(page, "k");
  for (let i = 0; i < 5; i++) await press(page, "Tab");
  await page.waitForTimeout(1200);
  timeline.hide();
});

await browser.close();
stream.close();
console.log(`evidence written to ${OUT}`);
