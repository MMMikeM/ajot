import { chromium, type BrowserContext, type Worker } from "@playwright/test";
import { resolve } from "node:path";
import { test, expect } from "./fixtures";
import { apiRequest, uploadImage } from "./helpers/api";
import type { AuthResult } from "./helpers/auth";
import { deliverPush, queueUpload, savedTitles } from "./helpers/background";
import { API_PORT } from "./helpers/stack";

// Runs against the built Chrome extension: `pnpm test:e2e:background`. Playwright can't load a
// Firefox MV2 add-on, so its background is checked by hand.

const EXTENSION_DIR = resolve(import.meta.dirname, "../client/dist-extension/chrome");
const SERVER_URL = `http://localhost:${API_PORT}`;

let context: BrowserContext;
let background: Worker;
let extensionUrl: string;

test.beforeEach(async () => {
  context = await chromium.launchPersistentContext("", {
    // The headless shell can't load extensions
    channel: "chromium",
    args: [`--disable-extensions-except=${EXTENSION_DIR}`, `--load-extension=${EXTENSION_DIR}`],
  });
  background = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  // URL.origin is "null" for a scheme Node doesn't know
  extensionUrl = `chrome-extension://${new URL(background.url()).host}`;
});

test.afterEach(() => context.close());

const addTask = (token: string, title: string) => {
  const now = new Date().toISOString();
  const task = { id: crypto.randomUUID(), userId: "", title, createdAt: now, updatedAt: now };
  return apiRequest<{ id: string }>("POST", "/api/tasks", task, token);
};

// The part of the extension API used below, which only exists inside the extension
declare const chrome: {
  storage: { local: { set: (items: Record<string, string>) => Promise<void> } };
};

const signInBackground = (auth: AuthResult) =>
  background.evaluate(
    (session) =>
      chrome.storage.local.set({
        "newtab-todo-token": session.token,
        "newtab-todo-server-url": session.serverUrl,
      }),
    { token: auth.token, serverUrl: SERVER_URL },
  );

/** A new tab in flight mode, so it can only show what was saved. */
const openInFlightMode = async (auth: AuthResult) => {
  await context.setOffline(true);
  // What signIn() sets, before the first load: signed out, the tab would save empty lists
  await context.addInitScript(
    ({ userId, token, name, username, serverUrl }) => {
      localStorage.setItem("newtab-todo-token", token);
      localStorage.setItem("newtab-todo-server-url", serverUrl);
      localStorage.setItem("newtab-todo-user-id", userId);
      localStorage.setItem("newtab-todo-user-info", JSON.stringify({ id: userId, name, username }));
      localStorage.setItem("newtab-todo-swipe-hint-seen", "1");
    },
    { ...auth, serverUrl: SERVER_URL },
  );
  const page = await context.newPage();
  await page.goto(`${extensionUrl}/index.html`);
  return page;
};

test.describe("the extension's background saves the lists for the next new tab", () => {
  test("on sign-in, with no tab open", async ({ user1Auth }) => {
    const title = `Added elsewhere ${Date.now()}`;
    await addTask(user1Auth.token, title);

    await signInBackground(user1Auth);
    await expect.poll(() => savedTitles(background)).toContain(title);

    const page = await openInFlightMode(user1Auth);
    await expect(page.getByText(title)).toBeVisible();
  });

  test("on a sync push, with no tab open", async ({ user1Auth }) => {
    await signInBackground(user1Auth);
    await expect.poll(() => savedTitles(background)).not.toBeNull();

    const title = `Added elsewhere later ${Date.now()}`;
    await addTask(user1Auth.token, title);
    await deliverPush(context, extensionUrl, { type: "sync" });
    await expect.poll(() => savedTitles(background)).toContain(title);

    const page = await openInFlightMode(user1Auth);
    await expect(page.getByText(title)).toBeVisible();
  });
});

// What a tab queued before it closed: the background sends it, so collaborators get it with no tab
// open
test("the extension's background sends a file a tab queued, on a push", async ({ user1Auth }) => {
  const taskId = crypto.randomUUID();
  const now = new Date().toISOString();
  await apiRequest(
    "POST",
    "/api/tasks",
    { id: taskId, userId: "", title: "With a file", createdAt: now, updatedAt: now },
    user1Auth.token,
  );
  await background.evaluate(
    (session) =>
      chrome.storage.local.set({
        "newtab-todo-token": session.token,
        "newtab-todo-server-url": session.serverUrl,
        "newtab-todo-user-id": session.userId,
      }),
    { token: user1Auth.token, serverUrl: SERVER_URL, userId: user1Auth.userId },
  );
  const id = `bg${Date.now()}`;
  await queueUpload(background, { id, taskId, uploaderId: user1Auth.userId, text: "from no tab" });

  await deliverPush(context, extensionUrl, { type: "sync" });
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

const savedThumbnail = (id: string) =>
  background.evaluate(
    (key) =>
      new Promise<boolean>((done) => {
        const open = indexedDB.open("ajot-files");
        open.onupgradeneeded = () => open.transaction?.abort();
        open.onerror = () => done(false);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains("blobs")) return done(false);
          const read = db.transaction("blobs").objectStore("blobs").get(key);
          read.onsuccess = () => {
            db.close();
            done(read.result !== undefined);
          };
        };
      }),
    `${id}:thumb`,
  );

test("the extension's background saves an attachment's thumbnail, which a tab offline shows", async ({
  user1Auth,
}) => {
  const title = `With a photo ${Date.now()}`;
  const task = await addTask(user1Auth.token, title);
  const id = await uploadImage(user1Auth.token, task.id);
  await background.evaluate(
    (session) =>
      chrome.storage.local.set({
        "newtab-todo-token": session.token,
        "newtab-todo-server-url": session.serverUrl,
        "newtab-todo-user-id": session.userId,
      }),
    { token: user1Auth.token, serverUrl: SERVER_URL, userId: user1Auth.userId },
  );

  await deliverPush(context, extensionUrl, { type: "sync" });
  await expect.poll(() => savedThumbnail(id)).toBe(true);

  const page = await openInFlightMode(user1Auth);
  await page.getByText(title).click();
  const tile = page.getByRole("button", { name: "pixel.png" });
  await expect(tile.locator("img")).toHaveJSProperty("complete", true);
  expect(await tile.locator("img").evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
});
