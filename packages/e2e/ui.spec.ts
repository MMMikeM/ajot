import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page } from "@playwright/test";
import { mockApi } from "./helpers/mock-api";

// UI behaviour against the dev server with /api mocked — no API server or database needed.

// A production build registers sw.js, which would answer /api before the mocks see it
test.use({ serviceWorkers: "block" });

const openList = async (page: Page) => {
  await mockApi(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-task-id]", { timeout: 15000 });
};

const row = (page: Page, title: string) =>
  page.locator("[data-task-id]", { hasText: title }).first();

const expectNoAxeViolations = async (page: Page) => {
  // Mid-fade text reads as low contrast; skip animations that never settle (infinite, scroll-driven)
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (a) =>
          a.playState !== "running" ||
          a.timeline !== document.timeline ||
          a.effect?.getTiming().iterations === Infinity,
      ),
  );
  // Base UI inerts everything behind an open sheet or popover; axe would audit it anyway
  const { violations } = await new AxeBuilder({ page }).exclude("[data-base-ui-inert] *").analyze();
  expect(
    violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
  ).toEqual([]);
};

test.describe("task rows", () => {
  test("hover actions take no space at rest and appear on hover", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "hover actions are desktop-only");
    await openList(page);
    const target = row(page, "Pick up dry cleaning");
    const actions = target.getByRole("button", { name: "Delete task" }).locator("xpath=..");

    await page.mouse.move(0, 0);
    await expect(actions).toHaveCSS("opacity", "0");

    // The title runs to the row's padding instead of stopping short of a reserved gutter
    const titleBox = await target
      .getByRole("button", { name: "Pick up dry cleaning", exact: true })
      .boundingBox();
    const rowBox = await target.locator(".group\\/task").first().boundingBox();
    expect(rowBox!.x + rowBox!.width - (titleBox!.x + titleBox!.width)).toBeLessThan(12);

    await target.hover();
    await expect(actions).toHaveCSS("opacity", "1");
  });

  test("a ticked task holds in place before moving to Done", async ({ page }) => {
    await openList(page);
    const target = row(page, "Pick up dry cleaning");
    const checkbox = target.getByRole("checkbox");

    await checkbox.click();
    await expect(checkbox).toHaveAttribute("aria-checked", "true");
    await expect(target).toBeVisible();

    await expect(page.locator("[data-task-id]", { hasText: "Pick up dry cleaning" })).toHaveCount(
      0,
    );
    await expect(page.getByRole("button", { name: /done \(3\)/i })).toBeVisible();
  });

  test("ticking again during the hold cancels the move", async ({ page }) => {
    await openList(page);
    const target = row(page, "Renew passport");
    const checkbox = target.getByRole("checkbox");

    await checkbox.click();
    await checkbox.click();
    await page.waitForTimeout(700);

    await expect(checkbox).toHaveAttribute("aria-checked", "false");
    await expect(target).toBeVisible();
  });

  test("avatars use first and last initials", async ({ page }) => {
    await openList(page);
    await expect(row(page, "Sort out the car insurance").getByTitle("Sam Okafor")).toHaveText("SO");
    await expect(row(page, "Write a thank-you note").getByTitle("Sarah Murray")).toHaveText("SM");
  });
});

test.describe("navigation", () => {
  test("the list title renders once", async ({ page }, testInfo) => {
    await openList(page);
    await expect(page.getByRole("heading", { level: 2, name: "Inbox" })).toHaveCount(1);
    const trigger = page.getByTestId("category-nav-trigger");
    if (testInfo.project.name === "desktop") await expect(trigger).toHaveCount(0);
    else await expect(trigger).toBeVisible();
  });

  test("the column stays put between the list and People", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "the sidebar panel is desktop-only");
    await openList(page);
    const column = page.locator("main").locator("..");
    const listX = (await column.boundingBox())!.x;

    await page.getByTestId("category-sidebar").getByRole("link", { name: "People" }).click();
    await expect(page.getByRole("heading", { name: "People" })).toBeVisible();
    await expect(page.getByTestId("category-sidebar")).toBeVisible();
    expect((await column.boundingBox())!.x).toBe(listX);
  });

  test("the sidebar shows open-task counts", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "the sidebar is desktop-only");
    await openList(page);
    const sidebar = page.getByTestId("category-sidebar");
    await expect(sidebar.getByRole("button", { name: /^Inbox/ })).toContainText("7");
    await expect(sidebar.getByRole("button", { name: /^Work/ })).toContainText("2");
  });

  test("your shared lists read differently from lists shared with you", async ({
    page,
  }, testInfo) => {
    await openList(page);
    if (testInfo.project.name !== "desktop") await page.getByTestId("category-nav-trigger").click();

    const sharedWithMe = page.getByRole("group", { name: "Shared with me" });
    await expect(sharedWithMe.getByRole("button", { name: /^Groceries/ })).toBeVisible();
    await expect(sharedWithMe.getByRole("button", { name: /^Home/ })).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /^Home Shared with Sam Okafor/ }).first(),
    ).toBeVisible();
  });

  test("narrow pointer windows swap the sidebar for the list-title sheet", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "a fine-pointer window below 40rem");
    await page.setViewportSize({ width: 600, height: 800 });
    await openList(page);

    await expect(page.getByTestId("category-sidebar")).toHaveCount(0);
    await page.getByTestId("category-nav-trigger").click();
    await expect(page.getByRole("button", { name: "Add category" })).toBeVisible();
  });
});

