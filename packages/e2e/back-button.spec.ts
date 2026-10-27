import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { mockApi } from "./helpers/mock-api";

const sheet = (page: Page) => page.locator('[data-slot="drawer-content"]');

const openListsSheet = async (page: Page) => {
  await page.getByTestId("category-nav-trigger").click();
  await expect(sheet(page)).toBeVisible();
};

/** As an app installed to the home screen runs. DevTools can't emulate display-mode. */
const asInstalled = (page: Page, mode = "standalone") =>
  page.addInitScript((mode) => {
    const matchMedia = window.matchMedia.bind(window);
    window.matchMedia = (query: string) =>
      query === `(display-mode: ${mode})`
        ? Object.defineProperty(matchMedia(query), "matches", { value: true })
        : matchMedia(query);
  }, mode);

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "mobile",
    "the back button and the lists sheet are a phone's",
  );
  await mockApi(page);
});

const openApp = async (page: Page) => {
  await page.goto("/");
  await page.waitForSelector("[data-task-id]");
};

test("back closes the lists sheet and stays in the app", async ({ page }) => {
  await openApp(page);
  await openListsSheet(page);
  await page.goBack();
  await expect(sheet(page)).toHaveCount(0);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("[data-task-id]").first()).toBeVisible();
});

test("closing the sheet another way takes its history entry off", async ({ page }) => {
  await openApp(page);
  await openListsSheet(page);
  await sheet(page).getByRole("button", { name: /^Work/ }).click();
  await expect(sheet(page)).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => history.state?.["ajot-sheet"])).toBeUndefined();
});

test("search opened from the sheet goes back to the list, not the sheet", async ({ page }) => {
  await openApp(page);
  await openListsSheet(page);
  await page.getByRole("button", { name: "Search all lists" }).click();
  await page.waitForURL("**/search");
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(sheet(page)).toHaveCount(0);
});

// Back skips the spare entry if it was added before the user did anything on the page
const interact = (page: Page) => page.getByRole("heading", { level: 2 }).tap();

for (const mode of ["standalone", "minimal-ui"])
  test(`installed (${mode}), back from the first page asks before leaving`, async ({ page }) => {
    await asInstalled(page, mode);
    await openApp(page);
    const entries = await page.evaluate(() => history.length);
    await interact(page);
    await expect.poll(() => page.evaluate(() => history.length)).toBe(entries + 1);

    await page.goBack();
    await expect(page.locator("[data-toast-undo]").first()).toContainText(
      "Press back again to leave",
    );
    await expect(page.locator("[data-task-id]").first()).toBeVisible();

    await page.goBack();
    await expect(page).not.toHaveURL(/localhost/);
  });

test("in a browser tab, back leaves at once", async ({ page }) => {
  await openApp(page);
  await page.goBack();
  await expect(page).not.toHaveURL(/localhost/);
});
