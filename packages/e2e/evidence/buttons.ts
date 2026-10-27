// Before/after evidence for the button refinement. Run once per version of the app:
//   npx tsx evidence/buttons.ts --url http://localhost:5301 --out .evidence/buttons/before
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

const { defaultBrowserType: _, ...phone } = devices["iPhone 14"];
const desktop = { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } };

const stream = await startEventStream();

const shot = (page: Page, name: string) =>
  page.screenshot({
    path: `${OUT}/${name}.png`,
    ...(name.startsWith("desktop") && { clip: { x: 360, y: 0, width: 720, height: 900 } }),
  });

const row = (page: Page, title: string) =>
  page.locator("[data-task-id]", { hasText: title }).first();

const fresh = async (
  browser: Browser,
  device: typeof phone,
  run: (page: Page) => Promise<void>,
  { signedIn = true, path = "/" } = {},
) => {
  const context = await browser.newContext({
    ...device,
    colorScheme: "dark",
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  await mockApi(page, { signedIn });
  await stream.holdOpen(page);
  await page.goto(BASE_URL + path, { waitUntil: "domcontentloaded" });
  if (path === "/") await page.waitForSelector("[data-task-id]", { timeout: 15000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(900);
  await run(page);
  await context.close();
};

const openTask = async (page: Page, title: string) => {
  await row(page, title).scrollIntoViewIfNeeded();
  await row(page, title)
    .getByRole("button", { name: new RegExp(`^${title}`) })
    .first()
    .click();
  await page.waitForTimeout(800);
};

const browser = await chromium.launch();

await fresh(browser, phone, async (page) => {
  await shot(page, "phone-01-list");
  await page.getByRole("button", { name: /^Done/ }).click();
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: /^Done/ }).scrollIntoViewIfNeeded();
  await shot(page, "phone-02-done-open");
});
await fresh(browser, phone, async (page) => {
  await openTask(page, "Book flights");
  await shot(page, "phone-03-detail");
  await page.getByRole("button", { name: /^Add$/ }).click();
  await page.waitForTimeout(400);
  await shot(page, "phone-04-detail-add-open");
  await page.locator('[data-slot="drawer-content"] .overflow-y-auto').evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await page.waitForTimeout(300);
  await shot(page, "phone-05-detail-bottom");
});
await fresh(browser, phone, async (page) => {
  await page.getByTestId("category-nav-trigger").click();
  await page.waitForTimeout(1200);
  await shot(page, "phone-06-lists-sheet");
});
await fresh(
  browser,
  phone,
  async (page) => {
    await shot(page, "phone-07-people");
  },
  { path: "/people" },
);
await fresh(
  browser,
  phone,
  async (page) => {
    await shot(page, "phone-08-settings");
  },
  { path: "/settings" },
);
await fresh(
  browser,
  phone,
  async (page) => {
    await page.locator('input[type="search"]').fill("zzqx");
    await page.waitForTimeout(500);
    await shot(page, "phone-09-search-nothing");
  },
  { path: "/search" },
);
await fresh(
  browser,
  phone,
  async (page) => {
    await shot(page, "phone-10-sign-in");
  },
  {
    signedIn: false,
    path: "/auth",
  },
);

await fresh(browser, desktop, async (page) => {
  await shot(page, "desktop-01-list");
  await page.getByRole("button", { name: /^Done/ }).click();
  await page.waitForTimeout(400);
  await shot(page, "desktop-02-done-open");
});
await fresh(browser, desktop, async (page) => {
  await openTask(page, "Book flights");
  await shot(page, "desktop-03-detail");
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
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: /^Delete$/ }).click();
  await page.waitForTimeout(500);
  await shot(page, "desktop-04-delete-dialog");
});
await fresh(
  browser,
  desktop,
  async (page) => {
    await shot(page, "desktop-05-sign-in");
  },
  {
    signedIn: false,
    path: "/auth",
  },
);

await browser.close();
stream.close();
console.log(`evidence written to ${OUT}`);
