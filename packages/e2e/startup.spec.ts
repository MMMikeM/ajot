import { test, expect } from "./fixtures";
import { taskRow as row } from "./helpers/app";
import { dueLabel, openList } from "./helpers/mock-api";

test("tasks saved on the device show before a slow server answers", async ({ page }) => {
  await openList(page);
  // Saved to IndexedDB by now; the next load's fetch takes far longer than the assertion allows
  await page.waitForTimeout(1000);
  await page.route("**/api/tasks", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await new Promise((resolve) => setTimeout(resolve, 5000));
    await route.fallback();
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(row(page, "Book flights")).toBeVisible({ timeout: 1500 });
});

test("the app still starts when IndexedDB is refused, as with site data blocked", async ({
  page,
}) => {
  await page.addInitScript(() => {
    IDBFactory.prototype.open = () => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    };
  });
  await openList(page);
  await expect(row(page, "Book flights")).toBeVisible();
});

test("due dates and the detail sheet work where the browser lacks Temporal", async ({ page }) => {
  await page.addInitScript(() => {
    delete (globalThis as { Temporal?: unknown }).Temporal;
  });
  const errors: Error[] = [];
  page.on("pageerror", (err) => errors.push(err));
  const polyfill = page.waitForRequest(/temporal-polyfill|global\.esm/);
  await openList(page);
  await polyfill;

  await expect(row(page, "Renew passport")).toContainText(await dueLabel(page, -3));
  await row(page, "Call the plumber")
    .getByRole("button", { name: /^Call the plumber/ })
    .click();
  await expect(page.locator('[data-slot="drawer-content"]')).toBeVisible();
  expect(errors).toEqual([]);
});
