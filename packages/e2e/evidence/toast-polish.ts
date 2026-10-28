// Before/after evidence for the toast polish. Run once per version of the app:
//   npx tsx evidence/toast-polish.ts --url http://localhost:5313 --out .evidence/toast-polish/before
import { mkdirSync } from "node:fs";
import { chromium, devices, type Browser, type Page } from "@playwright/test";
import { taskRow } from "../helpers/app";
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

const { defaultBrowserType: _, ...phone } = devices["iPhone 14"];
const desktop = { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } };
type Device = typeof phone;

const stream = await startEventStream();

const shot = (page: Page, name: string) =>
  page.screenshot({
    path: `${OUT}/${name}.png`,
    ...(name.startsWith("desktop") && { clip: { x: 360, y: 0, width: 720, height: 900 } }),
  });

// The toast arrives after the tick's 450ms hold and 150ms leave
const tick = async (page: Page, title: string) => {
  await taskRow(page, title).getByRole("checkbox").first().click();
  await page.waitForTimeout(900);
};

// No share sheet and no clipboard, so the invite falls back to a persistent toast holding the link
const NO_SHARE = `
  Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: () => Promise.reject(new Error("blocked")) },
    configurable: true,
  });
`;

const fresh = async (
  browser: Browser,
  device: Device,
  run: (page: Page) => Promise<void>,
  { path = "/", video }: { path?: string; video?: string } = {},
) => {
  const context = await browser.newContext({
    ...device,
    colorScheme: "dark",
    serviceWorkers: "block",
    ...(video && { recordVideo: { dir: video, size: device.viewport } }),
  });
  const page = await context.newPage();
  await page.addInitScript(NO_SHARE);
  if (video) await enableDemoClicks(page);
  await mockApi(page);
  await stream.holdOpen(page);
  await page.goto(BASE_URL + path, { waitUntil: "domcontentloaded" });
  if (path === "/") await page.waitForSelector("[data-task-id]", { timeout: 15000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(900);
  await run(page);
  const recording = page.video();
  await context.close();
  if (video) await recording?.saveAs(`${video}/video.webm`);
};

const browser = await chromium.launch();

const scenes = async (device: Device, prefix: "phone" | "desktop") => {
  await fresh(browser, device, async (page) => {
    await tick(page, "Pick up dry cleaning");
    await tick(page, "Renew passport");
    await tick(page, "Call the plumber");
    await shot(page, `${prefix}-01-toast-stack`);
  });
  await fresh(browser, device, async (page) => {
    await tick(page, "Book flights");
    await shot(page, `${prefix}-02-toast-long-title`);
  });
  await fresh(
    browser,
    device,
    async (page) => {
      // A toast that wraps, under one that doesn't
      await page.getByRole("button", { name: /^Invite someone/ }).click();
      await page.waitForTimeout(700);
      await page.getByRole("button", { name: "Back to tasks" }).click();
      await page.waitForSelector("[data-task-id]");
      await page.waitForTimeout(500);
      await tick(page, "Pick up dry cleaning");
      await shot(page, `${prefix}-03-toast-over-a-taller-one`);
    },
    { path: "/people" },
  );
  await fresh(browser, device, async (page) => {
    await page.getByRole("button", { name: /^Sync settings/ }).click();
    await page.waitForTimeout(500);
    await shot(page, `${prefix}-04-account-menu`);
  });
  await fresh(
    browser,
    device,
    async (page) => {
      await page.waitForSelector("h2", { timeout: 15000 });
      await page.waitForTimeout(500);
      await shot(page, `${prefix}-05-settings`);
    },
    { path: "/settings" },
  );
  await fresh(
    browser,
    device,
    async (page) => {
      await page.waitForSelector("h2", { timeout: 15000 });
      await page.waitForTimeout(500);
      await page.getByRole("button", { name: "Accept invite" }).click();
      await page.waitForTimeout(800);
      await shot(page, `${prefix}-06-invite-accepted`);
    },
    { path: "/invite/abc" },
  );
};

await scenes(phone, "phone");
await scenes(desktop, "desktop");

const clip = async (name: string, device: Device) => {
  const dir = `${OUT}/${name}`;
  mkdirSync(dir, { recursive: true });
  const timeline = createTimeline(`${dir}/timeline.json`);
  await fresh(
    browser,
    device,
    async (page) => {
      await showCaption(page, "Tick three tasks, then dismiss the newest toast");
      timeline.show();
      await page.waitForTimeout(600);
      await tick(page, "Pick up dry cleaning");
      await tick(page, "Renew passport");
      await tick(page, "Call the plumber");
      await page.waitForTimeout(600);
      await page
        .locator('[data-toast-undo][style*="--toast-index: 0"]')
        .locator('button[aria-label="Dismiss"]')
        .click();
      await page.waitForTimeout(1400);
      timeline.save();
    },
    { video: dir },
  );
};

await clip("phone-clip-toast-stack", phone);
await clip("desktop-clip-toast-stack", desktop);

await browser.close();
stream.close();
console.log(`evidence written to ${OUT}`);
