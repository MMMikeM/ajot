import type { BrowserContext, Page, Worker } from "@playwright/test";
import { test, expect } from "./fixtures";
import { apiRequest } from "./helpers/api";
import { signIn } from "./helpers/auth";
import { watchCsp } from "./helpers/csp";
import {
  deliverPush,
  dispatchPeriodicSync,
  dispatchSync,
  queueUpload,
  savedTitles,
} from "./helpers/background";
import { PREVIEW_PORT } from "./helpers/stack";

// Runs against the production build, which has the service worker: `pnpm test:e2e:background`

const ORIGIN = `http://localhost:${PREVIEW_PORT}`;

let context: BrowserContext;
let worker: Worker;
let expectNoViolations: () => void;

const addTask = (token: string, title: string) => {
  const now = new Date().toISOString();
  const task = { id: crypto.randomUUID(), userId: "", title, createdAt: now, updatedAt: now };
  return apiRequest<{ id: string }>("POST", "/api/tasks", task, token);
};

test.beforeEach(async ({ browser, user1Auth }) => {
  context = await browser.newContext({ baseURL: ORIGIN });
  expectNoViolations = await watchCsp(context);
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

test.afterEach(async () => {
  expectNoViolations();
  await context.close();
});

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

  test("from the rows a push carries, when its fetch fails", async ({ user1Auth }) => {
    await deliverPush(context, ORIGIN, { type: "changes" });
    await expect.poll(() => savedTitles(worker)).not.toBeNull();
    const title = `Saved from the push ${Date.now()}`;
    // As the server sends a new task (routes/tasks.ts): its row, with the lists the page reads
    const task = { ...(await addTask(user1Auth.token, title)), subtasks: [], shares: [] };
    const pushRows = (userId: string, data: object) =>
      deliverPush(context, ORIGIN, {
        type: "changes",
        rows: { userId, events: [{ model: "tasks", action: "insert", data }] },
      });
    await context.setOffline(true);

    const foreign = `Another account's ${Date.now()}`;
    await pushRows("someone-else", { ...task, id: crypto.randomUUID(), title: foreign });
    // Delivering the next push stops the worker, so let it finish this one first
    await new Promise((done) => setTimeout(done, 1_000));
    await pushRows(user1Auth.userId, task);
    await expect.poll(() => savedTitles(worker)).toContain(title);
    expect(await savedTitles(worker)).not.toContain(foreign);

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

test("the PWA's worker sends a file a page queued, on a background sync, with the app closed", async ({
  user1Auth,
}) => {
  const task = await addTask(user1Auth.token, `With a file ${Date.now()}`);
  const id = `sw${Date.now()}`;
  await queueUpload(worker, { id, taskId: task.id, uploaderId: user1Auth.userId, text: "later" });

  await dispatchSync(context, ORIGIN, "ajot-uploads");
  await expect
    .poll(async () => {
      const rows = await apiRequest<{ id: string; uploadedAt: string | null }[]>(
        "GET",
        "/api/attachments",
        undefined,
        user1Auth.token,
      );
      return rows.find((row) => row.id === id)?.uploadedAt ?? null;
    })
    .not.toBeNull();
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

    await expect(
      page.getByRole("checkbox", { name: "Keep lists up to date while Ajot is closed" }),
    ).toBeChecked();
    await page.getByRole("button", { name: "Notifications" }).click();
    const due = page.getByRole("checkbox", { name: "A task is due" });
    const rightAway = page.getByRole("checkbox", { name: "Update even while this device sleeps" });
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
    await expect(page.getByRole("button", { name: "Notifications" })).toContainText("8 of 9 on");
    await page.getByRole("button", { name: "Notifications" }).click();
    await expect(page.getByRole("group", { name: "Reminders" })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "A task is due" })).not.toBeChecked();
    await expect(
      page.getByRole("checkbox", { name: "Update even while this device sleeps" }),
    ).not.toBeChecked();
    await expect(
      page.getByRole("checkbox", { name: "Someone changes a list you share" }),
    ).toBeChecked();
  });

  test("turning updates on with notifications blocked says how to unblock them", async () => {
    await context.clearPermissions();
    const page = await context.newPage();
    await page.goto("/settings");
    await page.evaluate(() => Notification.requestPermission());

    await page
      .getByRole("checkbox", { name: "Keep lists up to date while Ajot is closed" })
      .click();
    await expect(
      page.getByRole("alertdialog", { name: "Notifications are blocked" }),
    ).toBeVisible();
  });
});

test.describe("sharing to the installed app from another app", () => {
  const PHOTO = {
    name: "shared.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR4nGO4o6EBRwzEcQDzAxLBI9OCRQAAAABJRU5ErkJggg==",
      "base64",
    ),
  };

  // What Android sends for the manifest's share target: a multipart POST, as a navigation
  const share = async (page: Page, text: string) => {
    await page.evaluate((text) => {
      const form = document.createElement("form");
      form.method = "POST";
      form.action = "/share";
      form.enctype = "multipart/form-data";
      form.id = "share";
      const field = Object.assign(document.createElement("input"), { name: "text", value: text });
      const files = Object.assign(document.createElement("input"), { type: "file", name: "files" });
      form.append(field, files);
      document.body.append(form);
    }, text);
    await page.setInputFiles("#share input[type=file]", PHOTO);
    await page.evaluate(() => (document.getElementById("share") as HTMLFormElement).submit());
    await page.waitForURL(/\/task\//);
  };

  type Row = { id: string; title: string };
  type Attachment = { taskId: string; name: string; uploadedAt: string | null };

  const uploadedTo = async (token: string, title: string) => {
    const tasks = await apiRequest<Row[]>("GET", "/api/tasks", undefined, token);
    const task = tasks.find((t) => t.title === title);
    if (!task) return [];
    const attachments = await apiRequest<Attachment[]>("GET", "/api/attachments", undefined, token);
    return attachments.filter((a) => a.taskId === task.id && a.uploadedAt).map((a) => a.name);
  };

  test("becomes a task in the Inbox with the file uploaded, used once", async ({ user1Auth }) => {
    const title = `Shared ${Date.now()}`;
    const page = await context.newPage();
    await page.goto("/");
    await share(page, `${title} https://a.test/receipt`);
    await expect(page.getByRole("dialog", { name: title, exact: true })).toBeVisible();
    await expect.poll(() => uploadedTo(user1Auth.token, title)).toEqual([PHOTO.name]);

    await page.goBack();
    await expect(page).not.toHaveURL(/\/share/);
    const tasks = await apiRequest<Row[]>("GET", "/api/tasks", undefined, user1Auth.token);
    expect(tasks.filter((t) => t.title === title)).toHaveLength(1);
  });

  test("offline, is kept on the device and uploads once back online", async ({ user1Auth }) => {
    const title = `Shared offline ${Date.now()}`;
    const earlier = `Before the flight ${Date.now()}`;
    await addTask(user1Auth.token, earlier);
    const page = await context.newPage();
    await page.goto("/");
    // As on a phone that has used Ajot before: the lists are saved for opening offline
    await expect.poll(() => savedTitles(worker)).toContain(earlier);
    await context.setOffline(true);
    await share(page, title);
    await expect(page.getByRole("dialog", { name: title, exact: true })).toBeVisible();
    await context.setOffline(false);
    await expect
      .poll(() => uploadedTo(user1Auth.token, title), { timeout: 20_000 })
      .toEqual([PHOTO.name]);
  });
});
