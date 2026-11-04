import { SERVER_URL_KEY, TOKEN_KEY } from "@newtab-todo/shared/constants";
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
import { fetchImage } from "~/lib/files/remote-image";
import { createUploadSender } from "~/lib/files/sender";
import { recordMetric, sendPendingMetrics } from "~/lib/metrics";
import { showPageToast, type PageToastTone } from "~/lib/page-toast";
import {
  announceKeptShare,
  keepShare,
  type KeptShare,
  type ShareDestination,
} from "~/lib/share-store";
import { keepAndSend, reasonOf, sendKeptShares, type SendOutcome } from "~/lib/send-kept-shares";
import type { SharedText } from "@newtab-todo/shared/share-target";
import { isPopupAdd, type PopupAdd, type PopupReply } from "~/lib/popup-message";

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

const OPEN = {
  id: "open",
  title: "Add and open in Ajot…",
  contexts: ["page", "link", "selection", "image"],
} satisfies { id: string; title: string; contexts: ContextType[] };

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

const imageFile = (src: string, blob: Blob) => {
  const name = imageName(src) || `image.${blob.type.split("/")[1]?.split("+")[0] || "png"}`;
  return new File([blob], name, { type: blob.type });
};

type ReadImage = { file: File } | { reason: string };

/** The image as a file to attach, or why it can't be, so its link is added instead. */
const readImage = async (
  session: SignedInSession,
  src: string,
  allowed: Promise<boolean>,
): Promise<ReadImage> => {
  // Made by the page itself, so only the page can read it
  if (src.startsWith("blob:")) return { reason: "That image can only be saved as its link." };
  if (!(await allowed)) return { reason: "Ajot wasn't allowed to read images from that site." };
  // Unanswered, the limit is checked once the share is sent
  const attachments = await fetchServerConfig(session.serverUrl).then(
    (config) => config.attachments,
    () => undefined,
  );
  if (attachments === null) return { reason: "Your server doesn't take attachments." };
  try {
    const blob = await fetchImage(src);
    if (attachments && blob.size > attachments.maxBytes)
      return { reason: `The image is over ${Math.round(attachments.maxBytes / MB)} MB.` };
    return { file: imageFile(src, blob) };
  } catch (err) {
    console.error("[menu] couldn't read the image:", err);
    return { reason: "The image couldn't be fetched from its site." };
  }
};

/** What the app's share page adds and opens: the link, image, selection or page clicked. */
const shareFor = (
  info: ClickData,
  tab?: browser.tabs.Tab,
): { from: string; text: SharedText; image?: string } => {
  const url = tab?.url ?? info.pageUrl ?? "";
  const title = tab?.title ?? "";
  if (info.linkUrl)
    return {
      from: "link",
      text: { title: info.linkText || info.selectionText || "", url: info.linkUrl },
    };
  if (info.mediaType === "image" && info.srcUrl) {
    const src = info.srcUrl;
    const imageTitle = imageName(src) || `Image from ${title || url}`;
    return { from: "image", text: { title: imageTitle, url }, image: src };
  }
  if (info.selectionText)
    return { from: "selection", text: { title, text: info.selectionText, url } };
  return { from: "page", text: { title, url } };
};

/** The image to attach, or undefined when it can't be read, so its link is kept instead. */
const keptImage = async (src: string, allowed: Promise<boolean>) => {
  if (src.startsWith("blob:") || !(await allowed)) return undefined;
  try {
    return imageFile(src, await fetchImage(src));
  } catch (err) {
    console.error("[menu] couldn't read the image:", err);
    return undefined;
  }
};

/**
 * Keeps what was clicked on the device and opens the app's share page on it, which adds it to the
 * Inbox in the app's own store, offline too, and opens its sheet to edit, share or send.
 */
type OpenRequest = {
  from: string;
  text: SharedText;
  image?: string;
  allowed?: Promise<boolean>;
  tab?: browser.tabs.Tab;
  onKept?: () => void;
};

