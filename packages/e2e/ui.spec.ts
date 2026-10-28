import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page, type Request, type Route } from "@playwright/test";
import { mockApi, mockData } from "./helpers/mock-api";

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

test("a right-to-left title reads right to left wherever it shows", async ({ page }, testInfo) => {
  const hebrew = "לקנות חלב ולחם לשבת";
  const data = mockData();
  data.tasks.find((t) => t.title === "Pick up dry cleaning")!.title = hebrew;
  data.categories.find((c) => c.id === "c-home")!.name = "בית";
  await mockApi(page, { data });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-task-id]", { timeout: 15000 });

  const isRtl = (el: Element) => el.matches(":dir(rtl)");
  const title = row(page, hebrew).getByText(hebrew, { exact: true });
  expect(await title.evaluate(isRtl)).toBe(true);
  expect(await row(page, "Renew passport").getByText("Renew passport").evaluate(isRtl)).toBe(false);
  if (testInfo.project.name === "desktop")
    expect(await page.getByTestId("category-sidebar").getByText("בית").evaluate(isRtl)).toBe(true);

  await title.click();
  const sheet = page.locator('[data-slot="drawer-content"]');
  expect(await sheet.getByRole("textbox", { name: "Title" }).evaluate(isRtl)).toBe(true);
});

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
    await expect(
      row(page, "Sort out the car insurance").getByTitle("Assigned to Sam Okafor"),
    ).toHaveText(/^SO/);
    await expect(
      row(page, "Pick a restaurant for Friday").getByTitle("Sarah Murray's task"),
    ).toHaveText(/^SM/);
  });
});

test.describe("navigation", () => {
  test("an empty Inbox stays open and listed", async ({ page }, testInfo) => {
    const data = await mockApi(page);
    await page.route("**/api/tasks", (route) =>
      route.request().method() === "GET"
        ? route.fulfill({ json: data.tasks.filter((t) => t.categoryId) })
        : route.fallback(),
    );
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("type something")).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Inbox" })).toHaveCount(1);

    if (testInfo.project.name !== "desktop") await page.getByTestId("category-nav-trigger").click();
    await page.getByRole("button", { name: /^Work/ }).first().click();
    await expect(page.getByRole("heading", { level: 2, name: "Work" })).toHaveCount(1);
    if (testInfo.project.name !== "desktop") await page.getByTestId("category-nav-trigger").click();
    await page
      .getByRole("button", { name: /^Inbox/ })
      .first()
      .click();
    await expect(page.getByRole("heading", { level: 2, name: "Inbox" })).toHaveCount(1);
  });

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
    await expect(page.getByRole("button", { name: "Add list" })).toBeVisible();
  });
});

