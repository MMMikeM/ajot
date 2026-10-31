// Before/after evidence for a task whose only attachment is a picture. Run once per version:
//   node_modules/.bin/tsx evidence/sole-image.ts --url http://localhost:5301 --files <dir> --out .evidence/sole-image/before
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, devices, type Browser, type Page } from "@playwright/test";
import { startsWith, taskRow } from "../helpers/app";
import { mockApi, mockData } from "../helpers/mock-api";
import { startEventStream } from "../helpers/event-stream";

const arg = (name: string) => {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) throw new Error(`missing --${name}`);
  return process.argv[index + 1]!;
};
const BASE_URL = arg("url");
const FILES = arg("files");
const OUT = arg("out");
mkdirSync(OUT, { recursive: true });

const { defaultBrowserType: _, ...phone } = devices["iPhone 14"];
const desktop = { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } };

const stream = await startEventStream();
const BUCKET = "https://bucket.mock";
const AT = "2026-09-20T09:01:00.000Z";

const data = (name: string) => {
  const d = mockData();
  d.attachments = [
    {
      id: "a1",
      taskId: "t-0",
      uploaderId: "u-mike",
      name,
      mimeType: "image/jpeg",
      size: 1_840_000,
      thumbhash: null,
      hasThumb: true,
      uploadedAt: AT,
      createdAt: AT,
      updatedAt: AT,
      deletedAt: null,
    },
  ];
  return d;
};

const shot = (page: Page, name: string) =>
  page.screenshot({
    path: `${OUT}/${name}.png`,
    ...(name.startsWith("desktop") && { clip: { x: 360, y: 0, width: 720, height: 900 } }),
  });

const scene = async (browser: Browser, device: typeof phone, file: string, name: string) => {
  const context = await browser.newContext({
    ...device,
    colorScheme: "dark",
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  await page.addInitScript("globalThis.__name = (fn) => fn");
  await mockApi(page, { data: data(`IMG_${file}.jpg`), attachments: true });
  await page.route("**/api/attachments/urls", async (route) => {
    const { ids, variant } = route.request().postDataJSON() as { ids: string[]; variant: string };
    await route.fulfill({ json: ids.map((id) => ({ id, url: `${BUCKET}/${variant}/${id}` })) });
  });
  await page.route(`${BUCKET}/**`, (route) => {
    const [, variant] = new URL(route.request().url()).pathname.split("/");
    return route.fulfill({
      contentType: "image/jpeg",
      headers: { "access-control-allow-origin": "*" },
      body: readFileSync(join(FILES, variant === "thumb" ? `${file}-thumb.jpg` : `${file}.jpg`)),
    });
  });
  await stream.holdOpen(page);
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-task-id]", { timeout: 15000 });
  await page.evaluate(() => document.fonts.ready);
  await taskRow(page, "Book flights")
    .getByRole("button", { name: startsWith("Book flights") })
    .first()
    .click();
  await page.waitForTimeout(1500);
  await page
    .locator('[data-slot="drawer-content"] .overflow-y-auto')
    .first()
    .evaluate((el) => (el.scrollTop = el.scrollHeight));
  await page.waitForTimeout(500);
  await shot(page, name);
  await context.close();
};

const browser = await chromium.launch();
await scene(browser, phone, "land", "phone-01-landscape");
await scene(browser, phone, "tall", "phone-02-portrait");
await scene(browser, desktop, "land", "desktop-01-landscape");
await browser.close();
stream.close();
