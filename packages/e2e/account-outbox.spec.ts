import { type BrowserContext, type Route } from "@playwright/test";
import { test, expect, type Page } from "./fixtures";
import { createCategory } from "./helpers/app";
import { mockApi, mockData } from "./helpers/mock-api";

test.use({ serviceWorkers: "block" });

const MIKE = { id: "u-mike", name: "Mike Murray", username: "mike" };
const ALEX = { id: "u-alex", name: "Alex Doe", username: "alex" };

type Account = typeof MIKE;

/** Signed in as `account` on the context's first page load only: signing out must stick. */
const signInFirst = (context: BrowserContext, account: Account) =>
  context.addInitScript(`(() => {
    if (localStorage.getItem("e2e-signed-in-once")) return;
    localStorage.setItem("e2e-signed-in-once", "1");
    localStorage.setItem("newtab-todo-token", "token-${account.id}");
    localStorage.setItem("newtab-todo-user-id", "${account.id}");
    localStorage.setItem("newtab-todo-user-info", ${JSON.stringify(JSON.stringify(account))});
  })()`);

const posts = async (page: Page, path: "/api/tasks" | "/api/categories") => {
  const state = { refusing: true, sent: [] as string[] };
  await page.route(`**${path}`, (route) => {
    const request = route.request();
    if (request.method() !== "POST") return route.fallback();
    if (state.refusing) return route.fulfill({ status: 503 });
    const body = request.postDataJSON() as { title?: string; name?: string };
    state.sent.push(body.title ?? body.name ?? "");
    return route.fallback();
  });
  return state;
};

const answerSignIn = (page: Page, account: Account) =>
  page.route("**/api/auth/login", (route) =>
    route.fulfill({
      json: { userId: account.id, token: `token-${account.id}`, ...account },
    }),
  );

const signOut = async (page: Page) => {
  await page.getByRole("button", { name: /^Sync settings/ }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
};

const signIn = async (page: Page, account: Account) => {
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Username").fill(account.username);
  await page.getByLabel("Password").fill("password");
  await page.locator("form").getByRole("button", { name: "Sign in" }).click();
  await page.waitForSelector("#add-task-input");
};

/** Signed in as whoever the context last left signed in. */
const openPage = async (context: BrowserContext) => {
  const page = await context.newPage();
  await mockApi(page, { signedIn: false });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#add-task-input");
  return page;
};

const row = (page: Page, title: string) =>
  page.locator("[data-task-id]", { hasText: title }).first();

const addTask = async (page: Page, title: string) => {
  await page.fill("#add-task-input", title);
  await page.keyboard.press("Enter");
  await expect(row(page, title)).toBeVisible();
};

// A list rather than a task: the lists show another account's own tasks nowhere, but every list
// this device holds is in the sidebar
const listButton = (page: Page, name: string) =>
  page.getByTestId("category-sidebar").getByRole("button", { name: new RegExp(`^${name}`) });

const addList = async (page: Page, name: string) => {
  await createCategory(page, name, "sidebar");
  await expect(listButton(page, name)).toBeVisible();
};

const backOnline = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event("online")));

test("an account's held edits come back and are sent when it signs in again on the same page", async ({
  context,
}) => {
  await signInFirst(context, MIKE);
  const page = await openPage(context);
  const sent = await posts(page, "/api/categories");
  await answerSignIn(page, MIKE);
  await addList(page, "Held for Mike");

  await signOut(page);
  await expect(listButton(page, "Held for Mike")).toHaveCount(0);

  await signIn(page, MIKE);
  await expect(listButton(page, "Held for Mike")).toBeVisible();
  sent.refusing = false;
  await backOnline(page);
  await expect.poll(() => sent.sent, { timeout: 15_000 }).toEqual(["Held for Mike"]);
  await page.waitForTimeout(1500);
  expect(sent.sent).toEqual(["Held for Mike"]);
});

test("an account's held edits are sent once it signs in on a page that opened signed out", async ({
  context,
}) => {
  await signInFirst(context, MIKE);
  const page = await openPage(context);
  const sent = await posts(page, "/api/categories");
  await answerSignIn(page, MIKE);
  await addList(page, "Held for Mike");
  await signOut(page);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("#add-task-input");
  await expect(listButton(page, "Held for Mike")).toHaveCount(0);

  await signIn(page, MIKE);
  await expect(listButton(page, "Held for Mike")).toBeVisible();
  sent.refusing = false;
  await backOnline(page);
  await expect.poll(() => sent.sent, { timeout: 15_000 }).toEqual(["Held for Mike"]);
});

