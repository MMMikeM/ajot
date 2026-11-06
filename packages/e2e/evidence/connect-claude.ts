// Evidence for Settings → Connect Claude:
//   npx tsx evidence/connect-claude.ts --url http://localhost:5173 --out .evidence/connect-claude
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

const TOKENS = [
  {
    id: "tok-1",
    userId: "u-me",
    name: "Work laptop",
    hint: "x9Qa",
    canWrite: true,
    expiresAt: "2027-11-06T10:00:00.000Z",
    lastUsedAt: "2026-11-05T18:12:00.000Z",
    createdAt: "2026-11-01T10:00:00.000Z",
  },
  {
    id: "tok-2",
    userId: "u-me",
    name: "Home desktop",
    hint: "b2Lm",
    canWrite: false,
    expiresAt: "2027-02-04T10:00:00.000Z",
    lastUsedAt: null,
    createdAt: "2026-11-06T09:00:00.000Z",
  },
];

const fresh = async (browser: Browser, device: typeof phone, run: (page: Page) => Promise<void>) => {
  const context = await browser.newContext({ ...device, colorScheme: "dark", serviceWorkers: "block" });
  const page = await context.newPage();
  await mockApi(page);
  await page.route("**/api/push/preferences**", (route) =>
    route.fulfill({ json: { muted: [], urgent: true } }),
  );
  await page.route("**/api/mcp/tokens**", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({
          json: { ...TOKENS[0], id: "tok-3", name: "Studio iMac", token: "ajot_pat_Zq3kV9mW2xT8rY4nB6cH1jL5pD7fG0sA_u2EoKiNw" },
        })
      : route.fulfill({ json: TOKENS }),
  );
  await page.goto(`${BASE_URL}/settings`, { waitUntil: "domcontentloaded" });
  await page.getByText("Connect Claude").waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);
  await run(page);
  await context.close();
};

const browser = await chromium.launch();
for (const [label, device] of [
  ["phone", phone],
  ["desktop", desktop],
] as const) {
  await fresh(browser, device, async (page) => {
    await page.getByText("Connect Claude").scrollIntoViewIfNeeded();
    await shot(page, `${label}-1-tokens`);
    await page.getByRole("button", { name: "Make a token" }).click();
    await page.getByLabel("Token name").fill("Studio iMac");
    await page.waitForTimeout(300);
    await shot(page, `${label}-2-form`);
    await page.getByRole("button", { name: "Make token" }).click();
    await page.getByText("is ready").waitFor();
    await page.getByText("is ready").scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await shot(page, `${label}-3-new-token`);
  });
}
await browser.close();
