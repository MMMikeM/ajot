// Before/after evidence for who sent or added a task, inviting from the share sheets, People's
// empty state and one face colour per person. Run once per version of the app:
//   node_modules/.bin/tsx evidence/sharing-people.ts --url http://localhost:5342 --out .evidence/sharing-people/after
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

const SARAH = { id: "u-sarah", name: "Sarah Murray", username: "sarah" };
const SAM = { id: "u-sam", name: "Sam Okafor", username: "sam" };
const AT = "2026-09-20T09:00:00.000Z";

type Data = ReturnType<typeof mockData>;
type Row = Data["tasks"][number];

const member = (categoryId: string, user: typeof SAM) => ({
  id: `cc-${categoryId}-${user.id}`,
  categoryId,
  userId: user.id,
  addedAt: AT,
  user: { ...user, avatarUrl: null },
});

const shareOf = (taskId: string, user: typeof SAM) => ({
  id: `s-${taskId}-${user.id}`,
  taskId,
  sharedWithUserId: user.id,
  categoryId: null,
  permission: "edit",
  createdAt: AT,
  updatedAt: AT,
  sharedWithUser: user,
});

const withSharing = () => {
  const data = mockData();
  const template = data.tasks.find((t) => t.title === "Pick up dry cleaning")!;
  const add = (id: string, title: string, extra: Partial<Row>) =>
    data.tasks.push({ ...template, id, title, sortOrder: `b${data.tasks.length}`, ...extra });
  add("t-sent", "Pick up Gran's prescription", {
    sentById: SARAH.id,
    sentBy: { id: SARAH.id, name: SARAH.name },
  });
  add("t-sams", "Fix the gate latch", {
    categoryId: "c-home",
    userId: SAM.id,
    user: { id: SAM.id, name: SAM.name },
  });
  add("t-mine-home", "Paint the shed door", { categoryId: "c-home" });
  return data;
};

const everyoneAdded = () => {
  const data = withSharing();
  data.categories.find((c) => c.id === "c-home")!.collaborators = [
    member("c-home", SAM),
    member("c-home", SARAH),
  ];
  const note = data.tasks.find((t) => t.title.startsWith("Write a thank-you"))!;
  note.shares = [shareOf(note.id, SARAH), shareOf(note.id, SAM)];
  return data;
};

const shot = async (page: Page, name: string) => {
  await page.screenshot({
    path: `${OUT}/${name}.png`,
    ...(name.startsWith("desktop") && { clip: { x: 360, y: 0, width: 720, height: 900 } }),
  });
};

const row = (page: Page, title: string) =>
  page.locator("[data-task-id]", { hasText: title }).first();