const keepAndOpen = async ({ from, text, image, allowed, tab, onKept }: OpenRequest) => {
  const where = `open:${from}`;
  const count = (name: string, session: SignedInSession | null) =>
    void recordMetric(name.slice(0, 64), session);
  count(`menu-click:${where}`, null);
  const id = crypto.randomUUID();
  try {
    const file = image && allowed ? await keptImage(image, allowed) : undefined;
    const imageLink = image && !file && image.startsWith("http") ? image : undefined;
    await keepShare(id, imageLink ? { ...text, text: imageLink } : text, file ? [file] : []);
    onKept?.();
  } catch (err) {
    console.error("[menu] couldn't keep it:", err);
    count(`menu-fail:${where}:keep:${reasonOf(err)}`, null);
    return tell(tab, "failed", "Not added", "Ajot couldn't save it on this device. Try again.");
  }
  // Kept, so from here a failure mustn't say "Not added": the next Ajot tab adds it
  try {
    const besideTab = tab && tab.id !== undefined && tab.id >= 0 && !tab.incognito;
    await ext.tabs.create({
      url: ext.runtime.getURL(`index.html#/share?id=${id}`),
      ...(besideTab && { index: tab.index + 1, openerTabId: tab.id, windowId: tab.windowId }),
    });
  } catch (err) {
    console.error("[menu] couldn't open Ajot:", err);
    count(`menu-fail:${where}:tab:${reasonOf(err)}`, null);
    return tell(tab, "done", "Saved for Ajot", "It'll be in your Inbox when you next open Ajot.");
  }
  void getStoredSession()
    .then((session) => count(`menu:${where}`, session))
    .catch(console.error);
};

const openInAjot = (info: ClickData, tab?: browser.tabs.Tab) => {
  const { from, text, image } = shareFor(info, tab);
  const allowed = image ? askToReadImages(image) : undefined;
  return keepAndOpen({ from, text, image, allowed, tab });
};

let doneLabels = new Map<string, string>();

const destinationOf = (kind: DestinationKind, target: string): ShareDestination => {
  switch (kind) {
    case "inbox":
      return { kind };
    case "list":
      return { kind, categoryId: target };
    case "share":
      return { kind, username: target };
    case "send":
      return { kind, recipientId: target };
  }
};

const keptFrom = (draft: Draft, to: ShareDestination, userId: string | null): KeptShare => ({
  title: draft.title,
  ...(draft.description && { text: draft.description }),
  to,
  ...(draft.note && { note: { id: crypto.randomUUID(), content: draft.note } }),
  ...(userId && { userId }),
});

const waitingTitle = (to: ShareDestination, error: unknown) => {
  if (error instanceof ApiError && error.status === 401) return "Saved. Sign in to Ajot to add it";
  if (error instanceof ApiError) return "Saved. Ajot adds it once the server answers";
  if (to.kind === "share") return "Saved. Ajot shares it once you're online";
  if (to.kind === "send") return "Saved. Ajot sends it once you're online";
  return "Saved. Ajot adds it once you're online";
};

const partsFailed = (outcome: Extract<SendOutcome, { status: "sent" }>) =>
  outcome.failed.map((part) => part.label).join(" and ");

const handleClick = async (info: ClickData, tab?: browser.tabs.Tab) => {
  const menuId = String(info.menuItemId);
  if (menuId === OPEN.id) return openInAjot(info, tab);
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
  const image =
    draft.image && allowed ? await readImage(session, draft.image, allowed) : undefined;
  if (image && "reason" in image) draft = withinLimits(draftFor("image-link", info, tab));
  return addAndTell({
    session,
    draft,
    to: destinationOf(kind as DestinationKind, target),
    where,
    done: doneLabels.get(`${kind}|${target}`) ?? "Added to Ajot",
    tab,
    image,
  });
};

type AddRequest = {
  session: SignedInSession;
  draft: Draft;
  to: ShareDestination;
  /** Where the add came from, for its metrics. */
  where: string;
  done: string;
  tab?: browser.tabs.Tab;
  image?: ReadImage;
  onKept?: () => void;
};

