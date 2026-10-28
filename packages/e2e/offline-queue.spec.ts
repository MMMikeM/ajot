import {
  test,
  expect,
  type BrowserContext,
  type Page,
  type Request,
  type Route,
} from "@playwright/test";
import { mockApi, mockData } from "./helpers/mock-api";

// Tabs of one origin share an outbox, and one of them, the leader, sends it. Against mocked /api,
// with every tab answered from the same data, as one server would.

test.use({ serviceWorkers: "block" });

type Data = ReturnType<typeof mockData>;
type Task = Data["tasks"][number];

const WRITE = /\/api\/(tasks|categories|notes|contacts)(\/|$)/;

/**
 * Each write a page sent that wasn't refused, as "METHOD path title-or-id", in the order sent. A
 * response nobody reads can finish after a later one, so the order is when each was sent.
 */
const recordWrites = (page: Page) => {
  const writes: { request: Request; name: string }[] = [];
  const refused = new Set<Request>();
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (request.method() === "GET" || !WRITE.test(path)) return;
    const body = (request.postDataJSON() ?? {}) as { title?: string; id?: string };
    writes.push({
      request,
      name: `${request.method()} ${path} ${body.title ?? body.id ?? ""}`.trim(),
    });
  });
  page.on("requestfailed", (request) => refused.add(request));
  page.on("response", (response) => response.status() >= 400 && refused.add(response.request()));
  return () => writes.filter((w) => !refused.has(w.request)).map((w) => w.name);
};

/** Waits for these writes, then for a while longer, so one sent twice shows. */
const expectSentOnce = async (sent: () => string[], expected: string[]) => {
  await expect.poll(sent, { timeout: 15_000 }).toEqual(expected);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  expect(sent()).toEqual(expected);
};

/** Keeps the tasks each write changes, so a page loaded later sees them. */
const storeTasks = (page: Page, data: Data) =>
  page.route("**/api/tasks", async (route) => {
    const request = route.request();
    const body = (request.postDataJSON() ?? {}) as Partial<Task> & { id: string };
    const index = data.tasks.findIndex((t) => t.id === body.id);
    if (request.method() === "POST" && index < 0) data.tasks.push({ ...data.tasks[0], ...body });
    if (request.method() === "PUT" && index >= 0) Object.assign(data.tasks[index], body);
    if (request.method() === "DELETE" && index >= 0) data.tasks.splice(index, 1);
    await route.fallback();
  });

const holdsLeadership = (page: Page) =>
  page.evaluate(
    `navigator.locks.query().then((s) => s.held.some((l) => l.name === "offline-executor-leader"))`,
  );

