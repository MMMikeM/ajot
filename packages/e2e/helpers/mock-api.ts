import type { Page } from "@playwright/test";

/**
 * Serves /api/* from in-memory fixtures and signs the page in: specs and screenshots
 * need only the Vite dev server. SSE gets a 204 so the client stops reconnecting.
 */

const MOCK_ME = { id: "u-mike", name: "Mike Murray", username: "mike" };
const MOCK_SARAH = { id: "u-sarah", name: "Sarah Murray", username: "sarah" };
const MOCK_SAM = { id: "u-sam", name: "Sam Okafor", username: "sam" };

type MockUser = typeof MOCK_ME;

const TIMESTAMP = "2026-09-20T09:00:00.000Z";

/** Local YYYY-MM-DD, `offsetDays` from today — due dates render relative to the device's today */
export const isoDay = (offsetDays: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** A mock task's `isoDay(offsetDays)` due date as the list shows it, in the page's locale */
export const dueLabel = (page: Page, offsetDays: number) =>
  page.evaluate((offset) => {
    const date = new Date();
    date.setDate(date.getDate() + offset);
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
    });
  }, offsetDays);

export const mockData = () => {
  let order = 0;
  const task = (title: string, extra: Record<string, unknown> = {}) => {
    const n = order++;
    return {
      id: `t-${n}`,
      userId: MOCK_ME.id,
      categoryId: null as string | null,
      assigneeId: null,
      sentById: null as string | null,
      parentId: null as string | null,
      title,
      description: null as string | null,
      status: "todo",
      dueDate: null as string | null,
      sortOrder: `a${n.toString(36).padStart(2, "0")}`,
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
      editedAt: null as string | null,
      completedAt: null as string | null,
      deletedAt: null as string | null,
      user: { id: MOCK_ME.id, name: MOCK_ME.name },
      subtasks: [],
      shares: [] as unknown[],
      assignee: null as MockUser | null,
      sentBy: null as { id: string; name: string } | null,
      ...extra,
    };
  };
  const shareWith = (taskId: string, user: MockUser) => ({
    id: `s-${taskId}-${user.id}`,
    taskId,
    sharedWithUserId: user.id,
    categoryId: null,
    permission: "edit",
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    sharedWithUser: user,
  });

  const flights = task(
    "Book flights for the October trip and check whether the Tuesday fare is still under €200",
    { description: "Sam said the 7am one is fine" },
  );
  const thankYou = task("Write a thank-you note to Anna", { dueDate: isoDay(5) });
  thankYou.shares = [shareWith(thankYou.id, MOCK_SARAH)];

  const tasks = [
    flights,
    task("Compare Tuesday and Wednesday fares", { parentId: flights.id }),
    task("Ask Sam about airport pickup", { parentId: flights.id, status: "done" }),
    thankYou,
    task("Call the plumber about the kitchen tap", { dueDate: isoDay(0) }),
    task("Renew passport", { dueDate: isoDay(-3) }),
    task("Pick up dry cleaning"),
    task("Sort out the car insurance renewal before it lapses", {
      assigneeId: MOCK_SAM.id,
      assignee: MOCK_SAM,
    }),
    task("Buy oat milk", { status: "done" }),
    task("Return library books", { status: "done" }),
    task("Draft Q4 roadmap for the team offsite", { categoryId: "c-work", dueDate: isoDay(2) }),
    task("Reply to Priya about the contract", { categoryId: "c-work" }),
    task("Eggs", {
      categoryId: "c-groc",
      userId: MOCK_SARAH.id,
      user: { id: MOCK_SARAH.id, name: MOCK_SARAH.name },
    }),
    task("Sourdough", { categoryId: "c-groc" }),
  ];
  const sharedWithMe = task("Pick a restaurant for Friday", {
    userId: MOCK_SARAH.id,
    user: { id: MOCK_SARAH.id, name: MOCK_SARAH.name },
  });
  sharedWithMe.shares = [shareWith(sharedWithMe.id, MOCK_ME)];
  tasks.push(sharedWithMe);

  const category = (
    id: string,
    name: string,
    color: string,
    owner: MockUser,
    sortOrder: string,
  ) => ({
    id,
    userId: owner.id,
    name,
    color,
    sortOrder,
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    user: { name: owner.name },
    collaborators: [] as unknown[],
  });
  const groceries = category("c-groc", "Groceries", "oklch(0.68 0.16 58)", MOCK_SARAH, "a2");
  groceries.collaborators = [
    {
      id: "cc1",
      categoryId: "c-groc",
      userId: MOCK_ME.id,
      addedAt: TIMESTAMP,
      user: { ...MOCK_ME, avatarUrl: null },
    },
  ];
  const home = category("c-home", "Home", "oklch(0.60 0.12 138)", MOCK_ME, "a1");
  home.collaborators = [
    {
      id: "cc2",
      categoryId: "c-home",
      userId: MOCK_SAM.id,
      addedAt: TIMESTAMP,
      user: { ...MOCK_SAM, avatarUrl: null },
    },
  ];
  const categories = [
    category("c-work", "Work", "oklch(0.55 0.07 228)", MOCK_ME, "a0"),
    home,
    groceries,
  ];

  const contacts = [MOCK_SARAH, MOCK_SAM].map((u) => ({
    id: `ct-${u.id}`,
    userId: MOCK_ME.id,
    contactUserId: u.id,
    createdAt: TIMESTAMP,
    contactUser: { ...u, avatarUrl: null },
  }));

  return { tasks, categories, contacts, notes: [] as unknown[] };
};

