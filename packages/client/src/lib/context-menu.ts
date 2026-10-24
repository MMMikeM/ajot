import { nanoid } from "nanoid";
import { generateKeyBetween } from "fractional-indexing";
import { SERVER_URL_KEY, TOKEN_KEY } from "@newtab-todo/shared/constants";
import { now } from "@newtab-todo/shared/iso";
import { ext, getStoredSession } from "~/lib/ext";

type Session = NonNullable<Awaited<ReturnType<typeof getStoredSession>>>;
type ClickData = browser.contextMenus.OnClickData;
type ContextType = browser.contextMenus.ContextType;

const DRAFTS = {
  selection: { title: "Add “%s” as a task", contexts: ["selection"] },
  "selection-as-note": {
    title: "Add this page, with the selection as a note",
    contexts: ["selection"],
  },
  link: { title: "Add link as a task", contexts: ["link"] },
  page: { title: "Add this page as a task", contexts: ["page"] },
} satisfies Record<string, { title: string; contexts: ContextType[] }>;

type DraftId = keyof typeof DRAFTS;

// The target rides in the menu item's id: a list's id, a contact's username or user id
type DestinationKind = "inbox" | "list" | "share" | "send";
type Destination = { kind: DestinationKind; target: string; title: string; done: string };

type Draft = { title: string; description: string | null; note?: string };

const MAX_TITLE_LENGTH = 140;

const toTitle = (text: string) => {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > MAX_TITLE_LENGTH ? `${line.slice(0, MAX_TITLE_LENGTH - 1)}…` : line;
};

const draftFor = (id: DraftId, info: ClickData, tab?: browser.tabs.Tab): Draft => {
  const pageUrl = tab?.url ?? info.pageUrl ?? null;
  const pageTitle = toTitle(tab?.title || pageUrl || "Untitled page");
  const selection = info.selectionText ?? "";
  switch (id) {
    case "selection": {
      const title = toTitle(selection);
      // A selection too long for a title is kept whole in the description
      const fullText = title.endsWith("…") ? selection : null;
      return { title, description: [fullText, pageUrl].filter(Boolean).join("\n\n") || null };
    }
    case "selection-as-note":
      return { title: pageTitle, description: pageUrl, note: selection };
    case "link":
      // Chrome doesn't send linkText; selecting the link's text first gets it there too
      return {
        title: toTitle(info.linkText || selection) || info.linkUrl || pageTitle,
        description: info.linkUrl ?? null,
      };
    case "page":
      return { title: pageTitle, description: pageUrl };
  }
};

class RequestError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

