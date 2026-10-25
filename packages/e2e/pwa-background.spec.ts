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
  return apiRequest<{ id: string }>("POST", "/api/tasks", task, token);
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

const openInFlightMode = async (path = "/"): Promise<Page> => {
  await context.setOffline(true);
  const page = await context.newPage();
  await page.goto(path);
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

  test("so a notification's task opens offline", async ({ user1Auth }) => {
    const title = `Opened from a notification ${Date.now()}`;
    const { id } = await addTask(user1Auth.token, title);
    await deliverPush(context, ORIGIN, { type: "changes" });
    await expect.poll(() => savedTitles(worker)).toContain(title);

    const page = await openInFlightMode(`/task/${id}`);
    await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue(title);
  });
});

test.describe("settings", () => {
  const FAKE_ENDPOINT = "https://fcm.googleapis.com/fcm/send/e2e-settings";

  test.afterEach(({ user1Auth }) =>
    apiRequest("POST", "/api/push/unsubscribe", { endpoint: FAKE_ENDPOINT }, user1Auth.token),
  );

  test("what a device turns off stays off on that device", async () => {
    // Headless Chromium can't reach a push service to subscribe, so this device reports one
    await context.addInitScript((endpoint) => {
      const subscription = {
        endpoint,
        toJSON: () => ({ endpoint, keys: { p256dh: "e2e", auth: "e2e" } }),
        unsubscribe: async () => true,
      };
      PushManager.prototype.getSubscription = async () =>
        subscription as unknown as PushSubscription;
    }, FAKE_ENDPOINT);
    const page = await context.newPage();
    await page.goto("/settings");

    await expect(page.getByRole("checkbox", { name: "Update in the background" })).toBeChecked();
    const due = page.getByRole("checkbox", { name: "A task is due" });
    const rightAway = page.getByRole("checkbox", { name: "Deliver right away" });
    await expect(due).toBeChecked();
    await expect(rightAway).toBeChecked();
    const saved = page.waitForResponse(
      (res) => res.url().endsWith("/api/push/preferences") && res.request().method() === "PUT",
    );
    await due.click();
    await expect(due).not.toBeChecked();
    await saved;
    const savedAgain = page.waitForResponse(
      (res) => res.url().endsWith("/api/push/preferences") && res.request().method() === "PUT",
    );
    await rightAway.click();
    await savedAgain;

    await page.reload();
    await expect(page.getByRole("group", { name: "Reminders" })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "A task is due" })).not.toBeChecked();
    await expect(page.getByRole("checkbox", { name: "Deliver right away" })).not.toBeChecked();
    await expect(
      page.getByRole("checkbox", { name: "Someone changes a list you share" }),
    ).toBeChecked();
  });
});