const open = async (context: BrowserContext, data: Data, options: { signedIn?: boolean } = {}) => {
  const page = await context.newPage();
  await mockApi(page, { data, ...options });
  await storeTasks(page, data);
  const sent = recordWrites(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#add-task-input");
  return { page, sent };
};

/** The first tab, once it leads, and a second that doesn't. */
const openTwo = async (context: BrowserContext, options: { signedIn?: boolean } = {}) => {
  const data = mockData();
  const leader = await open(context, data, options);
  await expect.poll(() => holdsLeadership(leader.page)).toBe(true);
  const other = await open(context, data, options);
  return { data, leader, other };
};

const row = (page: Page, title: string) =>
  page.locator("[data-task-id]", { hasText: title }).first();

const addTask = async (page: Page, title: string) => {
  await page.fill("#add-task-input", title);
  await page.keyboard.press("Enter");
  await expect(row(page, title)).toBeVisible();
};

const checkbox = (page: Page, title: string, checked?: boolean) =>
  row(page, title).getByRole("checkbox", { checked }).first();

const tick = async (page: Page, title: string) => {
  await checkbox(page, title).click();
  await expect(checkbox(page, title)).toBeChecked();
  // The row holds a tick for 600ms, so it can be taken back, before it's an edit
  await page.waitForTimeout(800);
};

const deleteTask = async (page: Page, title: string) => {
  await row(page, title).hover();
  await row(page, title).getByRole("button", { name: "Delete task" }).click();
  await expect(row(page, title)).toHaveCount(0);
};

/**
 * The API stops answering. page.route still answers while the context is offline, so it refuses
 * too. `offline` also takes the context offline, which the dev server's pages can't reload in.
 */
const dropConnection = async (
  context: BrowserContext,
  pages: Page[],
  { offline = false }: { offline?: boolean } = {},
) => {
  const refuse = (route: Route) => route.abort("internetdisconnected");
  if (offline) await context.setOffline(true);
  for (const page of pages) await page.route("**/api/**", refuse);
  return async () => {
    if (offline) await context.setOffline(false);
    for (const page of pages) {
      if (page.isClosed()) continue;
      await page.unroute("**/api/**", refuse);
      await page.evaluate(() => window.dispatchEvent(new Event("online")));
    }
  };
};

test("a signed-out task added in a second tab stays, and survives a reload", async ({
  context,
}) => {
  const { other } = await openTwo(context, { signedIn: false });
  await addTask(other.page, "Second-tab task");
  // A transaction outside the outbox fails at once, signed out, and rolls back
  await other.page.waitForTimeout(3000);
  await expect(row(other.page, "Second-tab task")).toBeVisible();

  await other.page.reload({ waitUntil: "domcontentloaded" });
  await expect(row(other.page, "Second-tab task")).toBeVisible();
});

test("edits in a second tab closed straight away are sent once, in order, by the first", async ({
  context,
}) => {
  const { leader, other } = await openTwo(context);
  await addTask(other.page, "Made in the second tab");
  await tick(other.page, "Pick up dry cleaning");
  await deleteTask(other.page, "Renew passport");
  await other.page.close();

  await expectSentOnce(
    () => leader.sent(),
    ["POST /api/tasks Made in the second tab", "PUT /api/tasks t-6", "DELETE /api/tasks t-5"],
  );
  expect(other.sent()).toEqual([]);
  await expect(row(leader.page, "Made in the second tab")).toBeVisible();
  await expect(row(leader.page, "Renew passport")).toHaveCount(0);
});

test("a second tab's edit shows there at once and stays once the first has sent it", async ({
  context,
}) => {
  const { leader, other } = await openTwo(context);
  await addTask(other.page, "Shown while it's sent");
  await expectSentOnce(() => leader.sent(), ["POST /api/tasks Shown while it's sent"]);
  // The mock sends no live events, so only the tab's own copy of the answer keeps it
  await expect(row(other.page, "Shown while it's sent")).toBeVisible();
  expect(other.sent()).toEqual([]);
});

test("a second tab's add the server turns away for now shows, and is sent once it answers", async ({
  context,
}) => {
  const { leader, other } = await openTwo(context);
  let refusing = true;
  for (const { page } of [leader, other])
    await page.route("**/api/tasks", (route) =>
      refusing && route.request().method() === "POST"
        ? route.fulfill({ status: 503 })
        : route.fallback(),
    );
  await addTask(other.page, "Added while the server was down");
  await other.page.waitForTimeout(3000);
  await expect(row(other.page, "Added while the server was down")).toBeVisible();
  await expect(row(leader.page, "Added while the server was down")).toBeVisible();

  refusing = false;
  await leader.page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expectSentOnce(() => leader.sent(), ["POST /api/tasks Added while the server was down"]);
  await expect(row(other.page, "Added while the server was down")).toBeVisible();
  expect(other.sent()).toEqual([]);
});

test("a second tab takes over sending once the first closes", async ({ context }) => {
  const { leader, other } = await openTwo(context);
  const reconnect = await dropConnection(context, [leader.page, other.page], { offline: true });
  await addTask(other.page, "Queued while both were offline");
  await leader.page.close();
  await expect.poll(() => holdsLeadership(other.page)).toBe(true);
  await addTask(other.page, "Added once it leads");

  await reconnect();
  await expectSentOnce(
    () => other.sent(),
    ["POST /api/tasks Queued while both were offline", "POST /api/tasks Added once it leads"],
  );
  expect(leader.sent()).toEqual([]);
});

test("edits made offline in both tabs are each sent once when back, and kept on reload", async ({
  context,
}) => {
  const { leader, other } = await openTwo(context);
  const reconnect = await dropConnection(context, [leader.page, other.page]);
  await addTask(leader.page, "Offline in the first tab");
  await addTask(other.page, "Offline in the second tab");
  await tick(other.page, "Pick up dry cleaning");

  await other.page.reload({ waitUntil: "domcontentloaded" });
  await expect(row(other.page, "Offline in the second tab")).toBeVisible();
  await expect(row(other.page, "Offline in the first tab")).toBeVisible();
  await expect(row(leader.page, "Offline in the second tab")).toBeVisible();

  await reconnect();
  const sent = () => [...leader.sent(), ...other.sent()].sort();
  await expectSentOnce(sent, [
    "POST /api/tasks Offline in the first tab",
    "POST /api/tasks Offline in the second tab",
    "PUT /api/tasks t-6",
  ]);

  for (const { page } of [leader, other]) {
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(row(page, "Offline in the first tab")).toBeVisible();
    await expect(row(page, "Offline in the second tab")).toBeVisible();
  }
  await leader.page.waitForTimeout(1000);
  expect(sent()).toHaveLength(3);
});

test.describe("an edit made as the page opens", () => {
  // Holds the executor's leadership request, so the page is ready before the queue is
  const slowQueue = (page: Page) =>
    page.addInitScript(`(() => {
      const request = navigator.locks.request.bind(navigator.locks);
      navigator.locks.request = (...args) =>
        new Promise((resolve) => setTimeout(resolve, 2000)).then(() => request(...args));
    })()`);

  test("is queued, and sent once the server answers", async ({ page }) => {
    const data = mockData();
    await slowQueue(page);
    await mockApi(page, { data });
    let refusing = true;
    await page.route("**/api/tasks", (route) =>
      refusing && route.request().method() !== "GET"
        ? route.fulfill({ status: 503 })
        : route.fallback(),
    );
    const sent = recordWrites(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await tick(page, "Pick up dry cleaning");
    // Outside the queue, the refusal rolls it back
    await page.waitForTimeout(3000);
    await expect(checkbox(page, "Pick up dry cleaning", false)).toHaveCount(0);

    refusing = false;
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect.poll(sent, { timeout: 15_000 }).toContain("PUT /api/tasks t-6");
  });

  test("survives a reload straight after it", async ({ page }) => {
    await slowQueue(page);
    await mockApi(page, { signedIn: false });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#add-task-input");
    await page.fill("#add-task-input", "Added before the queue started");
    await page.keyboard.press("Enter");
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(row(page, "Added before the queue started")).toBeVisible({ timeout: 8000 });
  });
});

test.describe("a list delete whose connection drops", () => {
  const deleteHome = async (page: Page) => {
    const listRow = page
      .locator("div")
      .filter({ has: page.getByRole("button", { name: /^Home/ }) })
      .filter({ has: page.getByRole("button", { name: "List options" }) })
      .last();
    await listRow.hover();
    await listRow.getByRole("button", { name: "List options" }).click();
    // Home is empty, so it goes without asking
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByRole("button", { name: /^Home/ })).toHaveCount(0);
  };

  test("as it lands doesn't hold up the next edit", async ({ page }) => {
    await mockApi(page);
    const sent = recordWrites(page);
    let reconnect = async () => {};
    await page.route("**/api/categories", async (route) => {
      await route.fallback();
      if (route.request().method() === "DELETE")
        reconnect = await dropConnection(page.context(), [page], { offline: true });
    });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await deleteHome(page);
    await expect.poll(sent).toEqual(["DELETE /api/categories c-home"]);
    await addTask(page, "Added after the list went");

    await reconnect();
    await expectSentOnce(sent, [
      "DELETE /api/categories c-home",
      "POST /api/tasks Added after the list went",
    ]);
    await expect(page.getByRole("button", { name: /^Home/ })).toHaveCount(0);
  });

  test("before it's sent doesn't hold up the edits queued after it, across a reload", async ({
    page,
  }) => {
    await mockApi(page);
    const sent = recordWrites(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-task-id]");
    const reconnect = await dropConnection(page.context(), [page]);
    await deleteHome(page);
    await addTask(page, "Queued behind the list delete");
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(row(page, "Queued behind the list delete")).toBeVisible();

    await reconnect();
    await expectSentOnce(sent, [
      "DELETE /api/categories c-home",
      "POST /api/tasks Queued behind the list delete",
    ]);
  });
});
