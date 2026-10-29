import { nanoid } from "nanoid";
import { keyAfter } from "@newtab-todo/shared/sort-order";
import { SERVER_URL_KEY, TOKEN_KEY } from "@newtab-todo/shared/constants";
import { now } from "@newtab-todo/shared/iso";
import { MAX_TEXT, MAX_TITLE, cutTo } from "@newtab-todo/shared/field-limits";
import { ext, getStoredSession } from "~/lib/ext";
import { ApiError, apiClient, succeeded } from "~/lib/api-client";

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
// A titled group is a submenu, so a contact list doesn't make the menu twice as long per person
type Group = { submenu?: { id: string; title: string }; destinations: Destination[] };

type Draft = { title: string; description: string | null; note?: string };

const MAX_TITLE_LENGTH = 140;

const toTitle = (text: string) => {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > MAX_TITLE_LENGTH ? `${line.slice(0, MAX_TITLE_LENGTH - 1)}…` : line;
};

// A page's text or address can run past what the server takes, which would refuse the whole task
const withinLimits = ({ title, description, note }: Draft): Draft => ({
  title: cutTo(title, MAX_TITLE),
  description: description && cutTo(description, MAX_TEXT),
  ...(note && { note: cutTo(note, MAX_TEXT) }),
});

const draftFor = (id: DraftId, info: ClickData, tab?: browser.tabs.Tab): Draft => {
  const pageUrl = tab?.url ?? info.pageUrl ?? null;
  const pageTitle = toTitle(tab?.title || pageUrl || "Untitled page");
  const selection = info.selectionText ?? "";
  switch (id) {
    case "selection": {
      const title = toTitle(selection);
      const selectionIfTruncated = title.endsWith("…") ? selection : null;
      return {
        title,
        description: [selectionIfTruncated, pageUrl].filter(Boolean).join("\n\n") || null,
      };
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

const nextSortOrder = async (session: Session) => {
  const tasks = await (await succeeded(apiClient(session).api.tasks.$get())).json();
  return keyAfter(tasks.flatMap((t) => (t.parentId ? [] : [t.sortOrder])));
};

const INBOX: Destination = { kind: "inbox", target: "", title: "Inbox", done: "Added to Inbox" };

const fetchDestinations = async (session: Session): Promise<Group[]> => {
  const { api } = apiClient(session);
  const [categories, contacts] = await Promise.all([
    succeeded(api.categories.$get()).then((res) => res.json()),
    succeeded(api.contacts.$get()).then((res) => res.json()),
  ]);
  const people = contacts.map((c) => c.contactUser);
  return [
    { destinations: [INBOX] },
    {
      destinations: categories
        .filter((c) => c.collaborators?.length)
        .map((c) => ({ kind: "list", target: c.id, title: c.name, done: `Added to ${c.name}` })),
    },
    {
      submenu: { id: "share", title: "Share with" },
      destinations: people.map((p) => ({
        kind: "share",
        target: p.username,
        title: p.name,
        done: `Added and shared with ${p.name}`,
      })),
    },
    {
      submenu: { id: "send", title: "Send to" },
      destinations: people.map((p) => ({
        kind: "send",
        target: p.id,
        title: p.name,
        done: `Sent to ${p.name}`,
      })),
    },
  ];
};

const notify = (title: string, message: string) =>
  ext.notifications
    .create({ type: "basic", iconUrl: ext.runtime.getURL("icons/icon-192.png"), title, message })
    .catch(console.error);

const failureMessage = (err: unknown) => {
  if (err instanceof ApiError && err.status === 401) return "Sign in to Ajot again.";
  if (err instanceof ApiError && err.status === 429)
    return "That's a lot of sharing at once. Try again in a few minutes.";
  if (err instanceof ApiError) return "The server couldn't save it. Try again.";
  return "Couldn't reach the server. Check your connection and try again.";
};

/** Adds the task, then whatever goes with it; returns the parts of that which failed. */
const addDraft = async (session: Session, draft: Draft, kind: DestinationKind, target: string) => {
  const { api } = apiClient(session);
  const timestamp = now();
  const base = { id: nanoid(), title: draft.title, createdAt: timestamp, updatedAt: timestamp };

  // A note belongs to whoever wrote it, so a recipient would never see one: it goes inline
  if (kind === "send") {
    const joined = [draft.note, draft.description].filter(Boolean).join("\n\n");
    const description = joined ? cutTo(joined, MAX_TEXT) : null;
    await succeeded(api.tasks.send.$post({ json: { ...base, description, recipientId: target } }));
    return [];
  }

  // Both schemas require userId; the server replaces it with the token's user
  const created = await succeeded(
    api.tasks.$post({
      json: {
        ...base,
        userId: "",
        description: draft.description,
        categoryId: kind === "list" ? target : null,
        sortOrder: await nextSortOrder(session),
        parentId: null,
        assigneeId: null,
        dueDate: null,
        editedAt: null,
        completedAt: null,
      },
    }),
  );
  const task = await created.json();

  const extras: [string, Promise<unknown>][] = [];
  if (kind === "share")
    extras.push([
      "sharing",
      succeeded(api.tasks.share.$post({ json: { taskId: task.id, username: target } })),
    ]);
  if (draft.note)
    extras.push([
      "the note",
      succeeded(
        api.notes.$post({
          json: {
            id: crypto.randomUUID(),
            userId: "",
            taskId: task.id,
            title: cutTo(draft.note, MAX_TITLE),
            content: draft.note,
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        }),
      ),
    ]);
  const settled = await Promise.allSettled(extras.map(([, done]) => done));
  return extras.flatMap(([part], i) => (settled[i].status === "rejected" ? [part] : []));
};

const recordMenuUse = (session: Session, name: string) =>
  succeeded(apiClient(session).api.metrics.$post({ json: { name } })).catch(console.error);

let doneLabels = new Map<string, string>();

const handleClick = async (info: ClickData, tab?: browser.tabs.Tab) => {
  const menuId = String(info.menuItemId);
  const [draftId, kind, target = ""] = menuId.split("|");
  if (!(draftId in DRAFTS) || !kind) return;
  const draft = withinLimits(draftFor(draftId as DraftId, info, tab));
  const session = await getStoredSession();
  if (!session) return notify("Not added", "Sign in to Ajot to add tasks from the menu.");
  try {
    const failed = await addDraft(session, draft, kind as DestinationKind, target);
    void recordMenuUse(session, `menu:${draftId}:${kind}`);
    const done = doneLabels.get(`${kind}|${target}`) ?? "Added to Ajot";
    await notify(failed.length ? `Added, but ${failed.join(" and ")} failed` : done, draft.title);
  } catch (err) {
    console.error("[menu] add failed:", err);
    await notify("Not added", failureMessage(err));
  }
};

const create = (item: browser.contextMenus._CreateCreateProperties) =>
  ext.contextMenus.create(item);

const separatedFromPrevious = (groups: Group[], i: number) =>
  i > 0 && !(groups[i]!.submenu && groups[i - 1]!.submenu);

const buildMenu = (groups: Group[]) => {
  const nonEmpty = groups.filter((group) => group.destinations.length > 0);
  doneLabels = new Map(
    nonEmpty.flatMap((group) => group.destinations).map((d) => [`${d.kind}|${d.target}`, d.done]),
  );
  for (const [draftId, item] of Object.entries(DRAFTS)) {
    // Nowhere to choose from: the item itself adds to the Inbox
    if (nonEmpty.length === 1) {
      create({ id: `${draftId}|inbox`, ...item });
      continue;
    }
    create({ id: draftId, ...item });
    nonEmpty.forEach(({ submenu, destinations }, i) => {
      const child = { parentId: draftId, contexts: item.contexts };
      if (separatedFromPrevious(nonEmpty, i))
        create({ id: `${draftId}|separator-${i}`, type: "separator", ...child });
      // Outside the "draft|kind|target" ids, so clicking it adds nothing
      const parentId = submenu ? `${draftId}:${submenu.id}` : draftId;
      if (submenu) create({ id: parentId, title: submenu.title, ...child });
      for (const d of destinations)
        create({
          id: [draftId, d.kind, d.target].filter(Boolean).join("|"),
          title: d.title,
          parentId,
          contexts: item.contexts,
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
            return [{ destinations: [INBOX] }];
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
