import { test, expect } from "./fixtures";
import { createTask } from "./helpers/app";
import { apiRequest, ensureMutualContacts } from "./helpers/api";

const openFirstTaskDetail = async (page: Parameters<typeof createTask>[0]) => {
  await page.locator("[data-task-id]").first().click();
  await page.waitForSelector('[data-slot="drawer-content"]', { timeout: 5000 });
  // Brief settle — drawer animation
  await page.waitForTimeout(300);
};

const drawer = (page: Parameters<typeof createTask>[0]) =>
  page.locator('[data-slot="drawer-content"]');

// The sheet shows only what a task has; anything else is offered under Add
const addField = async (page: Parameters<typeof createTask>[0], field: string) => {
  const d = drawer(page);
  await d.getByRole("button", { name: "Add", exact: true }).click();
  await d.getByRole("group", { name: "Add to task" }).getByRole("button", { name: field }).click();
};

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

test.describe("task detail — visual language", () => {
  test("description field has no box styling", async ({ user1Page: page }) => {
    await createTask(page, "Test task");
    await page.waitForSelector("[data-task-id]");
    await openFirstTaskDetail(page);

    await addField(page, "Description");
    const textarea = drawer(page).getByRole("textbox", { name: "Description" });
    await expect(textarea).toBeVisible();

    const cls = (await textarea.getAttribute("class")) ?? "";
    expect(cls).not.toContain("bg-input");
    expect(cls).not.toContain("rounded-md");
    expect(cls).toContain("border-b");
    expect(cls).toContain("bg-transparent");
  });

  test("due date shows styled button, not a visible native date input", async ({
    user1Page: page,
  }) => {
    await createTask(page, "Test task");
    await page.waitForSelector("[data-task-id]");
    await openFirstTaskDetail(page);

    const d = drawer(page);

    const hiddenInput = d.locator('input[type="datetime-local"]');
    await expect(hiddenInput).toBeAttached();
    const cls = (await hiddenInput.getAttribute("class")) ?? "";
    expect(cls).toContain("invisible");
    expect(cls).toContain("size-0");

    // An undated task has no date row; Add offers one
    await expect(d.getByRole("button", { name: /^Due date:/ })).toHaveCount(0);
  });

  test("delete button is a quiet text link, not a destructive Button variant", async ({
    user1Page: page,
  }) => {
    await createTask(page, "Test task");
    await page.waitForSelector("[data-task-id]");
    await openFirstTaskDetail(page);

    const deleteBtn = drawer(page).getByRole("button", { name: "Delete task" });
    await expect(deleteBtn).toBeVisible();

    const cls = (await deleteBtn.getAttribute("class")) ?? "";
    expect(cls).toContain("text-hint");
    expect(cls).toContain("hover:text-destructive");
    expect(cls).not.toContain("bg-destructive");
  });

  test("title input is an Input primitive (underline, no box)", async ({ user1Page: page }) => {
    await createTask(page, "Test task");
    await page.waitForSelector("[data-task-id]");
    await openFirstTaskDetail(page);

    // The title input is accessible via its sr-only label; avoids matching
    // the subtask and note inputs that also carry data-slot="input".
    const titleInput = drawer(page).getByRole("textbox", { name: "Title" });
    await expect(titleInput).toBeVisible();

    const cls = (await titleInput.getAttribute("class")) ?? "";
    expect(cls).toContain("bg-transparent");
    expect(cls).not.toContain("bg-input");
    expect(cls).not.toContain("rounded-md");
  });

  test("share-with uses Base UI Select, not a native <select>", async ({
    user1Page: page,
    user1Auth,
    user2Auth,
  }) => {
    await ensureMutualContacts(user1Auth.token, user2Auth.token);

    await createTask(page, "Shared task");
    await page.waitForSelector("[data-task-id]");
    await page.waitForTimeout(1000); // contacts collection hydrate
    await openFirstTaskDetail(page);
    await addField(page, "Share");

    await expect(drawer(page).locator("select")).toHaveCount(0);
    const shareWith = drawer(page).getByRole("combobox", { name: "Share with" });
    await expect(shareWith).toHaveAttribute("data-slot", "select-trigger");
  });
});

