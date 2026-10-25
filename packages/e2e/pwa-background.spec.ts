import type { BrowserContext, Page, Worker } from "@playwright/test";
import { test, expect } from "./fixtures";
import { apiRequest } from "./helpers/api";
import { signIn } from "./helpers/auth";
import { deliverPush, dispatchPeriodicSync, savedTitles } from "./helpers/background";
import { PREVIEW_PORT } from "./helpers/stack";

// Runs against the production build, which has the service worker: `pnpm test:e2e:background`

const ORIGIN = `http://localhost:${PREVIEW_PORT}`;

let context: BrowserContext;
let worker: Worker;

const addTask = (token: string, title: string) => {
  const now = new Date().toISOString();
  const task = { id: crypto.randomUUID(), userId: "", title, createdAt: now, updatedAt: now };
  return apiRequest("POST", "/api/tasks", task, token);
};

test.beforeEach(async ({ browser, user1Auth }) => {
  context = await browser.newContext({ baseURL: ORIGIN });
  // The "changes" push shows a notification, which needs the permission
  await context.grantPermissions(["notifications"], { origin: ORIGIN });
  const page = await context.newPage();
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await signIn(page, user1Auth);
  // Signed in from this load on, which gives the worker its copy of the session
  await page.reload();
  await page.waitForSelector("#add-task-input");
  await page.evaluate(() => navigator.serviceWorker.ready);
  worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  await page.close();
});

test.afterEach(() => context.close());

const openInFlightMode = async (): Promise<Page> => {
  await context.setOffline(true);
  const page = await context.newPage();
  await page.goto("/");
  return page;
};

test.describe("the PWA's worker saves the lists for the next launch", () => {
  test("on a change from another device, with the app closed", async ({ user1Auth }) => {
    const title = `Changed elsewhere ${Date.now()}`;
    await addTask(user1Auth.token, title);
    await deliverPush(context, ORIGIN, { type: "changes" });
    await expect.poll(() => savedTitles(worker)).toContain(title);

    const page = await openInFlightMode();
    await expect(page.getByText(title)).toBeVisible();
  });

  test("on a periodic sync, with the app closed", async ({ user1Auth }) => {
    const title = `Changed while closed ${Date.now()}`;
    await addTask(user1Auth.token, title);
    await dispatchPeriodicSync(context, ORIGIN, "prewarm");
    await expect.poll(() => savedTitles(worker)).toContain(title);

    const page = await openInFlightMode();
    await expect(page.getByText(title)).toBeVisible();
  });
});
