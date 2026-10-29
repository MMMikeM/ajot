import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { test, expect, type Page } from "./fixtures";
import { mockApi } from "./helpers/mock-api";

// A production build registers sw.js, which would answer /api before the mocks see it
test.use({ serviceWorkers: "block" });

const syncButton = (page: Page) => page.getByRole("button", { name: /^Sync settings/ });
const syncStatus = (page: Page) => page.getByTestId("sync-status");

const row = (page: Page, title: string) =>
  page.locator("[data-task-id]", { hasText: title }).first();

const checkboxOf = (page: Page, title: string) => row(page, title).getByRole("checkbox").first();

test.describe("sync status", () => {
  // mockApi answers /api/events with a 204, which closes the stream for good. This server holds
  // it open instead, as the real one does, so the page can read as connected.
  let stream: Server;
  let streamUrl: string;

  test.beforeAll(async () => {
    stream = createServer((_req, res) => {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        "access-control-allow-origin": "*",
      });
      res.write(": connected\n\n");
    });
    await new Promise<void>((resolve) => stream.listen(0, "127.0.0.1", resolve));
    streamUrl = `http://127.0.0.1:${(stream.address() as AddressInfo).port}/events`;
  });

  test.afterAll(() => {
    stream.closeAllConnections();
    stream.close();
  });

  test("reads Offline while the device is offline, and recovers", async ({ page, context }) => {
    await mockApi(page);
    await page.route("**/api/events**", (route) => route.continue({ url: streamUrl }));
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(syncButton(page)).toHaveText("Sync", { timeout: 15000 });
    await expect(syncStatus(page)).toHaveText("");

    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await expect(syncButton(page)).toHaveText("Offline · saved here");
    await expect(syncStatus(page)).toHaveText("Offline, changes saved on this device");
    await expect(syncButton(page)).toHaveAccessibleName(
      "Sync settings: Offline · saved here, changes saved on this device",
    );
    await expect(syncButton(page).locator(".animate-pulse")).toHaveCount(0);

    await syncButton(page).click();
    await expect(page.getByText(/Your changes are saved on this device/)).toBeVisible();
    await page.keyboard.press("Escape");

    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(syncButton(page)).toHaveText("Sync");
    await expect(syncStatus(page)).toHaveText("Back online");
  });

  test("a server that keeps refusing reads as not syncing, not offline", async ({ page }) => {
    // mockApi's 204 closes the stream; the first retry, a second later, fails the same way.
    // The device is online, so waiting for a connection wouldn't help.
    await mockApi(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(syncButton(page)).toHaveText("Not syncing · saved here", { timeout: 15000 });
    // The state the page opens in isn't announced
    await expect(syncStatus(page)).toHaveText("");
    await syncButton(page).click();
    await expect(page.getByText("Can't reach Ajot's server.", { exact: false })).toBeVisible();
  });

  test("a server that answers again reads as syncing again, not back online", async ({ page }) => {
    let refusing = false;
    await mockApi(page);
    await page.route("**/api/events**", (route) =>
      refusing ? route.fulfill({ status: 503 }) : route.continue({ url: streamUrl }),
    );
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(syncButton(page)).toHaveText("Sync", { timeout: 15000 });

    refusing = true;
    stream.closeAllConnections();
    await expect(syncButton(page)).toHaveText("Not syncing · saved here", { timeout: 15000 });
    await expect(syncStatus(page)).toHaveText("Not syncing, changes saved on this device");

    refusing = false;
    await expect(syncButton(page)).toHaveText("Sync", { timeout: 15000 });
    await expect(syncStatus(page)).toHaveText("Syncing again");
  });
});

test("a task sheet that failed to load offline keeps the list and loads on the next open", async ({
  page,
}) => {
  let reachable = false;
  await mockApi(page);
  await page.route("**/components/task/detail.tsx*", (route) =>
    reachable ? route.continue() : route.abort("internetdisconnected"),
  );
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-task-id]", { timeout: 15000 });
  await expect(syncButton(page)).toBeVisible();

  reachable = true;
  await row(page, "Renew passport").getByRole("button", { name: "Renew passport" }).click();
  await expect(page.locator('[data-slot="drawer-content"]')).toBeVisible();
});

test("a list sheet that failed to load offline keeps the list and loads on the next open", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "the list sheet is the touch layout's");
  let reachable = false;
  await mockApi(page);
  await page.route("**/category-nav/CategoryMobileSheet.tsx*", (route) =>
    reachable ? route.continue() : route.abort("internetdisconnected"),
  );
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-task-id]", { timeout: 15000 });
  // Long enough for the ahead-of-time fetch to have failed
  await page.waitForTimeout(500);
  await expect(syncButton(page)).toBeVisible();

  reachable = true;
  await page.getByTestId("category-nav-trigger").click();
  await expect(page.getByRole("dialog", { name: "Lists" })).toBeVisible();
});

test.describe("focus after a row leaves the list", () => {
  const openList = async (page: Page) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-task-id]", { timeout: 15000 });
  };

  // A key press first, so the focus that follows counts as keyboard focus (:focus-visible)
  const keyboardFocus = async (page: Page, title: string) => {
    await page.keyboard.press("Shift");
    const checkbox = checkboxOf(page, title);
    await checkbox.focus();
    await expect(checkbox).toBeFocused();
    expect(await checkbox.evaluate((el) => el.matches(":focus-visible"))).toBe(true);
    return checkbox;
  };

  test("ticking a task moves focus to the next row's checkbox", async ({ page }) => {
    await mockApi(page);
    await openList(page);

    await keyboardFocus(page, "Renew passport");
    await page.keyboard.press("Space");

    await expect(page.locator("[data-task-id]", { hasText: "Renew passport" })).toHaveCount(0);
    await expect(checkboxOf(page, "Pick up dry cleaning")).toBeFocused();
  });

  test("ticking the last task moves focus to the capture input", async ({ page }) => {
    const data = await mockApi(page);
    await page.route("**/api/tasks", (route) =>
      route.request().method() === "GET"
        ? route.fulfill({ json: data.tasks.filter((t) => t.title === "Pick up dry cleaning") })
        : route.fallback(),
    );
    await openList(page);

    await keyboardFocus(page, "Pick up dry cleaning");
    await page.keyboard.press("Space");

    await expect(page.locator("#add-task-input")).toBeFocused();
  });

  test("deleting a task from the keyboard moves focus to the next row", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "touch deletes from the swipe tray");
    await mockApi(page);
    await openList(page);

    await keyboardFocus(page, "Renew passport");
    await row(page, "Renew passport").getByRole("button", { name: "Delete task" }).focus();
    await page.keyboard.press("Enter");

    await expect(page.locator("[data-task-id]", { hasText: "Renew passport" })).toHaveCount(0);
    await expect(checkboxOf(page, "Pick up dry cleaning")).toBeFocused();
  });

  test("a mouse tick leaves focus alone", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "a mouse is a desktop pointer");
    await mockApi(page);
    await openList(page);

    await checkboxOf(page, "Renew passport").click();
    await expect(page.locator("[data-task-id]", { hasText: "Renew passport" })).toHaveCount(0);
    await expect(checkboxOf(page, "Pick up dry cleaning")).not.toBeFocused();
  });
});
