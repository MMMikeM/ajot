// Mockup evidence for the task sheet's attachments: uploaded tiles and files, one waiting offline,
// one refused, and the viewer. Run against the branch's dev server:
//   npx tsx evidence/attachments.ts --url http://localhost:5302 --files <dir> --out .evidence/attachments/after
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, devices, type Browser, type Page } from "@playwright/test";
import { startsWith, taskRow } from "../helpers/app";
import { mockApi, mockData } from "../helpers/mock-api";
import { startEventStream } from "../helpers/event-stream";

const arg = (name: string) => {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) throw new Error(`missing --${name}`);
  return process.argv[index + 1]!;
};
const BASE_URL = arg("url");
const FILES = arg("files");
const OUT = arg("out");
mkdirSync(OUT, { recursive: true });

const { defaultBrowserType: _, ...phone } = devices["iPhone 14"];
const desktop = { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } };

const stream = await startEventStream();
const BUCKET = "https://bucket.mock";

const row = (
  id: string,
  name: string,
  mimeType: string,
  size: number,
  hasThumb: boolean,
  at: string,
) => ({
  id,
  taskId: "t-0",
  uploaderId: "u-mike",
  name,
  mimeType,
  size,
  thumbhash: null,
  hasThumb,
  uploadedAt: at,
  createdAt: at,
  updatedAt: at,
  deletedAt: null,
});

const data = () => {
  const d = mockData();
  d.notes = [
    {
      id: "n-1",
      userId: "u-mike",
      title: null,
      content: "Window seat if possible",
      taskId: "t-0",
      createdAt: "2026-09-20T09:00:00.000Z",
      updatedAt: "2026-09-20T09:00:00.000Z",
    },
  ];
  d.attachments = [
    row("a1", "IMG_2031.jpg", "image/jpeg", 1_840_000, true, "2026-09-20T09:01:00.000Z"),
    row("a2", "IMG_2032.jpg", "image/jpeg", 2_210_000, true, "2026-09-20T09:02:00.000Z"),
    row("a3", "Screenshot 2026-09-19.png", "image/png", 640_000, true, "2026-09-20T09:03:00.000Z"),
    row("a4", "IMG_2035.jpg", "image/jpeg", 1_520_000, true, "2026-09-20T09:04:00.000Z"),
    row("a5", "Boarding pass.pdf", "application/pdf", 182_000, false, "2026-09-20T09:05:00.000Z"),
    row(
      "a6",
      "Itinerary.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      48_000,
      false,
      "2026-09-20T09:06:00.000Z",
    ),
  ];
  return d;
};

const image = (name: string) => readFileSync(join(FILES, name));

// This device's own uploads, written to the store as attachFiles does, while offline
const seedUploads = (page: Page) =>
  page.evaluate(
    async ({ pending, failed }) => {
      const blob = (base64: string) =>
        new Blob([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], { type: "image/jpeg" });
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("ajot-files", 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const tx = db.transaction(["blobs", "uploads"], "readwrite");
      const entry = (id: string, name: string, at: string, extra: object) => ({
        row: {
          id,
          taskId: "t-0",
          name,
          mimeType: "image/jpeg",
          size: 90_000,
          thumbhash: null,
          hasThumb: true,
          createdAt: at,
          updatedAt: at,
        },
        uploaderId: "u-mike",
        posted: false,
        serverDeleted: false,
        attempts: 0,
        retryAt: Date.now() + 3_600_000,
        sizeMismatches: 0,
        ...extra,
      });
      const put = (id: string, base64: string) => {
        for (const variant of ["file", "thumb"])
          tx.objectStore("blobs").put(
            { blob: blob(base64), userId: "u-mike", pinned: true, savedAt: Date.now() },
            `${id}:${variant}`,
          );
      };
      put("p1", pending);
      tx.objectStore("uploads").put(
        entry("p1", "IMG_2040.jpg", "2026-09-20T09:07:00.000Z", {}),
        "p1",
      );
      put("f1", failed);
      tx.objectStore("uploads").put(
        entry("f1", "IMG_2041.jpg", "2026-09-20T09:08:00.000Z", {
          failed: "That’s over your 2048 MB of files.",
        }),
        "f1",
      );
      await new Promise((resolve) => (tx.oncomplete = resolve));
      db.close();
      new BroadcastChannel("ajot-files").postMessage("changed");
    },
    {
      pending: image("a5-thumb.jpg").toString("base64"),
      failed: image("a3-thumb.jpg").toString("base64"),
    },
  );

const shot = (page: Page, name: string) =>
  page.screenshot({
    path: `${OUT}/${name}.png`,
    ...(name.startsWith("desktop") &&
      !name.includes("viewer") && { clip: { x: 360, y: 0, width: 720, height: 900 } }),
  });

const sheet = (page: Page) => page.locator('[data-slot="drawer-content"]');

const scrollSheetToEnd = (page: Page) =>
  sheet(page)
    .locator(".overflow-y-auto")
    .first()
    .evaluate((el) => (el.scrollTop = el.scrollHeight));

const run = async (browser: Browser, device: typeof phone, prefix: string) => {
  const context = await browser.newContext({
    ...device,
    colorScheme: "dark",
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  // tsx names the functions inside page.evaluate with a helper the page doesn't have
  await page.addInitScript("globalThis.__name = (fn) => fn");
  await mockApi(page, { data: data(), attachments: true });
  await page.route("**/api/attachments/urls", async (route) => {
    const { ids, variant } = route.request().postDataJSON() as { ids: string[]; variant: string };
    await route.fulfill({ json: ids.map((id) => ({ id, url: `${BUCKET}/${variant}/${id}` })) });
  });
  const files: Record<string, string> = { a1: "a1", a2: "a2", a3: "a4", a4: "a1" };
  await page.route(`${BUCKET}/**`, (route) => {
    const [, variant, id] = new URL(route.request().url()).pathname.split("/");
    const name = files[id!];
    if (!name) return route.fulfill({ status: 404 });
    return route.fulfill({
      contentType: "image/jpeg",
      headers: { "access-control-allow-origin": "*" },
      body: image(variant === "thumb" ? `${name}-thumb.jpg` : `${name}.jpg`),
    });
  });
  await stream.holdOpen(page);
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-task-id]", { timeout: 15000 });
  await page.evaluate(() => document.fonts.ready);
  await taskRow(page, "Book flights")
    .getByRole("button", { name: startsWith("Book flights") })
    .first()
    .click();
  await page.waitForTimeout(1200);
  await seedUploads(page);
  await page.waitForTimeout(800);
  await scrollSheetToEnd(page);
  await page.waitForTimeout(400);
  await shot(page, `${prefix}-01-section`);
  await sheet(page).getByRole("button", { name: "IMG_2032.jpg", exact: true }).click();
  await page.waitForTimeout(700);
  await shot(page, `${prefix}-02-viewer`);
  for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(500);
  await shot(page, `${prefix}-03-viewer-failed`);
  await context.close();
};

const browser = await chromium.launch();
await run(browser, phone, "phone");
await run(browser, desktop, "desktop");
await browser.close();
stream.close();