const request = async <T>(session: Session, method: string, path: string, body?: unknown) => {
  const res = await fetch(`${session.serverUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${session.token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new RequestError(res.status);
  return (res.status === 204 ? undefined : await res.json()) as T;
};

// After every other top-level task, as adding one in the app does
const nextSortOrder = async (session: Session) => {
  const tasks = await request<{ parentId: string | null; sortOrder: string | null }[]>(
    session,
    "GET",
    "/api/tasks",
  );
  const last = tasks
    .flatMap((t) => (!t.parentId && t.sortOrder ? [t.sortOrder] : []))
    .sort()
    .at(-1);
  return generateKeyBetween(last ?? null, null);
};

const INBOX: Destination = { kind: "inbox", target: "", title: "Inbox", done: "Added to Inbox" };

/** In groups, a separator between each: the Inbox, shared lists, sharing, sending. */
const fetchDestinations = async (session: Session): Promise<Destination[][]> => {
  const [categories, contacts] = await Promise.all([
    request<{ id: string; name: string; collaborators?: unknown[] }[]>(
      session,
      "GET",
      "/api/categories",
    ),
    request<{ contactUser: { id: string; name: string; username: string } | null }[]>(
      session,
      "GET",
      "/api/contacts",
    ),
  ]);
  const people = contacts.flatMap((c) => (c.contactUser ? [c.contactUser] : []));
  return [
    [INBOX],
    categories
      .filter((c) => c.collaborators?.length)
      .map((c) => ({ kind: "list", target: c.id, title: c.name, done: `Added to ${c.name}` })),
    people.map((p) => ({
      kind: "share",
      target: p.username,
      title: `Share with ${p.name}`,
      done: `Added and shared with ${p.name}`,
    })),
    people.map((p) => ({
      kind: "send",
      target: p.id,
      title: `Send to ${p.name}`,
      done: `Sent to ${p.name}`,
    })),
  ];
};

const notify = (title: string, message: string) =>
  ext.notifications
    .create({ type: "basic", iconUrl: ext.runtime.getURL("icons/icon-192.png"), title, message })
    .catch(console.error);

const failureMessage = (err: unknown) => {
  if (err instanceof RequestError && err.status === 401) return "Sign in to Ajot again.";
  if (err instanceof RequestError) return `The server answered ${err.status}.`;
  return "Couldn't reach the server.";
};

/** Adds the task, then whatever goes with it; returns the parts of that which failed. */
const addDraft = async (session: Session, draft: Draft, kind: DestinationKind, target: string) => {
  const timestamp = now();
  const base = { id: nanoid(), title: draft.title, createdAt: timestamp, updatedAt: timestamp };

  // A note belongs to whoever wrote it, so a recipient would never see one: it goes inline
  if (kind === "send") {
    const description = [draft.note, draft.description].filter(Boolean).join("\n\n") || null;
    await request(session, "POST", "/api/tasks/send", {
      ...base,
      description,
      recipientId: target,
    });
    return [];
  }

  // Both schemas require userId; the server replaces it with the token's user
  const task = await request<{ id: string }>(session, "POST", "/api/tasks", {
    ...base,
    userId: "",
    description: draft.description,
    categoryId: kind === "list" ? target : null,
    sortOrder: await nextSortOrder(session),
  });

  const extras: [string, Promise<unknown>][] = [];
  if (kind === "share")
    extras.push([
      "the share",
      request(session, "POST", "/api/tasks/share", { taskId: task.id, username: target }),
    ]);
  if (draft.note)
    extras.push([
      "the note",
      request(session, "POST", "/api/notes", {
        id: crypto.randomUUID(),
        userId: "",
        taskId: task.id,
        title: draft.note,
        content: draft.note,
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    ]);
  const settled = await Promise.allSettled(extras.map(([, done]) => done));
  return extras.flatMap(([part], i) => (settled[i].status === "rejected" ? [part] : []));
};

// Counts which items get used, so the unused ones can go
const count = (session: Session, name: string) =>
  request(session, "POST", "/api/metrics", { name }).catch(console.error);

let doneLabels = new Map<string, string>();

const handleClick = async (info: ClickData, tab?: browser.tabs.Tab) => {
  const menuId = String(info.menuItemId);
  const [draftId, kind, target = ""] = menuId.split("|");
  if (!(draftId in DRAFTS) || !kind) return;
  const draft = draftFor(draftId as DraftId, info, tab);
  const session = await getStoredSession();
  if (!session) return notify("Not added", "Sign in to Ajot to add tasks from the menu.");
  try {
    const failed = await addDraft(session, draft, kind as DestinationKind, target);
    void count(session, `menu:${draftId}:${kind}`);
    const done = doneLabels.get(`${kind}|${target}`) ?? "Added to Ajot";
    await notify(failed.length ? `Added, without ${failed.join(" or ")}` : done, draft.title);
  } catch (err) {
    console.error("[menu] add failed:", err);
    await notify("Not added", failureMessage(err));
  }
};

const create = (item: browser.contextMenus._CreateCreateProperties) =>
  ext.contextMenus.create(item);

const buildMenu = (groups: Destination[][]) => {
  const nonEmpty = groups.filter((group) => group.length > 0);
  doneLabels = new Map(nonEmpty.flat().map((d) => [`${d.kind}|${d.target}`, d.done]));
  for (const [draftId, item] of Object.entries(DRAFTS)) {
    // Nowhere to choose from: the item itself adds to the Inbox
    if (nonEmpty.length === 1) {
      create({ id: `${draftId}|inbox`, ...item });
      continue;
    }
    create({ id: draftId, ...item });
    nonEmpty.forEach((group, i) => {
      const child = { parentId: draftId, contexts: item.contexts };
      if (i > 0) create({ id: `${draftId}|separator-${i}`, type: "separator", ...child });
      for (const d of group)
        create({
          id: [draftId, d.kind, d.target].filter(Boolean).join("|"),
          title: d.title,
          ...child,
        });
    });
  }
};

// Firefox can update a menu as it opens; Chrome can't, so its lists and contacts are as of the
// last rebuild, which runs whenever its worker starts
const STALE_AFTER_MS = 60_000;
let builtAt = 0;

// Chrome keeps menu items across worker restarts and Firefox drops them, so every start clears
// and recreates them. Queued, so a sign-in landing mid-rebuild can't create an item twice.
let rebuilding = Promise.resolve();
const rebuild = () => {
  rebuilding = rebuilding
    .then(async () => {
      const session = await getStoredSession();
      const groups = session
        ? await fetchDestinations(session).catch((err) => {
            console.error("[menu] couldn't load lists and contacts:", err);
            return [[INBOX]];
          })
        : null;
      await ext.contextMenus.removeAll();
      if (groups) buildMenu(groups);
      builtAt = Date.now();
    })
    .catch((err) => console.error("[menu] rebuild failed:", err));
  return rebuilding;
};

/** Never throws: a failure here must not stop the background's sync. */
export const setupContextMenu = () => {
  try {
    // Firefox for Android has no context menus
    if (!ext.contextMenus) return;
    ext.contextMenus.onClicked.addListener((info, tab) => void handleClick(info, tab));
    // On the storage write itself: a sign-in's runtime message can arrive before it lands
    ext.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && (TOKEN_KEY in changes || SERVER_URL_KEY in changes)) void rebuild();
    });
    if ("onShown" in ext.contextMenus)
      ext.contextMenus.onShown.addListener(() => {
        if (Date.now() - builtAt < STALE_AFTER_MS) return;
        void rebuild().then(() => ext.contextMenus.refresh());
      });
    void rebuild();
  } catch (err) {
    console.error("[menu] setup failed:", err);
  }
};
