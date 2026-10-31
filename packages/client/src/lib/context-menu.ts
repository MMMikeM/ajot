import { nanoid } from "nanoid";
import { keyAfter } from "@newtab-todo/shared/sort-order";
import { SERVER_URL_KEY, TOKEN_KEY } from "@newtab-todo/shared/constants";
import { now } from "@newtab-todo/shared/iso";
import { MAX_TEXT, MAX_TITLE, cutTo } from "@newtab-todo/shared/field-limits";
import { ext, getStoredSession } from "~/lib/ext";
import {
  ApiError,
  apiClient,
  succeeded,
  type ApiClient,
  type SignedInSession,
} from "~/lib/api-client";
import { fetchServerConfig } from "~/lib/server-config";
import { queueFile } from "~/lib/files/attach";
import { fetchImage } from "~/lib/files/remote-image";
import { createUploadSender } from "~/lib/files/sender";
import { recordMetric, sendPendingMetrics } from "~/lib/metrics";
import { showPageToast, type PageToastTone } from "~/lib/page-toast";

type ClickData = browser.contextMenus.OnClickData;
type ContextType = browser.contextMenus.ContextType;

const DRAFTS = {
  selection: { title: "Add “%s” as a task", contexts: ["selection"] },
  "selection-as-note": {
    title: "Add this page, with the selection as a note",
    contexts: ["selection"],
  },
  link: { title: "Add link as a task", contexts: ["link"] },
  image: { title: "Add image as a task", contexts: ["image"] },
  "image-link": { title: "Add image link as a task", contexts: ["image"] },
  page: { title: "Add this page as a task", contexts: ["page"] },
} satisfies Record<string, { title: string; contexts: ContextType[] }>;

// A sent task is its recipient's, which its sender can't attach a file to
const ATTACHES = new Set<string>(["image"]);

type DraftId = keyof typeof DRAFTS;

// The target rides in the menu item's id: a list's id, a contact's username or user id
type DestinationKind = "inbox" | "list" | "share" | "send";
type Destination = { kind: DestinationKind; target: string; title: string; done: string };
// A titled group is a submenu, so a contact list doesn't make the menu twice as long per person
type Group = { submenu?: { id: string; title: string }; destinations: Destination[] };

type Draft = { title: string; description: string | null; note?: string; image?: string };

const MAX_TITLE_LENGTH = 140;

const toTitle = (text: string) => {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > MAX_TITLE_LENGTH ? `${line.slice(0, MAX_TITLE_LENGTH - 1)}…` : line;
};

// A page's text or address can run past what the server takes, which would refuse the whole task
const withinLimits = ({ title, description, note, image }: Draft): Draft => ({
  title: cutTo(title, MAX_TITLE),
  description: description && cutTo(description, MAX_TEXT),
  ...(note && { note: cutTo(note, MAX_TEXT) }),
  ...(image && { image }),
});

/** The file name in an image's address, for one on the web; a data: image has none. */
const imageName = (src: string) => {
  try {
    const url = new URL(src);
    if (!url.protocol.startsWith("http")) return "";
    return decodeURIComponent(url.pathname.split("/").pop() ?? "");
  } catch {
    return "";
  }
};

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
    case "image":
    case "image-link": {
      const src = info.srcUrl ?? "";
      const title = toTitle(imageName(src) || `Image from ${pageTitle}`);
      // A data: image's address is the image itself, too long for a description
      const link = src.startsWith("http") ? src : null;
      return id === "image"
        ? { title, description: pageUrl, image: src }
        : { title, description: [link, pageUrl].filter(Boolean).join("\n\n") || null };
    }
    case "page":
      return { title: pageTitle, description: pageUrl };
  }
};

const nextSortOrder = async ({ api }: ApiClient) => {
  const tasks = await succeeded(api.tasks.$get()).then((res) => res.json());
  return keyAfter(tasks.flatMap((t) => (t.parentId ? [] : [t.sortOrder])));
};

const INBOX: Destination = { kind: "inbox", target: "", title: "Inbox", done: "Added to Inbox" };

