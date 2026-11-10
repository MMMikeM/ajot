// Stills of tagging people while adding a task, against mocked data:
//   npx tsx evidence/at-tags.ts --url http://localhost:5302 --out .evidence/at-tags
import { mkdirSync } from "node:fs";
import { chromium, devices, type Page } from "@playwright/test";
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
const browser = await chromium.launch();

const shot = (page: Page, name: string) =>
  page.screenshot({
    path: `${OUT}/${name}.png`,
    ...(name.startsWith("desktop") && { clip: { x: 360, y: 0, width: 720, height: 560 } }),
  });

for (const [device, prefix] of [
  [phone, "phone"],
  [desktop, "desktop"],
] as const) {
  const context = await browser.newContext({
    ...device,
    colorScheme: "dark",
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  await mockApi(page);
  await stream.holdOpen(page);
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-task-id]");
  await page.waitForTimeout(800);
  const input = page.locator("#add-task-input");
  await input.click();
  await input.pressSequentially("Book the restaurant @");
  await page.waitForTimeout(300);
  await shot(page, `${prefix}-01-picker-all`);
  await input.pressSequentially("sa");
  await page.waitForTimeout(300);
  await shot(page, `${prefix}-02-picker-filtered`);
  await page.keyboard.press("Enter");
  await input.pressSequentially("for Friday");
  await page.waitForTimeout(300);
  await shot(page, `${prefix}-03-picked`);
  await context.close();
}

await browser.close();
stream.close();
