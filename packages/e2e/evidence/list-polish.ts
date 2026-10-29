// Before/after evidence for the list polish. Run once per version of the app:
//   npx tsx evidence/list-polish.ts --url http://localhost:5312 --out .evidence/list-polish/before
import { mkdirSync } from "node:fs";
import { chromium, devices, type Browser, type Page } from "@playwright/test";
import { isoDay, mockApi, mockData } from "../helpers/mock-api";
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
const desktop = {
  ...devices["Desktop Chrome"],
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
};
type Device = typeof phone | typeof desktop;

const longListData = () => {
  const data = mockData();
  const template = data.tasks.find((t) => t.title === "Pick up dry cleaning")!;
  const extra = [
    ["Renew the home insurance policy and send the signed form back to the broker", -12],
    ["Book the car in for its service", 9],
    ["Order a new filter for the coffee machine", null],
    ["Send Mum the photos from the weekend", null],
    ["Cancel the gym trial before it renews", -1],
    ["Water the plants on the balcony", null],
    ["Fix the squeaky hinge on the bedroom door", null],
    ["Find the warranty for the dishwasher", null],
    ["Return the parcel to the post office", 3],
    ["Pay the window cleaner", null],
  ] as const;
  extra.forEach(([title, due], i) => {
    data.tasks.push({
      ...template,
      id: `t-extra-${i}`,
      title,
      dueDate: due === null ? null : isoDay(due),
      sortOrder: `b${i.toString(36).padStart(2, "0")}`,
    });
  });
  const work = data.categories.find((c) => c.id === "c-work")!;
  data.categories.push({
    ...work,
    id: "c-someday",
    name: "Someday",
    color: null as unknown as string,
    sortOrder: "a3",
    collaborators: [],
  });
  return data;
};

const stream = await startEventStream();

const desktopClip = { x: 360, y: 0, width: 720, height: 900 };
const shot = (page: Page, name: string) =>
  page.screenshot({
    path: `${OUT}/${name}.png`,
    ...(name.startsWith("desktop") && { clip: desktopClip }),
  });

const open = async (
  browser: Browser,
  device: Device,
  { path = "/", light = false, video }: { path?: string; light?: boolean; video?: string } = {},
) => {
  const context = await browser.newContext({
    ...device,
    colorScheme: light ? "light" : "dark",
    serviceWorkers: "block",
    ...(video && { recordVideo: { dir: video, size: device.viewport } }),
  });
  const page = await context.newPage();
  await mockApi(page, { data: longListData() });
  await stream.holdOpen(page);
  if (light) await page.addInitScript("document.documentElement.classList.remove('dark')");
  await page.goto(BASE_URL + path, { waitUntil: "domcontentloaded" });
  if (path === "/") await page.waitForSelector("[data-task-id]", { timeout: 15000 });
  // Light mode is dormant: its tokens exist, but the shell, the desk and the first paint stay
  // dark, so the scene paints light surfaces to judge the tokens on
  if (light) {
    await page.evaluate("document.documentElement.classList.remove('dark')");
    await page.addStyleTag({
      content:
        "html, body { background: var(--background) !important; background-image: none !important } canvas, .noise::before { display: none !important } .bg-shell { background: var(--background) !important }",
    });
  }
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(900);
  return { context, page };
};

const scroller = (page: Page) => page.locator(".scroll-edge-fade").first();

const openDone = async (page: Page) => {
  const done = page.getByRole("button", { name: /^Done/ });
  if ((await done.getAttribute("aria-expanded")) !== "true") await done.click();
  await page.waitForTimeout(400);
};

// The Done toggle with the open row above it and the done row below it, magnified, so the
// chevron's line against the checkboxes shows
const shotDoneChevron = async (page: Page, name: string) => {
  await openDone(page);
  const done = page.getByRole("button", { name: /^Done/ });
  await done.scrollIntoViewIfNeeded();
  await page
    .locator("[data-task-id]", { hasText: "Buy oat milk" })
    .first()
    .scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const box = (await done.boundingBox())!;
  const column = (await page
    .locator('[data-task-id] [data-slot="checkbox"]')
    .first()
    .boundingBox())!;
  await page.screenshot({
    path: `${OUT}/${name}.png`,
    clip: { x: column.x - 20, y: box.y - 56, width: 200, height: 120 },
  });
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
  await page.waitForTimeout(500);
};