test.describe("deleting a category", () => {
  const openOptions = async (page: Page, name: string, isDesktop: boolean) => {
    if (!isDesktop) await page.getByTestId("category-nav-trigger").click();
    // The innermost element holding both the category's button and its options trigger
    const categoryRow = page
      .locator("div")
      .filter({ has: page.getByRole("button", { name: new RegExp(`^${name}`) }) })
      .filter({ has: page.getByRole("button", { name: "Category options" }) })
      .last();
    if (isDesktop) await categoryRow.hover();
    await categoryRow.getByRole("button", { name: "Category options" }).click();
  };

  const deleteRequest = (page: Page) =>
    page.waitForRequest((r) => r.method() === "DELETE" && r.url().endsWith("/api/categories"));

  test("a category with tasks asks first, and Cancel keeps it", async ({ page }, testInfo) => {
    const isDesktop = testInfo.project.name === "desktop";
    await openList(page);
    await openOptions(page, "Work", isDesktop);
    await page.getByRole("button", { name: "Delete", exact: true }).click();

    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("Delete “Work”?");
    await expect(dialog).toContainText("It has 2 tasks.");
    await expectNoAxeViolations(page);

    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Work/ }).first()).toBeVisible();
  });

  for (const [choice, tasks] of [
    ["Move to Inbox", "uncategorise"],
    ["Delete tasks", "delete"],
  ] as const) {
    test(`${choice} sends that choice with the delete`, async ({ page }, testInfo) => {
      await openList(page);
      await openOptions(page, "Work", testInfo.project.name === "desktop");
      await page.getByRole("button", { name: "Delete", exact: true }).click();

      const request = deleteRequest(page);
      await page.getByRole("alertdialog").getByRole("button", { name: choice }).click();
      const body = (await request).postDataJSON();
      // Only the tasks the dialog counted can be deleted
      expect({ ...body, taskIds: body.taskIds.toSorted() }).toEqual({
        id: "c-work",
        tasks,
        taskIds: ["t-10", "t-11"],
      });
    });
  }

  test("an empty category deletes without asking", async ({ page }, testInfo) => {
    await openList(page);
    await openOptions(page, "Home", testInfo.project.name === "desktop");

    const request = deleteRequest(page);
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    expect((await request).postDataJSON()).toEqual({
      id: "c-home",
      tasks: "uncategorise",
      taskIds: [],
    });
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(page.getByText("Category deleted")).toBeVisible();
  });

  test("a refused delete says so and brings the category back", async ({ page }, testInfo) => {
    await openList(page);
    await page.route("**/api/categories", (route) =>
      route.request().method() === "DELETE"
        ? route.fulfill({ status: 400, contentType: "application/json", body: '{"error":"no"}' })
        : route.fallback(),
    );
    await openOptions(page, "Home", testInfo.project.name === "desktop");
    await page.getByRole("button", { name: "Delete", exact: true }).click();

    await expect(page.getByText("Couldn't delete “Home”")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Home/ }).first()).toBeVisible();
  });
});