test.describe("deleting a category", () => {
  const openOptions = async (page: Page, name: string, isDesktop: boolean) => {
    if (!isDesktop) await page.getByTestId("category-nav-trigger").click();
    // The innermost element holding both the category's button and its options trigger
    const categoryRow = page
      .locator("div")
      .filter({ has: page.getByRole("button", { name: new RegExp(`^${name}`) }) })
      .filter({ has: page.getByRole("button", { name: "List options" }) })
      .last();
    if (isDesktop) await categoryRow.hover();
    await categoryRow.getByRole("button", { name: "List options" }).click();
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
    await expect(page.getByText("List deleted")).toBeVisible();
  });

  test("Undo brings a deleted list back", async ({ page }, testInfo) => {
    await openList(page);
    await openOptions(page, "Home", testInfo.project.name === "desktop");
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    const toast = page.locator("[data-toast-undo]", { hasText: "List deleted" });
    await expect(toast).toBeVisible();
    await expect(page.getByRole("button", { name: /^Home/ })).toHaveCount(0);

    const restore = page.waitForRequest(
      (r) => r.method() === "POST" && r.url().endsWith("/api/categories/c-home/restore"),
    );
    await toast.getByRole("button", { name: "Undo" }).click();
    await restore;
    await expect(page.getByRole("button", { name: /^Home/ }).first()).toBeVisible();
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

test("an iPhone that hasn't installed Ajot is told how, until it's dismissed", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "the offer is for Safari's Add to Home Screen");
  await mockApi(page, { setupHintSeen: false });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const offer = page.getByText("tap Share, then Add to Home Screen");
  await expect(offer).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: "Dismiss" }).click();
  await expect(offer).toHaveCount(0);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("#add-task-input")).toBeVisible({ timeout: 15000 });
  await expect(offer).toHaveCount(0);
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
  };

  test("a server with accounts only takes signups through an invite", async ({ page }) => {
    await signedOutAt(page, "/auth");
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
    await expect(page.getByText("New here? Ask someone on this server")).toBeVisible();
    await expect(page.getByRole("button", { name: "Create an account" })).toHaveCount(0);
  });

  test("a new server opens on its first account", async ({ page }) => {
    await signedOutAt(page, "/auth", true);
    await expect(
      page.getByRole("heading", { name: "Create the server's first account" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "I already have an account" }).click();
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  });

  test("an invite link opens on signing up with its invite", async ({ page }) => {
    await signedOutAt(page, "/invite/abc");
    await expect(page).toHaveURL(/\/auth$/);
    await expect(
      page.getByRole("heading", { name: "Sarah Murray invited you to Ajot" }),
    ).toBeVisible();
    await page.getByLabel("Name", { exact: true }).fill("Sam Okafor");
    await page.getByLabel("Username").fill("sam");
    await page.getByLabel("Password").fill("correct horse");

    const signup = page.waitForRequest((r) => r.url().endsWith("/api/auth/signup"));
    await page.getByRole("button", { name: "Create account" }).click();
    expect((await signup).postDataJSON()).toMatchObject({ username: "sam", invite: "abc" });
  });

  test("an invite that can't be looked up still signs up with it", async ({ page }) => {
    const lookup = page.waitForResponse("**/api/auth/invites/expired");
    await signedOutAt(page, "/invite/expired");
    await lookup;
    await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
    await expect(page.getByText("Signing up accepts your invite.")).toBeVisible();
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

test.describe("list sharing", () => {
  test("choosing a contact shares the list with them, and Undo removes them", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "opens the list's options from the sidebar");
    await openList(page);
    const pill = page
      .getByTestId("category-sidebar")
      .locator(".group\\/pill")
      .filter({ hasText: "Home" });
    await pill.hover();
    await pill.getByRole("button", { name: "List options" }).click();
    await page.getByTestId("category-share-btn").click();

    const sheet = page.getByRole("dialog", { name: "Share list" });
    await expect(sheet.getByText("Sam Okafor", { exact: true })).toBeVisible();
    const added = page.waitForRequest(
      (req) =>
        req.url().endsWith("/api/categories/c-home/collaborators") && req.method() === "POST",
    );
    await sheet.getByRole("combobox", { name: "Add someone" }).click();
    await page.getByRole("option", { name: /^Sarah Murray/ }).click();
    expect((await added).postDataJSON()).toEqual({ username: "sarah" });

    const toast = page.locator("[data-toast-undo]", { hasText: "Shared with Sarah Murray" });
    await expect(toast).toBeVisible();
    const removed = page.waitForRequest(
      (req) =>
        req.url().endsWith("/api/categories/c-home/collaborators/u-sarah") &&
        req.method() === "DELETE",
    );
    await toast.getByRole("button", { name: "Undo" }).click();
    await removed;
    await expect(sheet).toBeVisible();
    // Undoing the share is itself the undo: it offers no Undo of its own
    await expect(page.locator("[data-toast-undo]", { hasText: "Removed" })).toHaveCount(0);
  });

  test("removing someone offers Undo, which puts them back", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "opens the list's options from the sidebar");
    await openList(page);
    const pill = page
      .getByTestId("category-sidebar")
      .locator(".group\\/pill")
      .filter({ hasText: "Home" });
    await pill.hover();
    await pill.getByRole("button", { name: "List options" }).click();
    await page.getByTestId("category-share-btn").click();

    const sheet = page.getByRole("dialog", { name: "Share list" });
    const sam = sheet.getByText("Sam Okafor", { exact: true });
    await sam.hover();
    await sheet.getByRole("button", { name: "Remove" }).click();
    await expect(sam).toHaveCount(0);

    const toast = page.locator("[data-toast-undo]", { hasText: "Removed Sam Okafor" });
    const restored = page.waitForRequest(
      (req) =>
        req.url().endsWith("/api/categories/c-home/collaborators/u-sam/restore") &&
        req.method() === "POST",
    );
    await toast.getByRole("button", { name: "Undo" }).click();
    await restored;
    await expect(sam).toBeVisible();
    await expect(sheet).toBeVisible();
  });
});

