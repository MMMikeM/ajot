import type { Locator, Page, Response } from "@playwright/test";
import { test, expect } from "./fixtures";
import { addTask, apiRequest, newId, shareTask } from "./helpers/api";
import type { AuthResult } from "./helpers/auth";
import { S3_URL } from "./helpers/stack";

type ApiAttachment = {
  id: string;
  taskId: string;
  name: string;
  size: number;
  hasThumb: boolean;
  uploadedAt: string | null;
};

type FilePayload = { name: string; mimeType: string; buffer: Buffer };

const PHOTO: FilePayload = {
  name: "photo.png",
  mimeType: "image/png",
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR4nGO4o6EBRwzEcQDzAxLBI9OCRQAAAABJRU5ErkJggg==",
    "base64",
  ),
};

const NOTE_TEXT = "Gate B12, seat 14C";
const NOTE: FilePayload = {
  name: "boarding.txt",
  mimeType: "text/plain",
  buffer: Buffer.from(NOTE_TEXT),
};

const PAGE: FilePayload = {
  name: "page.html",
  mimeType: "text/html",
  buffer: Buffer.from("<!doctype html><script>alert(document.cookie)</script>"),
};

const attachmentsOf = (token: string) =>
  apiRequest<ApiAttachment[]>("GET", "/api/attachments", undefined, token);

const serverRowOf = async (token: string, taskId: string, name: string) =>
  (await attachmentsOf(token)).find((a) => a.taskId === taskId && a.name === name);

const isApi = (response: Response, method: string, path: string) =>
  response.request().method() === method && new URL(response.url()).pathname === path;

const uploadCompleted = (page: Page, timeout?: number) =>
  page.waitForResponse((r) => isApi(r, "POST", "/api/attachments/complete") && r.ok(), {
    timeout,
  });

/** A new task of `auth`'s, opened in its sheet by its address. */
const openNewTask = async (page: Page, auth: AuthResult, label: string) => {
  // A retry on CI runs as the same account, so each title has to be its own
  const title = `${label} ${newId().slice(0, 8)}`;
  const task = await addTask(auth.token, { title });
  await page.goto(`/task/${task.id}`, { waitUntil: "domcontentloaded" });
  const sheet = page.getByRole("dialog", { name: title, exact: true });
  await expect(sheet).toBeVisible({ timeout: 15_000 });
  return { task, title, sheet };
};

// The input is hidden and renders only once /api/config says the server has a bucket
const attach = async (sheet: Locator, file: FilePayload) => {
  await expect(sheet.getByRole("button", { name: "Attach a file" })).toBeVisible();
  await sheet.locator('input[type="file"]').setInputFiles(file);
};

const tileOf = (sheet: Locator, name: string, status?: string) =>
  sheet
    .getByRole("group", { name: "Attachments" })
    .getByRole("button", { name: status ? `${name}, ${status}` : name, exact: true });

const fileRowOf = (sheet: Locator, name: string) =>
  sheet.locator(".group\\/row", { has: sheet.page().getByText(name, { exact: true }) });

const expectImageLoaded = (image: Locator) =>
  expect
    .poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0))
    .toBe(true);

/** How many times the queue has tried to send this device's uploads, from its `ajot-files` store. */
const sendAttempts = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open("ajot-files");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const all = db.transaction("uploads").objectStore("uploads").getAll();
          all.onsuccess = () => {
            db.close();
            resolve(Math.max(0, ...all.result.map((u: { attempts: number }) => u.attempts)));
          };
        };
      }),
  );

const toast = (page: Page, text: string) => page.locator("[data-toast-undo]", { hasText: text });

const downloadFromBucket = async (token: string, id: string) => {
  const [found] = await apiRequest<{ url: string }[]>(
    "POST",
    "/api/attachments/urls",
    { ids: [id], variant: "file" },
    token,
  );
  return Buffer.from(await (await fetch(found!.url)).arrayBuffer());
};

