import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { mockApi } from "./helpers/mock-api";

// Two accounts on one device, against mocked /api: what one leaves behind when they sign out
// must never reach the next.

test.use({ serviceWorkers: "block" });

const ALEX = { id: "u-alex", name: "Alex Doe", username: "alex" };

const savedTasks = (page: Page) =>
  page.evaluate(`new Promise((resolve) => {
    const open = indexedDB.open("newtab-todo-snapshot");
    open.onsuccess = () => {
      const db = open.result;
      const get = db.transaction("queries").objectStore("queries").get("tasks");
      get.onsuccess = () => { resolve(get.result?.length ?? 0); db.close(); };
    };
  })`);

// Signing out drops the push subscription first, which waits for a service worker; these specs
// block it, so there's no subscription to wait for
const noServiceWorker = (page: Page) =>
  page.addInitScript(() => {
    Object.defineProperty(navigator.serviceWorker, "ready", {
      get: () => Promise.resolve({ pushManager: { getSubscription: async () => null } }),
    });
  });

// mockApi signs in on every load; signing out with edits queued reloads the page, which must stay
// signed out
const signInOnce = (page: Page) =>
  page.addInitScript(() => {
    if (sessionStorage.getItem("signed-in-once")) return;
    sessionStorage.setItem("signed-in-once", "1");
    localStorage.setItem("newtab-todo-token", "mock-token");
    localStorage.setItem("newtab-todo-user-id", "u-mike");
    localStorage.setItem(
      "newtab-todo-user-info",
      JSON.stringify({ id: "u-mike", name: "Mike Murray", username: "mike" }),
    );
  });

const signOut = async (page: Page) => {
  await page.getByRole("button", { name: /^Sync settings/ }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
};

/** A page signed in as Alex. `answer` serves /api; by default it never does, as on a slow network. */
const openAsAlex = async (
  context: BrowserContext,
  answer: (path: string, method: string, body: unknown) => unknown = () => undefined,
) => {
  const page = await context.newPage();
  await page.addInitScript((alex) => {
    localStorage.setItem("newtab-todo-token", "alex-token");
    localStorage.setItem("newtab-todo-user-id", alex.id);
    localStorage.setItem("newtab-todo-user-info", JSON.stringify(alex));
  }, ALEX);
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/api/events")) return route.fulfill({ status: 204, body: "" });
    const json = answer(path, request.method(), request.postDataJSON());
    if (json !== undefined) return route.fulfill({ json });
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#add-task-input");
  return page;
};

test("the next account doesn't open on the lists the last one saved", async ({ context }) => {
  const page = await context.newPage();
  await noServiceWorker(page);
  await mockApi(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Renew passport")).toBeVisible();
  await expect.poll(() => savedTasks(page)).toBeGreaterThan(0);

  await signOut(page);
  await expect(page.getByText("Renew passport")).toBeHidden();
  await expect(page.getByText("Groceries")).toBeHidden();
  await expect.poll(() => savedTasks(page)).toBe(0);
  // Left open, it would refetch with Alex's token from the mock, which answers with Mike's lists
  await page.close();

  // Mike's tasks aren't in Alex's Inbox anyway, but the lists would be in the sidebar
  const next = await openAsAlex(context);
  await next.waitForTimeout(500);
  await expect(next.getByText("Groceries")).toBeHidden();
});

test("edits queued by one account are never sent as the next", async ({ context }) => {
  const page = await context.newPage();
  await noServiceWorker(page);
  await signInOnce(page);
  await mockApi(page, { signedIn: false });
  // The server is down, so the edit stays queued
  await page.route("**/api/tasks", (route) =>
    route.request().method() === "POST" ? route.fulfill({ status: 503 }) : route.fallback(),
  );
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#add-task-input");
  await page.fill("#add-task-input", "Mike's unsent task");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Mike's unsent task")).toBeVisible();
  await signOut(page);
  await page.close();

  const sent: unknown[] = [];
  const next = await openAsAlex(context, (path, method, body) => {
    if (method === "GET") return [];
    if (path === "/api/tasks" && method === "POST") sent.push(body);
    return body ?? {};
  });
  await next.waitForTimeout(1500);
  await expect(next.getByText("Mike's unsent task")).toBeHidden();
  expect(sent).toEqual([]);

  // Kept for Mike, and sent once he's back
  await next.close();
  const back = await context.newPage();
  const resent: { title?: string; userId?: string }[] = [];
  await mockApi(back);
  await back.route("**/api/tasks", (route) => {
    if (route.request().method() === "POST") resent.push(route.request().postDataJSON());
    return route.fallback();
  });
  await back.goto("/", { waitUntil: "domcontentloaded" });
  await expect(back.getByText("Mike's unsent task")).toBeVisible();
  await expect.poll(() => resent.map((t) => t.title)).toContain("Mike's unsent task");
  expect(resent.find((t) => t.title === "Mike's unsent task")?.userId).toBe("u-mike");
});

test("edits queued as the session expires are sent once the account is back", async ({
  context,
}) => {
  const page = await context.newPage();
  await mockApi(page);
  await page.route("**/api/tasks", (route) =>
    route.request().method() === "POST" ? route.fulfill({ status: 401 }) : route.fallback(),
  );
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#add-task-input");
  await page.fill("#add-task-input", "Added as it expired");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await page.close();

  const back = await context.newPage();
  const sent: { title?: string }[] = [];
  await mockApi(back);
  await back.route("**/api/tasks", (route) => {
    if (route.request().method() === "POST") sent.push(route.request().postDataJSON());
    return route.fallback();
  });
  await back.goto("/", { waitUntil: "domcontentloaded" });
  await expect.poll(() => sent.map((t) => t.title)).toContain("Added as it expired");
});