test.describe("the Undo window", () => {
  const hide = (page: Page, hidden: boolean) =>
    page.evaluate(`(() => {
      if (${hidden}) {
        Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
        Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
      } else {
        delete document.hidden;
        delete document.visibilityState;
      }
      document.dispatchEvent(new Event("visibilitychange"));
    })()`);

  test("waits while the page is hidden, as when switching apps", async ({ page }) => {
    test.slow();
    await openList(page);
    await row(page, "Pick up dry cleaning").getByRole("checkbox").click();
    const toast = page.locator("[data-toast-undo]", { hasText: "Marked done" });
    await expect(toast).toBeVisible();

    await hide(page, true);
    await page.waitForTimeout(9000);
    await hide(page, false);
    await expect(toast).toBeVisible();
    await expect(toast).toHaveCount(0, { timeout: 10_000 });
  });

  test("pauses without sending the window a blur or focus of its own", async ({ page }) => {
    await openList(page);
    // As iOS returning to the app: no window focus event, and the document reports no focus
    await page.evaluate(`(() => {
      window.__focusEvents = 0;
      const count = (e) => { if (e.target === window) window.__focusEvents++; };
      window.addEventListener("blur", count, true);
      window.addEventListener("focus", count, true);
      document.hasFocus = () => false;
    })()`);
    await row(page, "Pick up dry cleaning").getByRole("checkbox").click();
    const toast = page.locator("[data-toast-undo]", { hasText: "Marked done" });
    await expect(toast).toBeVisible();
    await hide(page, true);
    await hide(page, false);
    expect(await page.evaluate("window.__focusEvents")).toBe(0);
    await expect(toast).toHaveCount(0, { timeout: 10_000 });
  });

  test("stays paused while the page shows but another window has focus", async ({ page }) => {
    // As on Android in split screen, with the other app focused
    test.slow();
    await openList(page);
    await row(page, "Pick up dry cleaning").getByRole("checkbox").click();
    const toast = page.locator("[data-toast-undo]", { hasText: "Marked done" });
    await expect(toast).toBeVisible();

    await page.evaluate(() => window.dispatchEvent(new FocusEvent("blur")));
    await hide(page, true);
    await hide(page, false);
    await page.waitForTimeout(9000);
    await expect(toast).toBeVisible();

    await page.evaluate(() => window.dispatchEvent(new FocusEvent("focus")));
    await expect(toast).toHaveCount(0, { timeout: 10_000 });
  });

  test("lasts longer on touch", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "a phone's window is longer than a pointer's");
    await openList(page);
    await row(page, "Pick up dry cleaning").getByRole("checkbox").click();
    const toast = page.locator("[data-toast-undo]", { hasText: "Marked done" });
    await expect(toast).toBeVisible();
    await page.waitForTimeout(6500);
    await expect(toast).toBeVisible();
  });
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
      await pill.getByRole("button", { name: "List options" }).click();
      await expect(page.getByRole("button", { name: "Rename" })).toBeVisible();
    } else {
      await page.getByTestId("category-nav-trigger").click();
      await expect(page.getByRole("button", { name: "Add list" })).toBeVisible();
    }
    await expectNoAxeViolations(page);
  });

  test("⌘Z / Ctrl+Z reaches a toast's Undo from inside the sheet", async ({ page }) => {
    await openList(page);
    await row(page, "Book flights")
      .getByRole("button", { name: /^Book flights/ })
      .click();
    const sheet = page.locator('[data-slot="drawer-content"]');
    const subtask = sheet.getByRole("checkbox", { name: "Compare Tuesday and Wednesday fares" });
    await subtask.click();
    await expect(subtask).toBeChecked();
    await expect(page.getByRole("button", { name: "Undo" })).toHaveAttribute(
      "aria-keyshortcuts",
      /Control\+Z/,
    );

    await page.keyboard.press("ControlOrMeta+z");
    await expect(subtask).not.toBeChecked();
    await expect(page.locator("[data-toast-undo]")).toHaveCount(0);
    await expect(sheet).toBeVisible();
  });

  test("the sheet's Close shows on keyboard focus and closes it", async ({ page }) => {
    await openList(page);
    await row(page, "Book flights")
      .getByRole("button", { name: /^Book flights/ })
      .click();
    const sheet = page.locator('[data-slot="drawer-content"]');
    const close = sheet.getByRole("button", { name: "Close" });
    expect((await close.boundingBox())?.width).toBeLessThanOrEqual(1);
    await sheet.getByRole("button", { name: "Delete task" }).focus();
    await page.keyboard.press("Tab");
    await expect(close).toBeFocused();
    expect((await close.boundingBox())?.width).toBeGreaterThan(20);
    await page.keyboard.press("Enter");
    await expect(sheet).toHaveCount(0);
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

test.describe("removing a contact", () => {
  const openPeople = async (page: Page) => {
    await mockApi(page);
    await page.goto("/people", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("@sarah")).toBeVisible();
  };

  const remove = async (page: Page, name: string) => {
    const contactRow = page
      .locator("div")
      .filter({ hasText: name })
      .filter({ has: page.getByRole("button", { name: "Remove" }) });
    await contactRow.last().hover();
    await contactRow.last().getByRole("button", { name: "Remove" }).click();
  };

  test("Undo brings them back", async ({ page }) => {
    await openPeople(page);
    await remove(page, "Sarah Murray");

    const toast = page.locator("[data-toast-undo]", { hasText: "Removed Sarah Murray" });
    await expect(toast).toBeVisible();
    await expect(page.getByText("@sarah")).toHaveCount(0);

    const restore = page.waitForRequest(
      (r) => r.method() === "POST" && r.url().endsWith("/api/contacts/ct-u-sarah/restore"),
    );
    await toast.getByRole("button", { name: "Undo" }).click();
    await restore;
    await expect(page.getByText("@sarah")).toBeVisible();
  });

  test("a remove the server refuses says so and keeps them", async ({ page }) => {
    await openPeople(page);
    await page.route("**/api/contacts/*", (route) =>
      route.request().method() === "DELETE"
        ? route.fulfill({ status: 403, contentType: "application/json", body: '{"error":"no"}' })
        : route.fallback(),
    );
    await remove(page, "Sarah Murray");

    await expect(page.getByText("Couldn't remove Sarah Murray. Try again.")).toBeVisible();
    await expect(page.getByText("@sarah")).toBeVisible();
  });

  /** Each contact write that reached the server, and each that couldn't. */
  const contactWrites = (page: Page) => {
    const writes = { sent: [] as string[], failed: [] as string[] };
    const isWrite = (r: Request) =>
      new URL(r.url()).pathname.startsWith("/api/contacts/") && r.method() !== "GET";
    const named = (r: Request) => `${r.method()} ${new URL(r.url()).pathname}`;
    page.on("requestfinished", (r) => isWrite(r) && writes.sent.push(named(r)));
    page.on("requestfailed", (r) => isWrite(r) && writes.failed.push(named(r)));
    return writes;
  };

  // page.route still answers while the context is offline, so the mocked API refuses too
  const dropConnection = async (page: Page) => {
    const refuse = (route: Route) => route.abort("internetdisconnected");
    await page.context().setOffline(true);
    await page.route("**/api/**", refuse);
    return async () => {
      await page.unroute("**/api/**", refuse);
      await page.context().setOffline(false);
    };
  };

  const pressUndo = (page: Page) =>
    page
      .locator("[data-toast-undo]", { hasText: "Removed Sarah Murray" })
      .getByRole("button", { name: "Undo" })
      .click();

  const removedThenRestored = [
    "DELETE /api/contacts/ct-u-sarah",
    "POST /api/contacts/ct-u-sarah/restore",
  ];

  test("Undo pressed after the connection drops lands once it's back", async ({ page }) => {
    await openPeople(page);
    const writes = contactWrites(page);
    await remove(page, "Sarah Murray");
    await expect.poll(() => writes.sent).toEqual(["DELETE /api/contacts/ct-u-sarah"]);

    const reconnect = await dropConnection(page);
    await pressUndo(page);
    await expect.poll(() => writes.failed).toContain("POST /api/contacts/ct-u-sarah/restore");
    await expect(page.getByText("@sarah")).toBeVisible();
    await expect(page.getByText("Couldn't bring back Sarah Murray")).toHaveCount(0);

    await reconnect();
    await expect.poll(() => writes.sent, { timeout: 15_000 }).toEqual(removedThenRestored);
    await expect(page.getByText("@sarah")).toBeVisible();
    await expect(page.getByText("Couldn't bring back Sarah Murray")).toHaveCount(0);
  });

  test("removed and undone with no connection, both reach the server in order once back", async ({
    page,
  }) => {
    await openPeople(page);
    const writes = contactWrites(page);
    const reconnect = await dropConnection(page);
    await remove(page, "Sarah Murray");
    await expect(page.getByText("@sarah")).toHaveCount(0);
    await expect.poll(() => writes.failed).toContain("DELETE /api/contacts/ct-u-sarah");
    await pressUndo(page);
    await expect(page.getByText("@sarah")).toBeVisible();

    await reconnect();
    await expect.poll(() => writes.sent, { timeout: 15_000 }).toEqual(removedThenRestored);
    await expect(page.getByText("@sarah")).toBeVisible();
    await expect(page.getByText(/Couldn't (remove|bring back)/)).toHaveCount(0);
  });

  test("a connection that drops as the remove lands doesn't hold up its Undo", async ({ page }) => {
    await openPeople(page);
    const writes = contactWrites(page);
    let reconnect = async () => {};
    await page.route("**/api/contacts/*", async (route) => {
      if (route.request().method() === "DELETE") {
        await route.fallback();
        reconnect = await dropConnection(page);
      } else await route.fallback();
    });
    await remove(page, "Sarah Murray");
    await expect.poll(() => writes.sent).toEqual(["DELETE /api/contacts/ct-u-sarah"]);
    await pressUndo(page);
    await expect(page.getByText("@sarah")).toBeVisible();

    await reconnect();
    await expect.poll(() => writes.sent, { timeout: 15_000 }).toEqual(removedThenRestored);
    await expect(page.getByText("@sarah")).toBeVisible();
  });

  test("one removed on another device while the list loads is gone once it has", async ({
    page,
  }) => {
    const rejected: string[] = [];
    page.on(
      "console",
      (m) => m.text().startsWith("[sse] write rejected") && rejected.push(m.text()),
    );
    await mockApi(page);
    let streams = 0;
    await page.route("**/api/events*", (route) => {
      const removal = { model: "contacts", action: "delete", data: { id: "ct-u-sarah" } };
      const events =
        ++streams === 1 ? `event: data-changed\ndata: ${JSON.stringify(removal)}\n\n` : "";
      return route.fulfill({
        headers: { "content-type": "text/event-stream" },
        body: `retry: 60000\n\n${events}`,
      });
    });
    await page.route("**/api/contacts", async (route) => {
      await new Promise((loaded) => setTimeout(loaded, 1000));
      await route.fallback();
    });
    await page.goto("/people", { waitUntil: "domcontentloaded" });

    await expect(page.getByText("@sam")).toBeVisible();
    await expect(page.getByText("@sarah")).toHaveCount(0);
    expect(rejected).toEqual([]);
  });
});
