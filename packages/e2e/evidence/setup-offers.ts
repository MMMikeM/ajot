// Before/after evidence for the failed-sync display and where the install offer lives:
//   npx tsx evidence/setup-offers.ts --url http://localhost:5173 --out .evidence/setup-offers/before
import { mkdirSync } from "node:fs";
import { chromium, devices, type Browser, type Page } from "@playwright/test";
import { mockApi } from "../helpers/mock-api";

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

const shot = (page: Page, name: string) =>
  page.screenshot({
    path: `${OUT}/${name}.png`,
    ...(name.startsWith("desktop") && { clip: { x: 360, y: 0, width: 720, height: 900 } }),
  });

// Chromium only offers an install to a page that passes its checks, which a mocked dev server
// doesn't; this hands the app the event it would have had. A string: tsx's __name helper doesn't
// exist in the page.
const OFFER_INSTALL = `
  addEventListener("load", () => setTimeout(() => {
    const event = new Event("beforeinstallprompt", { cancelable: true });
    event.prompt = async () => {};
    event.userChoice = new Promise(() => {});
    dispatchEvent(event);
  }, 300));
`;

const fresh = async (
  browser: Browser,
  device: typeof phone,
  run: (page: Page) => Promise<void>,
  { path = "/", installable = false } = {},
) => {
  const context = await browser.newContext({
    ...device,
    colorScheme: "dark",
    serviceWorkers: "block",
  });
  if (installable) await context.addInitScript(OFFER_INSTALL);
  const page = await context.newPage();
  await mockApi(page);
  await page.route("**/api/push/preferences**", (route) =>
    route.fulfill({ json: { muted: [], urgent: true } }),
  );
  await page.goto(BASE_URL + path, { waitUntil: "domcontentloaded" });
  if (path === "/") await page.waitForSelector("[data-task-id]", { timeout: 15000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(900);
  await run(page);
  await context.close();
};

const syncButton = (page: Page) => page.getByRole("button", { name: /^Sync settings/ });

const openMenu = async (page: Page) => {
  await syncButton(page).click();
  await page.waitForTimeout(400);
};

const browser = await chromium.launch();
for (const [label, device] of [
  ["phone", phone],
  ["desktop", desktop],
] as const) {
  // mockApi answers the event stream with a 204, so the page reads as not syncing within seconds
  await fresh(browser, device, async (page) => {
    await page.getByText("Not syncing · saved here").waitFor({ timeout: 15000 });
    await shot(page, `${label}-1-not-syncing`);
    await openMenu(page);
    await shot(page, `${label}-2-not-syncing-menu`);
  });
  await fresh(browser, device, async (page) => {
    await page.context().setOffline(true);
    await page.evaluate("window.dispatchEvent(new Event('offline'))");
    await page.getByText("Offline · saved here").waitFor();
    await openMenu(page);
    await shot(page, `${label}-3-offline-menu`);
  });
  await fresh(
    browser,
    device,
    async (page) => {
      await openMenu(page);
      await shot(page, `${label}-4-menu-installable`);
    },
    { installable: true },
  );
  await fresh(
    browser,
    device,
    async (page) => void (await shot(page, `${label}-5-settings-installable`)),
    {
      path: "/settings",
      installable: true,
    },
  );
}
await browser.close();