test("a photo shows at once, uploads to the bucket, and is still there after a reload", async ({
  user1Page: page,
  user1Auth,
}) => {
  const { task, sheet } = await openNewTask(page, user1Auth, "Photo");

  // Held, so the tile is checked before the server has heard of the photo
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(
    (url) => url.pathname === "/api/attachments",
    async (route) => {
      if (route.request().method() === "POST") await held;
      await route.fallback();
    },
  );
  await attach(sheet, PHOTO);
  const waiting = tileOf(sheet, PHOTO.name, "Uploading");
  await expect(waiting).toBeVisible();
  await expectImageLoaded(waiting.locator("img"));
  await expect(sheet.getByText("Uploading", { exact: true })).toBeVisible();

  const completed = uploadCompleted(page);
  release();
  await page.unrouteAll();
  await completed;
  await expect(tileOf(sheet, PHOTO.name)).toBeVisible();
  await expect(sheet.getByText("Uploading", { exact: true })).toHaveCount(0);

  const row = await serverRowOf(user1Auth.token, task.id, PHOTO.name);
  expect(row?.uploadedAt).toBeTruthy();
  expect(row?.hasThumb).toBe(true);
  expect(await downloadFromBucket(user1Auth.token, row!.id)).toEqual(PHOTO.buffer);

  // With the bucket out of reach, the thumbnail after the reload is the one this device saved
  await page.route(`${S3_URL}/**`, (route) => route.abort());
  await page.reload({ waitUntil: "domcontentloaded" });
  const tile = tileOf(sheet, PHOTO.name);
  await expect(tile).toBeVisible({ timeout: 15_000 });
  await expectImageLoaded(tile.locator("img"));
});

test("someone the task is shared with sees the photo, loaded from the bucket", async ({
  user1Page: page,
  user1Auth,
  user2Auth,
  user2Page: bobPage,
}) => {
  const { task, title, sheet } = await openNewTask(page, user1Auth, "Shared photo");
  await shareTask(user1Auth.token, task.id, user2Auth.username);
  const completed = uploadCompleted(page);
  await attach(sheet, PHOTO);
  const { id } = await (await completed).json();

  // The server's keys: t/<id> for the thumbnail, a/<id> for the file
  const fromBucket = (prefix: "t" | "a") =>
    bobPage.waitForResponse(
      (r) =>
        r.url().startsWith(S3_URL) &&
        r.request().method() === "GET" &&
        new URL(r.url()).pathname.endsWith(`/${prefix}/${id}`) &&
        r.ok(),
    );
  const thumbLoaded = fromBucket("t");
  await bobPage.goto(`/task/${task.id}`, { waitUntil: "domcontentloaded" });
  const bobSheet = bobPage.getByRole("dialog", { name: title, exact: true });
  const tile = tileOf(bobSheet, PHOTO.name);
  await expect(tile).toBeVisible({ timeout: 15_000 });
  await thumbLoaded;
  await expectImageLoaded(tile.locator("img"));

  const fileLoaded = fromBucket("a");
  await tile.click();
  const viewer = bobPage.getByRole("dialog", { name: PHOTO.name, exact: true });
  await fileLoaded;
  await expectImageLoaded(viewer.getByRole("img", { name: PHOTO.name }));
});

test("a file attached offline waits on this device and uploads once back online", async ({
  user1Page: page,
  user1Auth,
}) => {
  test.fail(
    true,
    "The online event doesn't clear the queue's backoff: it sends when the retry timer fires",
  );
  const { task, sheet } = await openNewTask(page, user1Auth, "Offline");
  await expect(sheet.getByRole("button", { name: "Attach a file" })).toBeVisible();

  await page.context().setOffline(true);
  await attach(sheet, NOTE);
  const row = fileRowOf(sheet, NOTE.name);
  await expect(row).toContainText("Saved here · uploads when online");
  // Two failed sends put the next one 10 s off, so only the online event can send it sooner
  await expect.poll(() => sendAttempts(page), { timeout: 15_000 }).toBeGreaterThanOrEqual(2);

  const completed = uploadCompleted(page, 3_000);
  await page.context().setOffline(false);
  await completed;
  await expect(row).toContainText(`${NOTE_TEXT.length} B · TXT`);
  expect((await serverRowOf(user1Auth.token, task.id, NOTE.name))?.uploadedAt).toBeTruthy();
});

