import { test, expect } from "@playwright/test";
import { mockApi } from "./helpers/mock-api";

// Against mocked /api: what Undo of a delete sends

test.use({ serviceWorkers: "block" });

test("Undo of a delete sends the task's own updatedAt, not the time of the Undo", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "deletes from the row's hover action");
  const data = await mockApi(page);
  const task = data.tasks.find((t) => t.title === "Renew passport")!;
  const restores: { id?: string; deletedAt?: null; updatedAt?: string }[] = [];
  await page.route("**/api/tasks", (route) => {
    const body = route.request().postDataJSON();
    if (route.request().method() === "PUT" && body?.deletedAt === null) restores.push(body);
    return route.fallback();
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const row = page.locator("[data-task-id]", { hasText: "Renew passport" }).first();
  await row.hover();
  await row.getByRole("button", { name: "Delete task" }).click();
  await page.locator("[data-toast-undo]").getByRole("button", { name: "Undo" }).click();

  await expect.poll(() => restores.length).toBe(1);
  expect(restores[0]).toMatchObject({ id: task.id, updatedAt: task.updatedAt });
  await expect(row).toBeVisible();
});