const fresh = async (
  browser: Browser,
  device: Device,
  run: (page: Page) => Promise<void>,
  { data = withSharing(), path = "", video }: { data?: Data; path?: string; video?: string } = {},
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
  // Adding someone to a list puts them in it, so the sheet's refetch shows them
  await page.route("**/api/categories/*/collaborators", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const listId = new URL(route.request().url()).pathname.split("/")[3];
    const { username } = route.request().postDataJSON() as { username: string };
    const person = [SARAH, SAM].find((p) => p.username === username)!;
    const list = data.categories.find((c) => c.id === listId)!;
    list.collaborators.push(member(listId, person));
    return route.fulfill({ json: { ...person, avatarUrl: null } });
  });
  if (video) await enableDemoClicks(page);
  await page.goto(`${BASE_URL}${path}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(path ? "h2" : "[data-task-id]", { timeout: 15000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(900);
  await run(page);
  const recording = page.video();
  await context.close();
  if (video) await recording?.saveAs(`${video}/video.webm`);
};

const openTask = async (page: Page, title: string) => {
  await row(page, title).scrollIntoViewIfNeeded();
  await row(page, title)
    .getByRole("button", { name: new RegExp(`^${title}`) })
    .first()
    .click();
  await page.waitForTimeout(800);
};

const switchListOnPhone = async (page: Page, name: string) => {
  await page.getByTestId("category-nav-trigger").click();
  await page.waitForTimeout(600);
  await page
    .getByRole("button", { name: new RegExp(`^${name}`) })
    .first()
    .click();
  await page.waitForTimeout(900);
};

const switchListOnDesktop = async (page: Page, name: string) => {
  await page
    .getByTestId("category-sidebar")
    .getByRole("button", { name: new RegExp(`^${name}`) })
    .first()
    .click();
  await page.waitForTimeout(900);
};

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

const openAddChips = async (page: Page) => {
  await page.getByRole("button", { name: /^Add$/ }).click();
  await page.waitForTimeout(500);
};

const noContacts = () => {
  const data = withSharing();
  data.contacts = [];
  return data;
};

const browser = await chromium.launch();

await fresh(browser, phone, async (page) => {
  await row(page, "Pick up Gran").scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await shot(page, "phone-01-inbox-sent-task");
  await openTask(page, "Pick up Gran");
  await shot(page, "phone-02-sent-task-sheet");
});
await fresh(browser, phone, async (page) => {
  await switchListOnPhone(page, "Home");
  await shot(page, "phone-03-your-list-sams-task");
  await openTask(page, "Fix the gate latch");
  await shot(page, "phone-04-sams-task-sheet");
});
await fresh(browser, phone, async (page) => {
  await switchListOnPhone(page, "Groceries");
  await shot(page, "phone-05-sarahs-list");
});
await fresh(
  browser,
  phone,
  async (page) => {
    await openShareOnPhone(page);
    await shot(page, "phone-06-list-share-everyone-added");
  },
  { data: everyoneAdded() },
);
await fresh(
  browser,
  phone,
  async (page) => {
    await openTask(page, "Write a thank-you");
    await openAddChips(page);
    await shot(page, "phone-07-task-shared-with-everyone-add");
    const share = page.getByRole("button", { name: /^Share$/ });
    if (await share.count()) {
      await share.click();
      await page.waitForTimeout(700);
    }
    await shot(page, "phone-08-task-share-invite");
  },
  { data: everyoneAdded() },
);
await fresh(browser, phone, async (page) => shot(page, "phone-09-people"), { path: "/people" });
await fresh(browser, phone, async (page) => shot(page, "phone-10-people-empty"), {
  path: "/people",
  data: noContacts(),
});

await fresh(browser, desktop, async (page) => {
  await shot(page, "desktop-01-inbox");
  await openTask(page, "Pick up Gran");
  await shot(page, "desktop-02-sent-task-sheet");
});
await fresh(browser, desktop, async (page) => {
  await switchListOnDesktop(page, "Home");
  await shot(page, "desktop-03-your-list-sams-task");
  await switchListOnDesktop(page, "Groceries");
  await shot(page, "desktop-04-sarahs-list");
});
await fresh(
  browser,
  desktop,
  async (page) => {
    await openShareOnDesktop(page);
    await shot(page, "desktop-05-list-share-everyone-added");
  },
  { data: everyoneAdded() },
);
await fresh(browser, desktop, async (page) => shot(page, "desktop-06-people"), {
  path: "/people",
});
await fresh(browser, desktop, async (page) => shot(page, "desktop-07-people-empty"), {
  path: "/people",
  data: noContacts(),
});
await fresh(
  browser,
  desktop,
  async (page) => {
    await openTask(page, "Write a thank-you");
    await openAddChips(page);
    const share = page.getByRole("button", { name: /^Share$/ });
    if (await share.count()) {
      await share.click();
      await page.waitForTimeout(700);
    }
    await shot(page, "desktop-08-task-share-invite");
  },
  { data: everyoneAdded() },
);

// Adding the last contact with the keyboard: where does focus go?
{
  const dir = `${OUT}/desktop-clip-add-last-contact`;
  mkdirSync(dir, { recursive: true });
  const timeline = createTimeline(`${dir}/timeline.json`);
  await fresh(
    browser,
    desktop,
    async (page) => {
      await openShareOnDesktop(page);
      await showCaption(page, "Home has Sam. Add Sarah, the last contact, with the keyboard");
      timeline.show();
      await page.waitForTimeout(900);
      await page.getByRole("combobox", { name: "Add someone" }).focus();
      await page.waitForTimeout(500);
      await page.keyboard.press("Enter");
      await page.waitForTimeout(700);
      await page.keyboard.press("ArrowDown");
      await page.waitForTimeout(300);
      await page.keyboard.press("Enter");
      await page.waitForTimeout(1500);
      await showCaption(page, "Then Tab: where does focus land?");
      await page.keyboard.press("Tab");
      await page.waitForTimeout(1800);
      timeline.save();
    },
    { video: dir },
  );
}

await browser.close();
stream.close();
console.log(`evidence written to ${OUT}`);