test.describe("task detail — functionality", () => {
  test("title edit saves on blur", async ({ user1Page: page }) => {
    await createTask(page, "Original title");
    await page.waitForSelector("[data-task-id]");
    await openFirstTaskDetail(page);

    const d = drawer(page);
    const titleInput = d.getByRole("textbox", { name: "Title" });
    await expect(titleInput).toBeVisible();
    await titleInput.click({ clickCount: 3 });
    await titleInput.fill("Updated title");

    // Blur by moving to the description
    await addField(page, "Description");
    await page.waitForTimeout(400);

    await expect(titleInput).toHaveValue("Updated title");
  });

  test("due date can be cleared", async ({ user1Page: page }) => {
    await createTask(page, "Task with date");
    await page.waitForSelector("[data-task-id]");
    await openFirstTaskDetail(page);

    const d = drawer(page);

    await page.evaluate(() => {
      const input = document.querySelector(
        '[data-slot="drawer-content"] input[type="datetime-local"]',
      ) as HTMLInputElement | null;
      if (!input) return;
      // Native setter so React sees the change
      const { set: setValue } = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      ) as { set?: (this: HTMLInputElement, value: string) => void };
      setValue?.call(input, "2025-12-31T09:00");
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForTimeout(400);

    const clearBtn = d.getByRole("button", { name: "clear" });
    await expect(clearBtn).toBeVisible();
    await clearBtn.click();
    await page.waitForTimeout(300);
    await expect(clearBtn).not.toBeVisible();
    await expect(d.getByRole("button", { name: /^Due date:/ })).toHaveCount(0);
  });

  test("delete task closes drawer and removes task from list", async ({ user1Page: page }) => {
    await createTask(page, "Task to delete");
    await page.waitForSelector("[data-task-id]");
    const tasksBefore = await page.locator("[data-task-id]").count();

    await openFirstTaskDetail(page);
    await drawer(page).getByRole("button", { name: "Delete task" }).click();
    await page.waitForTimeout(500);

    await expect(page.locator('[data-slot="drawer-content"]')).not.toBeVisible();
    await expect(page.locator("[data-task-id]")).toHaveCount(tasksBefore - 1);
  });

  test("description saves on blur", async ({ user1Page: page }) => {
    await createTask(page, "Task with description");
    await page.waitForSelector("[data-task-id]");
    await openFirstTaskDetail(page);

    const d = drawer(page);
    await addField(page, "Description");
    const desc = d.getByRole("textbox", { name: "Description" });
    await desc.click();
    await desc.fill("My description");

    await desc.blur();
    await page.waitForTimeout(500);

    // The close animation runs ~400ms
    await page.keyboard.press("Escape");
    await page.waitForSelector('[data-slot="drawer-content"]', {
      state: "detached",
      timeout: 3000,
    });

    await openFirstTaskDetail(page);
    await expect(d.getByRole("textbox", { name: "Description" })).toHaveValue("My description");
  });
});

test.describe("addresses", () => {
  const addTask = (token: string, title: string) => {
    const now = new Date().toISOString();
    const task = { id: crypto.randomUUID(), userId: "", title, createdAt: now, updatedAt: now };
    return apiRequest<{ id: string }>("POST", "/api/tasks", task, token);
  };

  test("an open task has its own address, and closing it goes back to the list", async ({
    user1Page: page,
  }) => {
    await createTask(page, "Addressed task");
    await openFirstTaskDetail(page);
    const id = await page.locator("[data-task-id]").first().getAttribute("data-task-id");
    await expect(page).toHaveURL(new RegExp(`/task/${id}$`));

    await page.keyboard.press("Escape");
    await expect(drawer(page)).toBeHidden();
    await expect(page).toHaveURL(/\/$/);
  });

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

  test("a list's address switches to that list", async ({ user1Page: page, user1Auth }) => {
    const now = new Date().toISOString();
    const name = `Linked list ${Date.now()}`;
    const category = { id: crypto.randomUUID(), userId: "", name, createdAt: now, updatedAt: now };
    await apiRequest("POST", "/api/categories", category, user1Auth.token);
    try {
      await page.goto(`/list/${category.id}`);
      await expect(page).toHaveURL(/\/$/);
      await expect(page.getByRole("heading", { level: 2 })).toContainText(name);
    } finally {
      await apiRequest("DELETE", "/api/categories", { id: category.id }, user1Auth.token);
    }
  });
});
