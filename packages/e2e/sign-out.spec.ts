import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { mockApi, mockData } from "./helpers/mock-api";

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

// mockApi signs in on every load; a page reloaded after signing out must stay signed out
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

test("signing out with no service worker and no answer from the server is immediate", async ({
  page,
}) => {
  await mockApi(page);
  await page.route(/\/api\/(auth\/logout|push\/)/, () => {});
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#add-task-input");
  expect(await page.evaluate("navigator.serviceWorker.getRegistration()")).toBeUndefined();

  await page.getByRole("button", { name: /^Sync settings/ }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible({ timeout: 1000 });
});

test("signing out drops the push subscription while the session still works", async ({ page }) => {
  await page.addInitScript(`
    navigator.serviceWorker.getRegistration = async () => ({
      active: {},
      pushManager: {
        getSubscription: async () => ({
          endpoint: "https://fcm.googleapis.com/fcm/send/e2e",
          unsubscribe: async () => {
            window.unsubscribedFromPushService = true;
            return true;
          },
        }),
      },
    });
  `);
  await mockApi(page);
  const sent: { path: string; auth?: string; body?: unknown }[] = [];
  await page.route(/\/api\/(auth\/logout|push\/unsubscribe)/, async (route) => {
    const request = route.request();
    sent.push({
      path: new URL(request.url()).pathname,
      auth: request.headers().authorization,
      body: request.postDataJSON(),
    });
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#add-task-input");

  await signOut(page);
  await expect.poll(() => sent.length).toBe(2);
  expect(sent).toEqual([
    {
      path: "/api/push/unsubscribe",
      auth: "Bearer mock-token",
      body: { endpoint: "https://fcm.googleapis.com/fcm/send/e2e" },
    },
    { path: "/api/auth/logout", auth: "Bearer mock-token", body: null },
  ]);
  expect(await page.evaluate("window.unsubscribedFromPushService")).toBe(true);
});

test("signing out ends the session even when the push service never answers", async ({ page }) => {
  await page.addInitScript(`
    navigator.serviceWorker.getRegistration = async () => ({
      active: {},
      pushManager: {
        getSubscription: async () => ({
          endpoint: "https://fcm.googleapis.com/fcm/send/e2e",
          unsubscribe: () => new Promise(() => {}),
        }),
      },
    });
  `);
  await mockApi(page);
  const sent: string[] = [];
  await page.route(/\/api\/(auth\/logout|push\/unsubscribe)/, async (route) => {
    sent.push(new URL(route.request().url()).pathname);
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#add-task-input");

  await signOut(page);
  await expect.poll(() => sent).toEqual(["/api/push/unsubscribe", "/api/auth/logout"]);
});

test("edits queued by one account are never sent as the next", async ({ context }) => {
  const page = await context.newPage();
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

/** What each account's GETs answer, by the token they carry. POSTs to /api/tasks fail, so edits stay queued. */
const serveByAccount = async (context: BrowserContext) => {
  const mike = mockData();
  const [template] = mike.tasks;
  const alex = {
    tasks: [
      {
        ...template,
        id: "t-alex",
        title: "Plan the garden",
        description: null,
        userId: ALEX.id,
        user: { id: ALEX.id, name: ALEX.name },
      },
    ],
    categories: [
      {
        ...mike.categories[0],
        id: "c-alex",
        name: "Allotment",
        userId: ALEX.id,
        user: { name: ALEX.name },
        collaborators: [],
      },
    ],
    contacts: [],
    notes: [],
  };
  const lists: Record<string, Record<string, unknown>> = { "mike-token": mike, "alex-token": alex };
  const postedTasks: { title?: string; token?: string }[] = [];

  await context.addInitScript(() => {
    if (localStorage.getItem("e2e-seeded")) return;
    localStorage.setItem("e2e-seeded", "1");
    localStorage.setItem("newtab-todo-swipe-hint-seen", "1");
    localStorage.setItem("newtab-todo-setup-hint-dismissed", '["install","background"]');
    localStorage.setItem("newtab-todo-token", "mike-token");
    localStorage.setItem("newtab-todo-user-id", "u-mike");
    localStorage.setItem(
      "newtab-todo-user-info",
      JSON.stringify({ id: "u-mike", name: "Mike Murray", username: "mike" }),
    );
  });
  await context.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const token = request.headers().authorization?.replace("Bearer ", "");
    if (path.startsWith("/api/events")) return route.fulfill({ status: 204, body: "" });
    if (path === "/api/config")
      return route.fulfill({ json: { vapidPublicKey: "", awaitingFirstUser: false } });
    if (path === "/api/auth/login")
      return route.fulfill({
        json: { userId: ALEX.id, token: "alex-token", name: ALEX.name, username: ALEX.username },
      });
    if (request.method() === "GET")
      return route.fulfill({ json: (token && lists[token]?.[path.slice("/api/".length)]) ?? [] });
    if (path === "/api/tasks") {
      postedTasks.push({ title: request.postDataJSON()?.title, token });
      return route.fulfill({ status: 503 });
    }
    return route.fulfill({ json: { ok: true } });
  });
  return postedTasks;
};

const openTab = async (context: BrowserContext) => {
  const page = await context.newPage();
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#add-task-input");
  return page;
};

const signInAsAlex = async (page: Page) => {
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Username").fill(ALEX.username);
  await page.getByLabel("Password").fill("correct horse");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Plan the garden")).toBeVisible();
};

test("someone else signing in over edits a lapsed session left opens on their lists", async ({
  page,
}) => {
  await signInOnce(page);
  await mockApi(page, { signedIn: false });
  await page.route("**/api/tasks", (route) =>
    route.request().method() === "POST" ? route.fulfill({ status: 401 }) : route.fallback(),
  );
  await page.route("**/api/auth/login", (route) =>
    route.fulfill({
      json: { userId: ALEX.id, token: "alex-token", name: ALEX.name, username: ALEX.username },
    }),
  );
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#add-task-input");
  await page.fill("#add-task-input", "Added as it expired");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();

  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Username").fill(ALEX.username);
  await page.getByLabel("Password").fill("correct horse");
  await page.getByRole("button", { name: "Sign in" }).click();
  // It starts again, so Mike's edit leaves the screen, on the list rather than the form
  await expect(page.getByText("Added as it expired")).toBeHidden();
  await expect(page.locator("#add-task-input")).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.locator("#add-task-input")).toBeVisible();
});

const workerSession = (page: Page) =>
  page.evaluate(`new Promise((resolve) => {
    const open = indexedDB.open("newtab-todo-snapshot");
    open.onsuccess = () => {
      const db = open.result;
      const store = db.transaction("queries").objectStore("queries");
      const token = store.get("session");
      const user = store.get("session-user");
      user.onsuccess = () => { resolve([token.result ?? null, user.result ?? null]); db.close(); };
    };
  })`);

test("signing in as someone else in one tab switches every tab to them", async ({ context }) => {
  await serveByAccount(context);
  const tabA = await openTab(context);
  const tabB = await openTab(context);
  await expect(tabB.getByText("Renew passport")).toBeVisible();

  await signOut(tabA);
  await expect(tabB.getByRole("button", { name: "Sign in" })).toBeVisible();
  await signInAsAlex(tabA);

  await expect(tabB.getByText("Plan the garden")).toBeVisible();
  await expect(tabB.getByText("Allotment")).toBeVisible();
  await expect(tabB.getByText("Renew passport")).toBeHidden();
  await expect(tabB.getByText("Groceries")).toBeHidden();
  await tabB.getByRole("button", { name: /^Sync settings/ }).click();
  const account = tabB.getByRole("dialog", { name: "Account" });
  await expect(account.getByText("Alex Doe")).toBeVisible();
  await expect(account.getByText("@alex")).toBeVisible();
  // The PWA's worker saves lists with this pair, and drops a push's rows for anyone else
  await expect.poll(() => workerSession(tabB)).toEqual(["alex-token", ALEX.id]);
  await expect.poll(() => workerSession(tabA)).toEqual(["alex-token", ALEX.id]);
});

test("edits queued in one tab are never sent as the account another tab signs in", async ({
  context,
}) => {
  const postedTasks = await serveByAccount(context);
  const tabA = await openTab(context);
  const tabB = await openTab(context);
  await tabA.fill("#add-task-input", "Mike's unsent task");
  await tabA.keyboard.press("Enter");
  await expect(tabA.getByText("Mike's unsent task")).toBeVisible();
  await expect.poll(() => postedTasks.length).toBeGreaterThan(0);

  await signOut(tabB);
  await signInAsAlex(tabB);

  await expect(tabA.getByText("Plan the garden")).toBeVisible();
  await expect(tabA.getByText("Mike's unsent task")).toBeHidden();
  await tabA.waitForTimeout(1500);
  expect(postedTasks.filter((t) => t.token === "alex-token")).toEqual([]);
});