test("an edit on its way as its account signs out doesn't hold up the next account's", async ({
  context,
}) => {
  await signInFirst(context, MIKE);
  const page = await openPage(context);
  await answerSignIn(page, ALEX);
  const attempt = { landed: Promise.resolve() };
  await page.route("**/api/categories", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    let land = () => {};
    attempt.landed = new Promise((resolve) => (land = resolve));
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await route.fulfill({ status: 503 });
    land();
  });
  const tasks = await posts(page, "/api/tasks");
  tasks.refusing = false;
  const sending = page.waitForRequest(
    (r) => r.method() === "POST" && r.url().endsWith("/api/categories"),
  );
  await addList(page, "Held for Mike");
  await sending;
  await signOut(page);
  await signIn(page, ALEX);
  await attempt.landed;

  await page.fill("#add-task-input", "Alex's first task");
  await page.keyboard.press("Enter");
  await expect.poll(() => tasks.sent, { timeout: 15_000 }).toEqual(["Alex's first task"]);
});

test("every tab takes a signed-out account's held edits off screen, and the next never sends them", async ({
  context,
}) => {
  await signInFirst(context, MIKE);
  const first = await openPage(context);
  const second = await openPage(context);
  const sent = [await posts(first, "/api/categories"), await posts(second, "/api/categories")];
  await answerSignIn(first, ALEX);
  await addList(second, "Held for Mike");
  await expect(listButton(first, "Held for Mike")).toBeVisible();

  await signOut(first);
  for (const page of [first, second])
    await expect(listButton(page, "Held for Mike")).toHaveCount(0);

  await signIn(first, ALEX);
  for (const state of sent) state.refusing = false;
  for (const page of [first, second]) await backOnline(page);
  await first.waitForTimeout(2000);
  for (const page of [first, second])
    await expect(listButton(page, "Held for Mike")).toHaveCount(0);
  expect(sent.flatMap((state) => state.sent)).toEqual([]);
});

// The tab never hears that the leader settled its edit, as when it was frozen then
const missSettlements = (page: Page) =>
  page.addInitScript(`(() => {
    const listen = BroadcastChannel.prototype.addEventListener;
    BroadcastChannel.prototype.addEventListener = function (type, listener, options) {
      const heard = (event) => { if (event.data?.type !== "settled") listener(event); };
      return listen.call(this, type, heard, options);
    };
  })()`);

const holdsLeadership = (page: Page) =>
  page.evaluate(
    `navigator.locks.query().then((s) => s.held.some((l) => l.name === "offline-executor-leader"))`,
  );

test("a tab that missed the word its edit was settled settles it once the outbox no longer holds it", async ({
  context,
}) => {
  const data = mockData();
  const leader = await context.newPage();
  await mockApi(leader, { data });
  await leader.route("**/api/tasks", (route) =>
    route.request().method() === "POST" &&
    (route.request().postDataJSON() as { title: string }).title === "Refused"
      ? route.fulfill({ status: 400, json: { error: "no" } })
      : route.fallback(),
  );
  await leader.goto("/", { waitUntil: "domcontentloaded" });
  await leader.waitForSelector("#add-task-input");
  await expect.poll(() => holdsLeadership(leader)).toBe(true);

  const other = await context.newPage();
  await missSettlements(other);
  await mockApi(other, { data });
  await other.goto("/", { waitUntil: "domcontentloaded" });
  await other.waitForSelector("#add-task-input");

  const refused = leader.waitForResponse((r) => r.request().method() === "POST");
  await addTask(other, "Refused");
  await refused;
  await other.waitForTimeout(500);
  // Still shown: the refusal never reached it
  await expect(row(other, "Refused")).toBeVisible();

  // Shown again, as a frozen tab is
  await other.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(row(other, "Refused")).toHaveCount(0);
});

