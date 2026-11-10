// Before/after evidence for tailwind-variants 4, whose own merge tables replace tailwind-merge.
// Stills only, plus every element's class attribute per scene, so a changed merge shows as a diff.
//   npx tsx evidence/tailwind-v4.ts --url http://localhost:5301 --out .evidence/tailwind-v4/before
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium, devices, type Browser, type BrowserContext, type Page } from "@playwright/test";
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

const load = async (page: Page, hash = "") => {
  await page.goto(`${BASE_URL}/${hash}`, { waitUntil: "domcontentloaded" });
  if (!hash) await page.waitForSelector("[data-task-id]", { timeout: 15000 });
  await page.waitForTimeout(1000);
};

const row = (page: Page, title: string) =>
  page.locator("[data-task-id]", { hasText: title }).first();

const openTask = async (page: Page, title: string) => {
  await row(page, title).scrollIntoViewIfNeeded();
  await row(page, title)
    .getByRole("button", { name: new RegExp(`^${title}`) })
    .first()
    .click();
  await page.waitForTimeout(800);
};

const closeSheet = async (page: Page) => {
  await page.keyboard.press("Escape");
  await page.waitForTimeout(700);
};

const shot = async (page: Page, name: string) => {
  await page.screenshot({
    path: `${OUT}/${name}.png`,
    ...(name.startsWith("desktop") && { clip: { x: 360, y: 0, width: 720, height: 900 } }),
  });
  const classes = await page.evaluate(() =>
    [...document.querySelectorAll("[class]")].map(
      (el) => `${el.tagName.toLowerCase()}\t${el.getAttribute("class")}`,
    ),
  );
  writeFileSync(`${OUT}/${name}.classes.txt`, `${classes.join("\n")}\n`);
};

const fresh = async (
  browser: Browser,
  device: typeof phone,
  hash: string,
  run: (page: Page, context: BrowserContext) => Promise<void>,
) => {
  const context = await browser.newContext({
    ...device,
    colorScheme: "dark",
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  await mockApi(page);
  await stream.holdOpen(page);
  await load(page, hash);
  await run(page, context);
  await context.close();
};

const browser = await chromium.launch();

for (const [device, prefix] of [
  [phone, "phone"],
  [desktop, "desktop"],
] as const) {
  await fresh(browser, device, "", async (page) => {
    await shot(page, `${prefix}-01-list`);
    await openTask(page, "Book flights");
    await shot(page, `${prefix}-02-detail-rich-task`);
    await closeSheet(page);
    await openTask(page, "Pick a restaurant for Friday");
    await shot(page, `${prefix}-03-detail-shared-with-you`);
    await closeSheet(page);
    await page.getByRole("button", { name: /^Done/ }).click();
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: /^Done/ }).scrollIntoViewIfNeeded();
    await shot(page, `${prefix}-04-done-open`);
  });
  await fresh(browser, device, "settings", async (page) => {
    await shot(page, `${prefix}-05-settings`);
  });
  await fresh(browser, device, "people", async (page) => {
    await shot(page, `${prefix}-06-people`);
  });
}
await fresh(browser, phone, "", async (page) => {
  await page.getByTestId("category-nav-trigger").click();
  await page.waitForTimeout(600);
  await shot(page, "phone-07-lists-sheet");
});

await browser.close();
stream.close();
