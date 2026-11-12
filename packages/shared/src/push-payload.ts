import type { ModelName, MutationEvent } from "./constants";

export type PushPayload =
  | { type: "sync" }
  | { type: "deploy" }
  | ({ type: "changes" } & Partial<ChangeSummary>)
  | { type: "task-shared"; taskId: string; taskTitle: string; fromUser: string }
  | { type: "task-sent"; taskId: string; taskTitle: string; fromUser: string }
  // `more` is how many other tasks the same change made, for one notification standing for them all
  | {
      type: "task-updated";
      taskId: string;
      taskTitle: string;
      more: number;
      fromUser: string;
      changes: string;
    }
  | { type: "task-assigned"; taskId: string; taskTitle: string; fromUser: string }
  | { type: "task-completed"; taskId: string; taskTitle: string; more: number; byUser: string }
  | { type: "category-shared"; categoryId: string; categoryName: string; fromUser: string }
  | { type: "contact-accepted"; contactName: string }
  | { type: "reminder-due"; taskId: string; taskTitle: string; dueDate: string }
  | {
      type: "overdue-digest";
      tasks: Array<{ id: string; title: string; dueDate: string }>;
      // All of them, when a push only has room for some in tasks
      total?: number;
    };

/** One thing a "changes" push is about. */
export type ChangedItem = {
  id: string;
  model: ModelName;
  action: MutationEvent["action"];
  /** A removal carries no name, nor does an update that only sends some fields */
  name?: string;
  /** Who made the change, when it wasn't the person notified */
  by?: string;
};

export type ChangeSummary = {
  changed: ChangedItem[];
  /** How many more items there were than fit */
  more: number;
};

/** Enough for a notification, small enough to leave the push room for its rows. */
export const MAX_CHANGED_ITEMS = 20;
export const MAX_CHANGED_NAME = 60;

/**
 * One item per thing changed, in the order first changed. Something added and then edited
 * still reads as added.
 */
export const mergeChanges = (
  earlier: ChangeSummary | undefined,
  later: ChangeSummary,
): ChangeSummary => {
  const byKey = new Map<string, ChangedItem>();
  for (const item of [...(earlier?.changed ?? []), ...later.changed]) {
    const key = `${item.model}:${item.id}`;
    const before = byKey.get(key);
    const action = before?.action === "insert" && item.action === "update" ? "insert" : item.action;
    // By whoever changed it last: an item of the recipient's own has no `by` to overwrite with
    byKey.set(key, { ...before, ...item, action, name: item.name ?? before?.name, by: item.by });
  }
  const items = [...byKey.values()];
  return {
    changed: items.slice(0, MAX_CHANGED_ITEMS),
    more: (earlier?.more ?? 0) + later.more + Math.max(0, items.length - MAX_CHANGED_ITEMS),
  };
};

const VERBS: Record<ChangedItem["action"], string> = {
  insert: "added",
  update: "edited",
  delete: "removed",
};

const UNNAMED: Record<ModelName, [one: string, many: string]> = {
  tasks: ["a task", "tasks"],
  categories: ["a list", "lists"],
  notes: ["a note", "notes"],
  contacts: ["a contact", "contacts"],
  attachments: ["a file", "files"],
};

const SHOWN_NAMES = 2;

/** `added "Milk", "Bread" and 2 more`, or `removed 2 tasks` when none has a name. */
const clauseFor = (verb: string, items: ChangedItem[]) => {
  const names = items.flatMap((item) => (item.name ? [`"${item.name}"`] : []));
  if (names.length === 0) {
    const models = new Set(items.map((item) => item.model));
    const [model] = models;
    if (models.size > 1 || !model) return `${verb} ${items.length} things`;
    const [one, many] = UNNAMED[model];
    return `${verb} ${items.length === 1 ? one : `${items.length} ${many}`}`;
  }
  const shown = names.slice(0, SHOWN_NAMES);
  const rest = items.length - shown.length;
  const last = rest > 0 ? `${rest} more` : shown.pop();
  return `${verb} ${shown.length > 0 ? `${shown.join(", ")} and ${last}` : last}`;
};

const capitalised = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

const describe = (items: ChangedItem[]) =>
  capitalised(
    (["insert", "update", "delete"] as const)
      .map((action) => items.filter((item) => item.action === action))
      .filter((some) => some.length > 0)
      .map((some) => clauseFor(VERBS[some[0]!.action], some))
      .join(" · "),
  );

