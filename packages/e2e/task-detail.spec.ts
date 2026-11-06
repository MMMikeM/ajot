import { test, expect } from "./fixtures";
import { createTask, tapAddLine } from "./helpers/app";
import { apiRequest, ensureMutualContacts } from "./helpers/api";

const openFirstTaskDetail = async (page: Parameters<typeof createTask>[0]) => {
  await page.locator("[data-task-id]").first().click();
  await page.waitForSelector('[data-slot="drawer-content"]', { timeout: 5000 });
  // Brief settle — drawer animation
  await page.waitForTimeout(300);
};

const drawer = (page: Parameters<typeof createTask>[0]) =>
  page.locator('[data-slot="drawer-content"]');

test.beforeEach(async ({ user1Auth }) => {
  type Task = { id: string; parentId: string | null };
  const tasks = await apiRequest<Task[]>("GET", "/api/tasks", undefined, user1Auth.token);
  // Top-level only: the server deletes subtasks with their parent
  // allSettled: parallel workers may have already deleted some tasks (404 is fine)
  await Promise.allSettled(
    tasks
      .filter((t) => !t.parentId)
      .map((t) => apiRequest("DELETE", "/api/tasks", { id: t.id }, user1Auth.token)),
  );
});

test.describe("task detail — functionality", () => {
  // Alice's contacts are her Bob and the account that invited her, so one is left to pick
  test("sharing with one contact leaves the rest to pick from, and sends one share", async ({
    user1Page: page,
    user1Auth,
    user2Auth,
  }) => {
    await ensureMutualContacts(user1Auth.token, user2Auth.token);
    await createTask(page, "Shared with Bob");
    await page.waitForSelector("[data-task-id]");
    await page.waitForTimeout(1000); // contacts collection hydrate
    await openFirstTaskDetail(page);
    await tapAddLine(drawer(page), "Share");

    const shares: unknown[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && new URL(request.url()).pathname === "/api/tasks/share")
        shares.push(request.postDataJSON());
    });
    await page.getByRole("option", { name: user2Auth.name }).click();

    const d = drawer(page);
    await expect(d.getByText(user2Auth.name, { exact: true })).toBeVisible();
    // Once the share comes back, the picker's items change without Bob
    await expect(d.getByRole("combobox", { name: "Share with" })).toBeVisible();
    await page.waitForTimeout(1000);
    expect(shares).toEqual([expect.objectContaining({ username: user2Auth.username })]);
    await expect(d.locator(".text-destructive")).toHaveCount(0);
  });

  test("the title and details save when they lose focus", async ({
    user1Page: page,
    user1Auth,
  }) => {
    await createTask(page, "Original title");
    await page.waitForSelector("[data-task-id]");
    await openFirstTaskDetail(page);

    const d = drawer(page);
    await d.getByRole("textbox", { name: "Title" }).fill("Updated title");
    const details = d.getByRole("textbox", { name: "Details" });
    await details.click();
    await details.fill("My description");
    await details.blur();

    type Task = { title: string; description: string | null };
    await expect
      .poll(async () =>
        (await apiRequest<Task[]>("GET", "/api/tasks", undefined, user1Auth.token)).map((t) => [
          t.title,
          t.description,
        ]),
      )
      .toContainEqual(["Updated title", "My description"]);
  });
});

test.describe("addresses", () => {
  const addTask = (token: string, title: string) => {
    const now = new Date().toISOString();
    const task = { id: crypto.randomUUID(), userId: "", title, createdAt: now, updatedAt: now };
    return apiRequest<{ id: string }>("POST", "/api/tasks", task, token);
  };

  test("a task's address opens it over the list", async ({ user1Page: page, user1Auth }) => {
    const task = await addTask(user1Auth.token, "Linked task");
    await page.goto(`/task/${task.id}`);
    await expect(drawer(page).getByRole("textbox", { name: "Title" })).toHaveValue("Linked task");

    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator("[data-task-id]").getByText("Linked task")).toBeVisible();
  });

  test("an address for a task that's gone lands on the list", async ({ user1Page: page }) => {
    await page.goto("/task/no-such-task");
    await expect(page).toHaveURL(/\/$/);
    await expect(drawer(page)).toHaveCount(0);
  });
});