/** Keeps the add, sends it, and says on the page how that went. */
const addAndTell = async ({ session, draft, to, where, done, tab, image, onKept }: AddRequest) => {
  const count = (name: string) => void recordMetric(name.slice(0, 64), session);
  const files = image && "file" in image ? [image.file] : [];
  const kept = keptFrom(draft, to, session.userId);
  let outcome: SendOutcome;
  try {
    outcome = await keepAndSend(session, crypto.randomUUID(), kept, files, onKept);
  } catch (err) {
    console.error("[menu] couldn't keep it:", err);
    count(`menu-fail:${where}:keep:${reasonOf(err)}`);
    return tell(tab, "failed", "Not added", "Ajot couldn't save it on this device. Try again.");
  }
  switch (outcome.status) {
    case "sent": {
      count(`menu:${where}`);
      for (const part of outcome.failed)
        count(`menu-part-failed:${where}:${part.step}:${part.reason}`);
      if (image && "file" in image) void sendUploads();
      if (image && "reason" in image)
        return tell(tab, "done", "Added the image's link instead", image.reason);
      const title = outcome.failed.length ? `Added, but ${partsFailed(outcome)} failed` : done;
      return tell(tab, "done", title, draft.title);
    }
    case "waiting":
      count(`menu-queued:${where}:${outcome.step}:${reasonOf(outcome.error)}`);
      // An open Ajot tab adds it to its own lists, so it shows there while the server can't
      if (to.kind === "inbox" || to.kind === "list") announceKeptShare();
      return tell(tab, "done", waitingTitle(to, outcome.error), draft.title);
    case "refused":
      count(`menu-fail:${where}:${outcome.step}:${reasonOf(outcome.error)}`);
      return tell(tab, "failed", "Not added", failureMessage(outcome.error));
    case "skipped":
      return undefined;
  }
};

const tabById = (tabId: number | undefined) =>
  tabId === undefined ? Promise.resolve(undefined) : ext.tabs.get(tabId).catch(() => undefined);

/** The toolbar popup's add, answered as soon as it's kept so the popup can close. */
const addFromPopup = async (message: PopupAdd, reply: (answer: PopupReply) => void) => {
  let replied = false;
  const answer = (kept: boolean) => {
    if (replied) return;
    replied = true;
    reply({ kept });
  };
  try {
    const tab = await tabById(message.tabId);
    const draft = withinLimits({ title: message.title, description: message.description });
    if (message.open) {
      const text = { title: draft.title, ...(draft.description && { text: draft.description }) };
      return await keepAndOpen({ from: "popup", text, tab, onKept: () => answer(true) });
    }
    const session = await getStoredSession();
    if (!session) return;
    const where = `popup:${message.to.kind}`;
    void recordMetric(`menu-click:${where}`, null);
    const { to, done } = message;
    await addAndTell({ session, draft, to, done, where, tab, onKept: () => answer(true) });
  } finally {
    answer(false);
  }
};

/**
 * Sends what the menu saved while the server couldn't be reached, at each of a background's
 * wakes; says so only for what the server refuses, which nothing will add.
 */
export const sendMenuShares = async () => {
  const session = await getStoredSession();
  if (!session) return;
  for (const { outcome } of await sendKeptShares(session)) {
    if (outcome.status === "sent") {
      void recordMetric("menu-retry:sent", session);
      if (outcome.failed.length)
        await notify(`Added, but ${partsFailed(outcome)} failed`, outcome.title);
    }
    if (outcome.status === "refused") {
      void recordMetric(
        `menu-retry:refused:${outcome.step}:${reasonOf(outcome.error)}`.slice(0, 64),
        session,
      );
      await notify(`Not added: ${outcome.title}`, failureMessage(outcome.error));
    }
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
  create({ id: `${OPEN.id}-separator`, type: "separator", contexts: OPEN.contexts });
  create(OPEN);
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
    // True keeps the reply open past this call, in Chrome and Firefox alike
    ext.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
      if (sender.id !== ext.runtime.id || !isPopupAdd(message)) return undefined;
      void addFromPopup(message, sendResponse).catch(console.error);
      return true;
    });
    // Firefox for Android has no context menus, though it has the popup
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
