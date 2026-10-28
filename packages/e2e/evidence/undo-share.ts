// Before/after evidence for the Undo window, Undo for removing a list member, and the desktop
// share sheet. Run once per version of the app:
//   node_modules/.bin/tsx evidence/undo-share.ts --url http://localhost:5312 --out .evidence/undo-share/before
import { mkdirSync } from "node:fs";
import { chromium, devices, type Browser, type Page } from "@playwright/test";
import { mockApi, mockData } from "../helpers/mock-api";
import { startEventStream } from "../helpers/event-stream";
import { createTimeline, enableDemoClicks, showCaption } from "../helpers/demo";

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

const row = (page: Page, title: string) =>
  page.locator("[data-task-id]", { hasText: title }).first();

const PEOPLE = [
  ["Sam Okafor", "sam"],
  ["Sarah Murray", "sarah"],
  ["Priya Natarajan", "priya"],
  ["Anna Lindqvist", "anna"],
  ["Tomás Ferreira", "tomas"],
  ["Mei Tanaka", "mei"],
  ["Jonah Abernathy", "jonah"],
  ["Lena Okonkwo", "lena"],
  ["Ravi Shah", "ravi"],
  ["Ines Moreau", "ines"],
  ["Kwame Mensah", "kwame"],
  ["Olga Petrova", "olga"],
  ["Hugo Lindgren", "hugo"],
  ["Yara Haddad", "yara"],
] as const;

/** Home shared with fourteen people, so the sheet is taller than a laptop screen */
const crowdedHome = () => {
  const data = mockData();
  const home = data.categories.find((c) => c.id === "c-home")!;
  home.collaborators = PEOPLE.map(([name, username], i) => ({
    id: `cc-home-${i}`,
    categoryId: "c-home",
    userId: `u-${username}`,
    addedAt: "2026-09-20T09:00:00.000Z",
    user: { id: `u-${username}`, name, username, avatarUrl: null },
  }));
  return data;
};

const fresh = async (
  browser: Browser,
  device: Device,
  run: (page: Page) => Promise<void>,
  { data = mockData(), video }: { data?: ReturnType<typeof mockData>; video?: string } = {},
) => {
  const context = await browser.newContext({
    ...device,
    colorScheme: "dark",
    serviceWorkers: "block",
    ...(video && { recordVideo: { dir: video, size: device.viewport } }),
  });
  const page = await context.newPage();
  await mockApi(page, { data });
  await stream.holdOpen(page);
  if (video) await enableDemoClicks(page);
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-task-id]", { timeout: 15000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(900);
  await run(page);
  const recording = page.video();
  await context.close();
  if (video) await recording?.saveAs(`${video}/video.webm`);
};

const shareSheet = (page: Page) =>
  page.locator('[data-slot="drawer-content"]', { hasText: "Share list" });

const openShareOnPhone = async (page: Page) => {
  await page.getByTestId("category-nav-trigger").click();
  await page.waitForTimeout(600);
  await page
    .getByRole("button", { name: /^Home/ })
    .locator("xpath=..")
    .getByRole("button", { name: "List options" })
    .click();
  await page.waitForTimeout(400);
  await page.getByTestId("category-share-btn").click();
  await page.waitForTimeout(900);
};

const openShareOnDesktop = async (page: Page) => {
  const pill = page
    .getByTestId("category-sidebar")
    .locator("div")
    .filter({ has: page.getByRole("button", { name: /^Home/ }) })
    .last();
  await pill.hover();
  await pill.getByRole("button", { name: /^(List|Category) options$/ }).click({ force: true });
  await page.waitForTimeout(400);
  await page.getByTestId("category-share-btn").click();
  await page.waitForTimeout(900);
};

const removeMember = async (page: Page, name: string) => {
  const member = shareSheet(page).locator('[class*="group/row"]').filter({ hasText: name });
  await member.hover();
  await member.getByRole("button", { name: "Remove" }).click();
  await page.waitForTimeout(900);
};

// The page as a phone leaves it when switching apps, and as it comes back
const setHidden = (page: Page, hidden: boolean) =>
  page.evaluate(`(() => {
    if (${hidden}) {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    } else {
      delete document.hidden;
      delete document.visibilityState;
    }
    document.dispatchEvent(new Event("visibilitychange"));
  })()`);

const browser = await chromium.launch();

// Phone first
await fresh(browser, phone, async (page) => {
  await row(page, "Pick up dry cleaning").getByRole("checkbox").click();
  await page.waitForTimeout(2500);
  await shot(page, "phone-01-undo-toast");
});
await fresh(browser, phone, async (page) => {
  await openShareOnPhone(page);
  await shot(page, "phone-02-share-sheet");
  await removeMember(page, "Sam Okafor");
  await shot(page, "phone-03-member-removed");
  const undo = page.getByRole("button", { name: "Undo" });
  if (await undo.count()) {
    await undo.click();
    await page.waitForTimeout(1200);
  }
  await shot(page, "phone-04-after-undo");
});

{
  const dir = `${OUT}/phone-clip-switch-away`;
  mkdirSync(dir, { recursive: true });
  const timeline = createTimeline(`${dir}/timeline.json`);
  await fresh(
    browser,
    phone,
    async (page) => {
      await showCaption(page, "Tick a task, then switch to another app");
      timeline.show();
      await page.waitForTimeout(600);
      await row(page, "Pick up dry cleaning").getByRole("checkbox").click();
      await page.waitForTimeout(1200);
      await setHidden(page, true);
      await showCaption(page, "Away in another app for 7 seconds");
      await page.waitForTimeout(7000);
      await setHidden(page, false);
      await showCaption(page, "Back in ajot: is Undo still there?");
      await page.waitForTimeout(2500);
      timeline.save();
    },
    { video: dir },
  );
}

// Then desktop
await fresh(
  browser,
  desktop,
  async (page) => {
    await openShareOnDesktop(page);
    await shot(page, "desktop-01-share-sheet-many");
    await shareSheet(page)
      .locator(".overflow-y-auto")
      .first()
      .evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });
    await page.waitForTimeout(400);
    await shot(page, "desktop-02-share-sheet-scrolled");
    await removeMember(page, "Yara Haddad");
    await shot(page, "desktop-03-member-removed");
  },
  { data: crowdedHome() },
);

await browser.close();
stream.close();
console.log(`evidence written to ${OUT}`);