// The server refuses to delete a task for anyone but its owner, or the owner of its parent
test.describe("deleting someone else's task", () => {
  // Hidden too: the hover buttons sit at opacity 0 and the swipe actions stay invisible until swiped
  const deleteControls = (page: Page, title: string) =>
    row(page, title).getByRole("button", { name: /^Delete/, includeHidden: true });

  const openGroceries = async (page: Page, isDesktop: boolean) => {
    if (!isDesktop) await page.getByTestId("category-nav-trigger").click();
    await page
      .getByRole("group", { name: "Shared with me" })
      .getByRole("button", { name: /^Groceries/ })
      .click();
  };

  // By name: on touch the category sheet is still closing when the task's sheet opens
  const openDetail = async (page: Page, title: string) => {
    await row(page, title).getByRole("button", { name: title, exact: true }).click();
    const detail = page.getByRole("dialog", { name: title });
    await expect(detail).toBeVisible();
    return detail.getByRole("button", { name: "Delete task" });
  };

  test("your own task offers delete", async ({ page }) => {
    await openList(page);
    await expect(deleteControls(page, "Pick up dry cleaning")).not.toHaveCount(0);
    await expect(await openDetail(page, "Pick up dry cleaning")).toHaveCount(1);
  });

  test("a task shared with you offers no delete", async ({ page }) => {
    await openList(page);
    await expect(deleteControls(page, "Pick a restaurant for Friday")).toHaveCount(0);
    await expect(await openDetail(page, "Pick a restaurant for Friday")).toHaveCount(0);
  });

  test("a collaborator's task in a list shared with you offers no delete", async ({
    page,
  }, testInfo) => {
    await openList(page);
    await openGroceries(page, testInfo.project.name === "desktop");
    await expect(deleteControls(page, "Eggs")).toHaveCount(0);
    await expect(await openDetail(page, "Eggs")).toHaveCount(0);
  });
});

test.describe("signing up", () => {
  const signedOutAt = async (page: Page, path: string, awaitingFirstUser = false) => {
    await mockApi(page, { signedIn: false });
    await page.route("**/api/config", (route) =>
      route.fulfill({ json: { vapidPublicKey: "", awaitingFirstUser } }),
    );
    const config = page.waitForResponse("**/api/config");
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await config;
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  };

  test("a server with accounts only takes signups through an invite", async ({ page }) => {
    await signedOutAt(page, "/auth");
    await expect(page.getByRole("button", { name: "Create an account" })).toHaveCount(0);
  });

  test("a new server offers its first account", async ({ page }) => {
    await signedOutAt(page, "/auth", true);
    await page.getByRole("button", { name: "Create an account" }).click();
    await expect(
      page.getByRole("heading", { name: "Create the server's first account" }),
    ).toBeVisible();
  });

  test("an invite link signs up with its invite", async ({ page }) => {
    await signedOutAt(page, "/invite/abc");
    await expect(page).toHaveURL(/\/auth$/);
    await page.getByRole("button", { name: "Create an account" }).click();
    await page.getByLabel("Name", { exact: true }).fill("Sam Okafor");
    await page.getByLabel("Username").fill("sam");
    await page.getByLabel("Password").fill("correct horse");

    const signup = page.waitForRequest((r) => r.url().endsWith("/api/auth/signup"));
    await page.getByRole("button", { name: "Create account" }).click();
    expect((await signup).postDataJSON()).toMatchObject({ username: "sam", invite: "abc" });
  });
});

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

test("only a task added now slides in; the loaded list appears at once", async ({ page }) => {
  await openList(page);
  const entering = page.locator('[data-task-id] [class*="task-enter"]');
  await expect(entering).toHaveCount(0);

  await page.fill("#add-task-input", "Water the plants");
  await page.keyboard.press("Enter");
  await expect(row(page, "Water the plants").locator('[class*="task-enter"]')).toHaveCount(1);
  await expect(entering).toHaveCount(1);
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

  await expect(row(page, "Renew passport")).toContainText("3d ago");
  await row(page, "Call the plumber")
    .getByRole("button", { name: /^Call the plumber/ })
    .click();
  await expect(page.locator('[data-slot="drawer-content"]')).toBeVisible();
  expect(errors).toEqual([]);
});

test.describe("accessibility", () => {
  test("task list", async ({ page }) => {
    await openList(page);
    await expectNoAxeViolations(page);
  });

  test("task detail sheet", async ({ page }) => {
    await openList(page);
    await row(page, "Book flights")
      .getByRole("button", { name: /^Book flights/ })
      .click();
    await expect(page.locator('[data-slot="drawer-content"]')).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test("category navigation", async ({ page }, testInfo) => {
    await openList(page);
    if (testInfo.project.name === "desktop") {
      const pill = page
        .getByTestId("category-sidebar")
        .locator(".group\\/pill")
        .filter({ hasText: "Work" });
      await pill.hover();
      await pill.getByRole("button", { name: "Category options" }).click();
      await expect(page.getByRole("button", { name: "Rename" })).toBeVisible();
    } else {
      await page.getByTestId("category-nav-trigger").click();
      await expect(page.getByRole("button", { name: "Add category" })).toBeVisible();
    }
    await expectNoAxeViolations(page);
  });

  test("people", async ({ page }) => {
    await mockApi(page);
    await page.goto("/people", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Sarah Murray", { exact: true })).toBeVisible({ timeout: 15000 });
    await expectNoAxeViolations(page);
  });

  test("sign in", async ({ page }) => {
    await mockApi(page, { signedIn: false });
    await page.goto("/auth", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible({ timeout: 15000 });
    await expectNoAxeViolations(page);
  });
});