const fetchDestinations = async ({ api }: ApiClient): Promise<Group[]> => {
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

/**
 * On the page the menu was used on, where it's seen; the operating system can hide a notification
 * without saying so. A page the browser keeps scripts out of (its own, add-on stores) gets one.
 */
const tell = async (
  tab: browser.tabs.Tab | undefined,
  tone: PageToastTone,
  title: string,
  message: string,
) => {
  if (tab?.id !== undefined && tab.id >= 0) {
    try {
      await ext.scripting.executeScript({
        target: { tabId: tab.id },
        func: showPageToast,
        args: [title, message, tone],
      });
      return;
    } catch (err) {
      console.warn("[menu] couldn't show it on the page:", err);
    }
  }
  await notify(title, message);
};

const failureMessage = (err: unknown) => {
  if (err instanceof ApiError && err.status === 401) return "Sign in to Ajot again.";
  if (err instanceof ApiError && err.status === 429)
    return "That's a lot of sharing at once. Try again in a few minutes.";
  if (err instanceof ApiError) return "The server couldn't save it. Try again.";
  return "Couldn't reach the server. Check your connection and try again.";
};

type Step = "sort-order" | "add" | "send" | "config" | "share" | "note" | "image";

/** Which request in a click failed, so its metric can say. */
class StepFailed extends Error {
  constructor(
    readonly step: Step,
    cause: unknown,
  ) {
    super(`${step} failed`, { cause });
  }
}

const step = <T>(name: Step, work: Promise<T>) =>
  work.catch((cause: unknown) => Promise.reject(new StepFailed(name, cause)));

/** A failure's reason as a metric name can carry it: the server's status, or the error's kind. */
const reasonOf = (err: unknown) => {
  if (err instanceof ApiError) return String(err.status);
  const name = err instanceof Error ? err.name.toLowerCase().replace(/[^a-z0-9-]/g, "") : "";
  return name || "unknown";
};

type FailedPart = { step: Step; label: string; reason: string };

/** Adds the task, then whatever goes with it; returns its id and the parts of that which failed. */
const addDraft = async (
  client: ApiClient,
  draft: Draft,
  kind: DestinationKind,
  target: string,
): Promise<{ taskId?: string; failed: FailedPart[] }> => {
  const { api } = client;
  const timestamp = now();
  const base = { id: nanoid(), title: draft.title, createdAt: timestamp, updatedAt: timestamp };

  // A note belongs to whoever wrote it, so a recipient would never see one: it goes inline
  if (kind === "send") {
    const joined = [draft.note, draft.description].filter(Boolean).join("\n\n");
    const description = joined ? cutTo(joined, MAX_TEXT) : null;
    await step(
      "send",
      succeeded(api.tasks.send.$post({ json: { ...base, description, recipientId: target } })),
    );
    return { failed: [] };
  }

  // Both schemas require userId; the server replaces it with the token's user
  const sortOrder = await step("sort-order", nextSortOrder(client));
  const task = await step(
    "add",
    succeeded(
      api.tasks.$post({
        json: {
          ...base,
          userId: "",
          description: draft.description,
          categoryId: kind === "list" ? target : null,
          sortOrder,
          parentId: null,
          assigneeId: null,
          dueDate: null,
          editedAt: null,
          completedAt: null,
        },
      }),
    ).then((res) => res.json()),
  );

  const extras: [Step, string, Promise<unknown>][] = [];
  if (kind === "share")
    extras.push([
      "share",
      "sharing",
      succeeded(api.tasks.share.$post({ json: { taskId: task.id, username: target } })),
    ]);
  if (draft.note)
    extras.push([
      "note",
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
  const settled = await Promise.allSettled(extras.map(([, , done]) => done));
  return {
    taskId: task.id,
    failed: extras.flatMap(([failedStep, label], i) => {
      const result = settled[i]!;
      return result.status === "rejected"
        ? [{ step: failedStep, label, reason: reasonOf(result.reason) }]
        : [];
    }),
  };
};

const sendUploads = createUploadSender(getStoredSession);

// Called before anything in the click is awaited: a browser lets an extension ask for a
// permission only inside the click itself. Already granted, it resolves without asking.
const askToReadImages = (src: string) =>
  src.startsWith("data:")
    ? Promise.resolve(true)
    : (async () => ext.permissions.request({ origins: ["<all_urls>"] }))().catch((err) => {
        console.error("[menu] couldn't ask to read images:", err);
        return false;
      });

const MB = 1024 * 1024;

type ReadImage = { file: File; maxBytes: number } | { reason: string };

/** The image as a file to attach, or why it can't be, so its link is added instead. */
const readImage = async (
  session: SignedInSession,
  src: string,
  allowed: Promise<boolean>,
): Promise<ReadImage> => {
  // Made by the page itself, so only the page can read it
  if (src.startsWith("blob:")) return { reason: "That image can only be saved as its link." };
  if (!(await allowed)) return { reason: "Ajot wasn't allowed to read images from that site." };
  const { attachments } = await step("config", fetchServerConfig(session.serverUrl));
  if (!attachments) return { reason: "Your server doesn't take attachments." };
  try {
    const blob = await fetchImage(src);
    if (blob.size > attachments.maxBytes)
      return { reason: `The image is over ${Math.round(attachments.maxBytes / MB)} MB.` };
    const name = imageName(src) || `image.${blob.type.split("/")[1]?.split("+")[0] || "png"}`;
    return { file: new File([blob], name, { type: blob.type }), maxBytes: attachments.maxBytes };
  } catch (err) {
    console.error("[menu] couldn't read the image:", err);
    return { reason: "The image couldn't be fetched from its site." };
  }
};

let doneLabels = new Map<string, string>();

const handleClick = async (info: ClickData, tab?: browser.tabs.Tab) => {
  const menuId = String(info.menuItemId);
  const [draftId, kind, target = ""] = menuId.split("|");
  if (!(draftId in DRAFTS) || !kind) return;
  const id = draftId as DraftId;
  const allowed = id === "image" && info.srcUrl ? askToReadImages(info.srcUrl) : undefined;
  const where = `${draftId}:${kind}`;
  // Clicks less the menu: and menu-fail: counts are those that ended with no notification
  void recordMetric(`menu-click:${where}`, null);
  let draft = withinLimits(draftFor(id, info, tab));
  const session = await getStoredSession();
  const count = (name: string) => void recordMetric(name.slice(0, 64), session);
  if (!session) {
    count(`menu-fail:${where}:session:signed-out`);
    return tell(tab, "failed", "Not added", "Sign in to Ajot to add tasks from the menu.");
  }
  const client = apiClient(session);
  try {
    const image =
      draft.image && allowed ? await readImage(session, draft.image, allowed) : undefined;
    if (image && "reason" in image) draft = withinLimits(draftFor("image-link", info, tab));
    const { taskId, failed } = await addDraft(client, draft, kind as DestinationKind, target);
    if (image && "file" in image && taskId && session.userId) {
      const refusal = await queueFile(image.file, {
        taskId,
        uploaderId: session.userId,
        maxBytes: image.maxBytes,
      });
      if (refusal) failed.push({ step: "image", label: "the image", reason: refusal });
      else void sendUploads();
    }
    count(`menu:${where}`);
    for (const part of failed) count(`menu-part-failed:${where}:${part.step}:${part.reason}`);
    if (image && "reason" in image)
      return await tell(tab, "done", "Added the image's link instead", image.reason);
    const done = doneLabels.get(`${kind}|${target}`) ?? "Added to Ajot";
    const parts = failed.map((part) => part.label).join(" and ");
    await tell(tab, "done", failed.length ? `Added, but ${parts} failed` : done, draft.title);
  } catch (err) {
    console.error("[menu] add failed:", err);
    const [failedStep, cause] = err instanceof StepFailed ? [err.step, err.cause] : ["other", err];
    count(`menu-fail:${where}:${failedStep}:${reasonOf(cause)}`);
    await tell(tab, "failed", "Not added", failureMessage(cause));
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
    const offered = ATTACHES.has(draftId)
      ? nonEmpty.filter((group) => group.destinations.every((d) => d.kind !== "send"))
      : nonEmpty;
    // Nowhere to choose from: the item itself adds to the Inbox
    if (offered.length === 1) {
      create({ id: `${draftId}|inbox`, ...item });
      continue;
    }
    create({ id: draftId, ...item });
    offered.forEach(({ submenu, destinations }, i) => {
      const child = { parentId: draftId, contexts: item.contexts };
      if (separatedFromPrevious(offered, i))
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
      void sendPendingMetrics(session);
      const groups = session
        ? await fetchDestinations(apiClient(session)).catch((err) => {
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
