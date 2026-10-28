// Before/after evidence for reaching Settings, the offline header and the Settings copy:
//   npx tsx evidence/settings-copy.ts --url http://localhost:5313 --out .evidence/settings-copy/before
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

// Headless Chromium can't reach a push service, and the service worker is blocked, so this device
// reports a subscription of its own. A string: tsx's __name helper doesn't exist in the page.
const STUB_PUSH_SUBSCRIPTION = `
  (() => {
    const endpoint = "https://fcm.googleapis.com/fcm/send/evidence";
    const subscription = {
      endpoint,
      toJSON: () => ({ endpoint, keys: { p256dh: "e", auth: "e" } }),
      unsubscribe: async () => true,
    };
    const registration = { pushManager: { getSubscription: async () => subscription } };
    Object.defineProperty(navigator.serviceWorker, "ready", { get: () => Promise.resolve(registration) });
  })();
`;

type Options = { path?: string; connected?: boolean; pushOn?: boolean };

const fresh = async (
  browser: Browser,
  device: typeof phone,
  run: (page: Page) => Promise<void>,
  { path = "/", connected = true, pushOn = false }: Options = {},
) => {
  const context = await browser.newContext({
    ...device,
    colorScheme: "dark",
    serviceWorkers: "block",
  });
  if (pushOn) await context.addInitScript(STUB_PUSH_SUBSCRIPTION);
  const page = await context.newPage();
  await mockApi(page);
  if (connected) await stream.holdOpen(page);
  await page.route("**/api/push/preferences**", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: { muted: ["overdue"], urgent: true } })
      : route.fulfill({ json: {} }),
  );
  await page.goto(BASE_URL + path, { waitUntil: "domcontentloaded" });
  if (path === "/") await page.waitForSelector("[data-task-id]", { timeout: 15000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(900);
  await run(page);
  await context.close();
};

const syncButton = (page: Page) => page.getByRole("button", { name: /^Sync settings/ });

const goOffline = async (page: Page) => {
  await page.context().setOffline(true);
  await page.evaluate("window.dispatchEvent(new Event('offline'))");
  await page.waitForTimeout(500);
};

const openSyncMenu = async (page: Page) => {
  await syncButton(page).click();
  await page.waitForTimeout(500);
};

const openNotifications = async (page: Page) => {
  await page.getByRole("button", { name: /^Notifications/ }).click();
  await page.waitForTimeout(400);
};

const browser = await chromium.launch();

await fresh(browser, phone, async (page) => {
  await page.getByTestId("category-nav-trigger").click();
  await page.waitForTimeout(1200);
  await shot(page, "phone-01-lists-sheet");
});
await fresh(browser, phone, async (page) => {
  await goOffline(page);
  await shot(page, "phone-02-offline-header");
  await openSyncMenu(page);
  await shot(page, "phone-03-offline-menu");
});
await fresh(
  browser,
  phone,
  async (page) => {
    await syncButton(page)
      .filter({ hasNotText: /^Sync(ing…)?$/ })
      .waitFor({ timeout: 15000 });
    await page.waitForTimeout(300);
    await shot(page, "phone-04-not-syncing-header");
    await openSyncMenu(page);
    await shot(page, "phone-05-not-syncing-menu");
  },
  { connected: false },
);
await fresh(
  browser,
  phone,
  async (page) => {
    await shot(page, "phone-06-settings");
    await openNotifications(page);
    await shot(page, "phone-07-settings-notifications");
    await page.getByRole("group", { name: "Reminders" }).scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await shot(page, "phone-08-settings-notifications-end");
  },
  { path: "/settings", pushOn: true },
);
await fresh(
  browser,
  phone,
  async (page) => {
    await shot(page, "phone-09-settings-off");
  },
  { path: "/settings" },
);

await fresh(browser, desktop, async (page) => {
  await shot(page, "desktop-01-sidebar");
});
await fresh(
  browser,
  desktop,
  async (page) => {
    await openNotifications(page);
    await shot(page, "desktop-02-settings");
  },
  { path: "/settings", pushOn: true },
);
await fresh(browser, desktop, async (page) => {
  await goOffline(page);
  await openSyncMenu(page);
  await shot(page, "desktop-03-offline-menu");
});

await browser.close();
stream.close();
console.log(`evidence written to ${OUT}`);