/** Titled by whoever made the changes, or one line each when it was several people. */
export const changesNotification = (summary: ChangeSummary): ShownNotification => {
  const people = new Map<string | undefined, ChangedItem[]>();
  for (const item of summary.changed) people.set(item.by, [...(people.get(item.by) ?? []), item]);
  const extra = summary.more > 0 ? ` · and ${summary.more} more` : "";
  const single = people.size === 1;
  const [firstBy] = people.keys();
  return {
    title: (single && firstBy) || "Ajot",
    body: single
      ? describe(summary.changed) + extra
      : [...people].map(([by, items]) => `${by ?? "You"}: ${describe(items)}`).join("\n") + extra,
    url: "/",
    tag: "changes",
    changes: summary,
  };
};

/**
 * The changes behind a push, so a device whose fetch then fails still saves them. Only ever sent
 * to the account they belong to, and left off a push they would make too large.
 */
export type PushRows = { userId: string; events: Omit<MutationEvent, "sourceClientId">[] };

export type PushMessage = PushPayload & { rows?: PushRows };

/** Stored as what's muted, so a trigger added later starts on. */
export const PUSH_TRIGGERS = [
  "own-changes",
  "others-changes",
  "shared",
  "assigned",
  "updated",
  "completed",
  "contact-accepted",
  "reminder",
  "overdue",
] as const;
export type PushTrigger = (typeof PUSH_TRIGGERS)[number];

type SilentPushType = "sync" | "deploy";

/** "changes" is either trigger, depending on who made the change. */
export const NOTIFICATION_TRIGGERS: Record<
  Exclude<PushPayload["type"], SilentPushType | "changes">,
  PushTrigger
> = {
  "task-shared": "shared",
  "task-sent": "shared",
  "category-shared": "shared",
  "task-assigned": "assigned",
  "task-updated": "updated",
  "task-completed": "completed",
  "contact-accepted": "contact-accepted",
  "reminder-due": "reminder",
  "overdue-digest": "overdue",
};

const tasksNamed = ({ taskTitle, more }: { taskTitle: string; more: number }) =>
  more ? `"${taskTitle}" and ${more} more` : `"${taskTitle}"`;

const overdueCount = (payload: Extract<PushPayload, { type: "overdue-digest" }>) =>
  payload.total ?? payload.tasks.length;

export type ShownNotification = {
  title: string;
  body: string;
  url: string;
  /** What it's about, so a newer notification about the same thing replaces it */
  tag: string;
  /** What a "changes" notification lists, for the next one to add to */
  changes?: ChangeSummary;
};

export const toNotification = (payload: PushPayload): ShownNotification | null => {
  switch (payload.type) {
    case "sync":
    case "deploy":
      return null;
    case "changes":
      return payload.changed && payload.changed.length > 0
        ? changesNotification({ changed: payload.changed, more: payload.more ?? 0 })
        : { title: "Ajot", body: "Your lists were updated", url: "/", tag: "changes" };
    case "task-shared":
      return {
        title: payload.fromUser,
        body: `Shared "${payload.taskTitle}" with you`,
        url: `/task/${payload.taskId}`,
        tag: `task:${payload.taskId}`,
      };
    case "task-sent":
      return {
        title: payload.fromUser,
        body: `Sent you "${payload.taskTitle}"`,
        url: `/task/${payload.taskId}`,
        tag: `task:${payload.taskId}`,
      };
    case "task-updated":
      return {
        title: payload.fromUser,
        body: `Updated ${tasksNamed(payload)}: ${payload.changes}`,
        url: payload.more ? "/" : `/task/${payload.taskId}`,
        tag: `task:${payload.taskId}`,
      };
    case "task-assigned":
      return {
        title: payload.fromUser,
        body: `Assigned "${payload.taskTitle}" to you`,
        url: `/task/${payload.taskId}`,
        tag: `task:${payload.taskId}`,
      };
    case "task-completed":
      return {
        title: payload.byUser,
        body: `Completed ${tasksNamed(payload)}`,
        url: payload.more ? "/" : `/task/${payload.taskId}`,
        tag: `task:${payload.taskId}`,
      };
    case "category-shared":
      return {
        title: payload.fromUser,
        body: `Shared the list "${payload.categoryName}" with you`,
        url: `/list/${payload.categoryId}`,
        tag: `list:${payload.categoryId}`,
      };
    case "contact-accepted":
      return {
        title: "Ajot",
        body: `${payload.contactName} accepted your invite`,
        url: "/people",
        tag: `contact:${payload.contactName}`,
      };
    case "reminder-due":
      return {
        title: "Reminder",
        body: `"${payload.taskTitle}" is due`,
        url: `/task/${payload.taskId}`,
        tag: `task:${payload.taskId}`,
      };
    case "overdue-digest":
      return {
        title: "Overdue tasks",
        body: `You have ${overdueCount(payload)} overdue task${overdueCount(payload) === 1 ? "" : "s"}`,
        url: "/",
        tag: "overdue",
      };
  }
};