type MockData = ReturnType<typeof mockData>;

/** A note on `task`, as the API sends one: content only, unless `extra` gives it a title */
export const noteOn = (
  task: { id: string; userId: string; createdAt: string },
  content: string,
  extra: { id?: string; title?: string | null } = {},
) => ({
  id: `n-${task.id}`,
  userId: task.userId,
  taskId: task.id,
  title: null,
  content,
  createdAt: task.createdAt,
  updatedAt: task.createdAt,
  ...extra,
});

type MockApiOptions = {
  signedIn?: boolean;
  data?: MockData;
  /** Suppress the one-time swipe peek, which would otherwise move the first row on touch */
  swipeHintSeen?: boolean;
  /** Suppress the install and background-update offers, which would otherwise sit above the list */
  setupHintSeen?: boolean;
};

export const mockApi = async (
  page: Page,
  {
    signedIn = true,
    data = mockData(),
    swipeHintSeen = true,
    setupHintSeen = true,
  }: MockApiOptions = {},
) => {
  await page.addInitScript(
    ({ me, signedIn, swipeHintSeen, setupHintSeen }) => {
      if (signedIn) {
        localStorage.setItem("newtab-todo-token", "mock-token");
        localStorage.setItem("newtab-todo-user-id", me.id);
        localStorage.setItem("newtab-todo-user-info", JSON.stringify(me));
      }
      if (swipeHintSeen) localStorage.setItem("newtab-todo-swipe-hint-seen", "1");
      if (setupHintSeen)
        localStorage.setItem("newtab-todo-setup-hint-dismissed", '["install","background"]');
    },
    { me: MOCK_ME, signedIn, swipeHintSeen, setupHintSeen },
  );

  const collections: Record<string, unknown> = {
    "/api/tasks": data.tasks,
    "/api/categories": data.categories,
    "/api/contacts": data.contacts,
    "/api/notes": data.notes,
    "/api/config": { vapidPublicKey: "", awaitingFirstUser: false },
  };

  // Lists, contacts and list members go and come back, so a refetch after a delete or an Undo
  // shows it
  const removed = new Map<string, { from: { id: string }[]; row: { id: string } }>();
  const take = (from: { id: string }[], id: string, key = id) => {
    const index = from.findIndex((row) => row.id === id);
    if (index < 0) return null;
    const [row] = from.splice(index, 1);
    removed.set(key, { from, row });
    return row;
  };
  const putBack = (key: string) => {
    const entry = removed.get(key);
    if (!entry) return null;
    removed.delete(key);
    entry.from.push(entry.row);
    return entry.row;
  };
  const removals = (method: string, path: string, json: () => { id?: string } | null) => {
    if (method === "DELETE" && path === "/api/categories")
      return take(data.categories, json()?.id ?? "") ?? {};
    const contact = path.match(/^\/api\/contacts\/([^/]+)$/);
    if (method === "DELETE" && contact) return take(data.contacts, contact[1]) ?? {};
    const restore = path.match(/^\/api\/(?:categories|contacts)\/([^/]+)\/restore$/);
    if (method === "POST" && restore) return putBack(restore[1]) ?? {};
    const member = path.match(/^\/api\/categories\/([^/]+)\/collaborators\/([^/]+)(\/restore)?$/);
    const list = member && data.categories.find((c) => c.id === member[1]);
    if (!member || !list) return null;
    const collaborators = list.collaborators as { id: string; userId: string }[];
    const key = `${member[1]}/${member[2]}`;
    if (method === "DELETE" && !member[3]) {
      const row = collaborators.find((c) => c.userId === member[2]);
      if (row) take(collaborators, row.id, key);
      return { userId: member[2] };
    }
    if (method === "POST" && member[3]) return putBack(key) ?? {};
    return null;
  };

  // The extension calls its server cross-origin, so answer preflights and allow the origin
  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization, content-type, x-client-id",
    "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  };

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    if (path.startsWith("/api/events"))
      return route.fulfill({ status: 204, headers: cors, body: "" });

    // Every invite is Sarah's, except one called "expired"
    if (path.startsWith("/api/auth/invites/"))
      return path.endsWith("/expired")
        ? route.fulfill({
            status: 404,
            headers: cors,
            json: { error: "This invite link has expired or been used. Ask for a new one." },
          })
        : route.fulfill({ status: 200, headers: cors, json: { inviterName: MOCK_SARAH.name } });

    let body: unknown = {};
    const removal = removals(request.method(), path, request.postDataJSON.bind(request));
    if (removal) body = removal;
    else if (request.method() === "GET") body = collections[path] ?? {};
    else {
      try {
        body = request.postDataJSON() ?? {};
      } catch {
        // Non-JSON mutation body: answer with an empty object
      }
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: cors,
      body: JSON.stringify(body),
    });
  });

  return data;
};

/** The list, signed in against the mocked API, once its rows show. */
export const openList = async (page: Page, options?: MockApiOptions) => {
  await mockApi(page, options);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-task-id]", { timeout: 15000 });
};