const listOptions = async (page: Page, list: string, isDesk: boolean) => {
  if (isDesk) {
    const row = page
      .getByTestId("category-sidebar")
      .locator("div")
      .filter({ has: page.getByRole("button", { name: new RegExp(`^${list}`) }) })
      .last();
    await row.hover();
    await row.getByRole("button", { name: "List options" }).click({ force: true });
  } else {
    await page.getByTestId("category-nav-trigger").click();
    await page.waitForTimeout(700);
    const row = page
      .locator('[data-slot="drawer-content"] div')
      .filter({ has: page.getByRole("button", { name: new RegExp(`^${list}`) }) })
      .last();
    await row.getByRole("button", { name: "List options" }).click();
  }
  await page.waitForTimeout(900);
};

const TITLE_X = `(() => {
  const field = document.querySelector('input[type="search"]');
  if (field) {
    const style = getComputedStyle(field);
    return field.getBoundingClientRect().left + parseFloat(style.paddingLeft);
  }
  const span = document.querySelector("h2 span.font-display");
  return span ? span.getBoundingClientRect().left : -1;
})()`;

const browser = await chromium.launch();

{
  const { context, page } = await open(browser, phone);
  await shot(page, "phone-01-list-overdue");
  await scroller(page).evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await page.waitForTimeout(500);
  await shot(page, "phone-02-list-scrolled-to-end");
  await context.close();
}
{
  const { context, page } = await open(browser, phone);
  await listOptions(page, "Work", false);
  await shot(page, "phone-03-list-options");
  await context.close();
}
{
  const { context, page } = await open(browser, phone);
  await listOptions(page, "Someday", false);
  await shot(page, "phone-04-colour-picker-no-colour");
  await context.close();
}
{
  const { context, page } = await open(browser, phone);
  await searchFor(page, "fare", false);
  await shot(page, "phone-05-search-dark");
  await context.close();
}
{
  const { context, page } = await open(browser, phone, { light: true });
  await searchFor(page, "fare", false);
  await shot(page, "phone-06-search-light");
  await context.close();
}
{
  const { context, page } = await open(browser, phone);
  await shotDoneChevron(page, "phone-07-done-chevron-zoomed");
  await context.close();
}

{
  const { context, page } = await open(browser, phone);
  await page
    .locator("[data-task-id]", { hasText: "Renew the home insurance" })
    .first()
    .scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await shot(page, "phone-08-long-title-overdue");
  await context.close();
}

{
  const { context, page } = await open(browser, desktop);
  await shot(page, "desktop-01-list-overdue");
  await context.close();
}
{
  const { context, page } = await open(browser, desktop);
  await listOptions(page, "Someday", true);
  await shot(page, "desktop-02-colour-picker-no-colour");
  await context.close();
}
{
  const { context, page } = await open(browser, desktop);
  await searchFor(page, "fare", true);
  await shot(page, "desktop-03-search-dark");
  await context.close();
}
{
  const { context, page } = await open(browser, desktop, { light: true });
  await searchFor(page, "fare", true);
  await shot(page, "desktop-04-search-light");
  await context.close();
}
{
  const { context, page } = await open(browser, desktop);
  await shotDoneChevron(page, "desktop-05-done-chevron-zoomed");
  await context.close();
}

{
  const name = "clip-desktop-slash-opens-search";
  const dir = `${OUT}/${name}`;
  mkdirSync(dir, { recursive: true });
  // Started with the recording, which begins when the page opens, not once it has loaded
  const timeline = createTimeline(`${dir}/timeline.json`);
  const { context, page } = await open(
    browser,
    { ...desktop, deviceScaleFactor: 1 },
    { video: dir },
  );
  const before = await page.evaluate<number>(TITLE_X);
  await showCaption(page, "Press / and watch the list title");
  timeline.show();
  await page.waitForTimeout(1200);
  await page.keyboard.press("/");
  await page.waitForURL("**/search");
  await page.waitForTimeout(400);
  const after = await page.evaluate<number>(TITLE_X);
  await showCaption(page, `/ → the title's text moved ${Math.round(after - before)}px`);
  await page.waitForTimeout(1200);
  await page.keyboard.press("Escape");
  await page.waitForURL((url) => !url.pathname.endsWith("/search"));
  await showCaption(page, "Escape → back to the list");
  await page.waitForTimeout(800);
  await page.keyboard.press("/");
  await page.waitForTimeout(1200);
  timeline.save();
  console.log(`title text x: list ${before}, search ${after}`);
  const video = page.video();
  await context.close();
  await video?.saveAs(`${dir}/video.webm`);
}

await browser.close();
stream.close();
console.log(`evidence written to ${OUT}`);