test("a file is a row with its size; text opens in a tab and a web page only downloads", async ({
  user1Page: page,
  user1Auth,
}) => {
  const { sheet } = await openNewTask(page, user1Auth, "Files");
  let completed = uploadCompleted(page);
  await attach(sheet, NOTE);
  await completed;
  completed = uploadCompleted(page);
  await attach(sheet, PAGE);
  await completed;

  await expect(fileRowOf(sheet, NOTE.name)).toContainText(`${NOTE_TEXT.length} B · TXT`);
  await expect(fileRowOf(sheet, PAGE.name)).toContainText(`${PAGE.buffer.length} B · HTML`);

  const popup = page.waitForEvent("popup");
  await sheet.getByRole("button", { name: `Open ${NOTE.name}` }).click();
  const tab = await popup;
  await expect(tab.locator("body")).toHaveText(NOTE_TEXT);
  await tab.close();

  const opened: Page[] = [];
  page.context().on("page", (p) => opened.push(p));
  const download = page.waitForEvent("download");
  await sheet.getByRole("button", { name: `Download ${PAGE.name}` }).click();
  expect((await download).suggestedFilename()).toBe(PAGE.name);
  expect(opened).toEqual([]);
});

test("a file the server refuses stays, with the reason and a Retry", async ({
  user1Page: page,
  user1Auth,
}) => {
  const reason = "That's over your 100 MB of files.";
  const { task, sheet } = await openNewTask(page, user1Auth, "Refused");
  await page.route(
    (url) => url.pathname === "/api/attachments",
    (route) =>
      route.request().method() === "POST"
        ? route.fulfill({ status: 413, json: { error: reason } })
        : route.fallback(),
  );
  await attach(sheet, NOTE);
  const row = fileRowOf(sheet, NOTE.name);
  await expect(row).toContainText(`Couldn’t upload: ${reason}`);
  await expect(row.getByRole("button", { name: "Retry" })).toBeVisible();

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(row).toContainText(`Couldn’t upload: ${reason}`, { timeout: 15_000 });

  await page.unrouteAll();
  const completed = uploadCompleted(page);
  await row.getByRole("button", { name: "Retry" }).click();
  await completed;
  await expect(row).toContainText(`${NOTE_TEXT.length} B · TXT`);
  await expect(row.getByRole("button", { name: "Retry" })).toHaveCount(0);
  expect((await serverRowOf(user1Auth.token, task.id, NOTE.name))?.uploadedAt).toBeTruthy();
});

test.describe("Undo brings back a deleted attachment, on the server too", () => {
  const deletedThenRestored = async (page: Page, name: string, remove: () => Promise<void>) => {
    const deleted = page.waitForResponse((r) => isApi(r, "DELETE", "/api/attachments") && r.ok());
    await remove();
    await deleted;
    const restored = page.waitForResponse((r) => isApi(r, "PUT", "/api/attachments") && r.ok());
    await toast(page, `“${name}” deleted`).getByRole("button", { name: "Undo" }).click();
    await restored;
  };

  test("a file, from its row", async ({ user1Page: page, user1Auth }) => {
    const { task, sheet } = await openNewTask(page, user1Auth, "Delete file");
    const completed = uploadCompleted(page);
    await attach(sheet, NOTE);
    await completed;
    const row = fileRowOf(sheet, NOTE.name);

    await deletedThenRestored(page, NOTE.name, async () => {
      await row.hover();
      await row.getByRole("button", { name: "Delete attachment" }).click();
      await expect(row).toHaveCount(0);
      await expect.poll(() => serverRowOf(user1Auth.token, task.id, NOTE.name)).toBeUndefined();
    });
    await expect(row).toContainText(`${NOTE_TEXT.length} B · TXT`);
    expect((await serverRowOf(user1Auth.token, task.id, NOTE.name))?.uploadedAt).toBeTruthy();
  });

  test("a photo, from the viewer", async ({ user1Page: page, user1Auth }) => {
    const { task, sheet } = await openNewTask(page, user1Auth, "Delete photo");
    const completed = uploadCompleted(page);
    await attach(sheet, PHOTO);
    await completed;
    const tile = tileOf(sheet, PHOTO.name);

    await deletedThenRestored(page, PHOTO.name, async () => {
      await tile.click();
      const viewer = page.getByRole("dialog", { name: PHOTO.name, exact: true });
      await viewer.getByRole("button", { name: "Delete attachment" }).click();
      await expect(viewer).toBeHidden();
      await expect(tile).toHaveCount(0);
    });
    await expect(tile).toBeVisible();
    await expectImageLoaded(tile.locator("img"));
    expect((await serverRowOf(user1Auth.token, task.id, PHOTO.name))?.uploadedAt).toBeTruthy();
  });
});