test.describe("saved lists", () => {
  const saved = (page: Page, key: string) =>
    page.evaluate(`new Promise((resolve) => {
      const open = indexedDB.open("newtab-todo-snapshot");
      open.onsuccess = () => {
        const db = open.result;
        const get = db.transaction("queries").objectStore("queries").get("${key}");
        get.onsuccess = () => { resolve(get.result ?? null); db.close(); };
      };
    })`);

  test("a list saved for the next account takes the last account's other lists with it", async ({
    context,
  }) => {
    const mike = await context.newPage();
    await mockApi(mike);
    await mike.goto("/", { waitUntil: "domcontentloaded" });
    await expect(mike.getByText("Groceries").first()).toBeVisible();
    await expect.poll(() => saved(mike, "categories")).not.toBeNull();
    await expect.poll(() => saved(mike, "owner")).toBe(MIKE.id);
    await mike.close();

    // Alex's tasks answer; the rest of the server is slow and never does
    const alex = await context.newPage();
    await alex.addInitScript(`(() => {
      localStorage.setItem("newtab-todo-token", "token-${ALEX.id}");
      localStorage.setItem("newtab-todo-user-id", "${ALEX.id}");
      localStorage.setItem("newtab-todo-user-info", ${JSON.stringify(JSON.stringify(ALEX))});
    })()`);
    await alex.route("**/api/**", (route: Route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.startsWith("/api/events")) return route.fulfill({ status: 204, body: "" });
      if (path === "/api/tasks") return route.fulfill({ json: [] });
    });
    await alex.goto("/", { waitUntil: "domcontentloaded" });
    await expect.poll(() => saved(alex, "owner")).toBe(ALEX.id);
    expect(await saved(alex, "categories")).toBeNull();

    await alex.reload({ waitUntil: "domcontentloaded" });
    await alex.waitForSelector("#add-task-input");
    await alex.waitForTimeout(500);
    await expect(alex.getByText("Groceries")).toHaveCount(0);
  });
});

test.describe("reading the outbox", () => {
  const countJournalReads = (page: Page) =>
    page.addInitScript(`(() => {
      window.journalReads = 0;
      const getItem = Storage.prototype.getItem;
      Storage.prototype.getItem = function (key) {
        if (String(key).startsWith("outbox-journal:tx:")) window.journalReads++;
        return getItem.call(this, key);
      };
    })()`);

  const journalReads = (page: Page) =>
    page.evaluate(() => (window as unknown as { journalReads: number }).journalReads);

  test("the leader retrying its own edit doesn't have other tabs read the outbox", async ({
    context,
  }) => {
    const data = mockData();
    const leader = await context.newPage();
    await mockApi(leader, { data });
    const sent = await posts(leader, "/api/tasks");
    await leader.goto("/", { waitUntil: "domcontentloaded" });
    await leader.waitForSelector("#add-task-input");
    await expect.poll(() => holdsLeadership(leader)).toBe(true);

    const other = await context.newPage();
    await countJournalReads(other);
    await mockApi(other, { data });
    await other.goto("/", { waitUntil: "domcontentloaded" });
    await other.waitForSelector("#add-task-input");

    let attempts = 0;
    leader.on(
      "request",
      (r) => r.method() === "POST" && r.url().endsWith("/api/tasks") && attempts++,
    );
    await addTask(leader, "Retried by the leader");
    await expect.poll(() => attempts, { timeout: 15_000 }).toBeGreaterThanOrEqual(3);
    expect(await journalReads(other)).toBe(0);
    expect(sent.sent).toEqual([]);
  });

  test("an edit in another tab has the leader read it once", async ({ context }) => {
    const data = mockData();
    const leader = await context.newPage();
    await countJournalReads(leader);
    await mockApi(leader, { data });
    await leader.goto("/", { waitUntil: "domcontentloaded" });
    await leader.waitForSelector("#add-task-input");
    await expect.poll(() => holdsLeadership(leader)).toBe(true);

    const other = await context.newPage();
    await mockApi(other, { data });
    await other.goto("/", { waitUntil: "domcontentloaded" });
    await other.waitForSelector("#add-task-input");

    const sent = leader.waitForRequest(
      (r) => r.method() === "POST" && r.url().endsWith("/api/tasks"),
    );
    await addTask(other, "Read once");
    await sent;
    await leader.waitForTimeout(1000);
    // Listed and loaded in one read, then one each as the leader marks it sent and checks the mark
    // landed in IndexedDB
    expect(await journalReads(leader)).toBeLessThanOrEqual(3);
  });
});
