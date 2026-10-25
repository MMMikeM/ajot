import type { MutationEvent } from "./constants";

export type PushPayload =
  | { type: "sync" }
  | { type: "deploy" }
  | { type: "changes" }
  | { type: "task-shared"; taskId: string; taskTitle: string; fromUser: string }
  | { type: "task-sent"; taskId: string; taskTitle: string; fromUser: string }
  | { type: "task-updated"; taskId: string; taskTitle: string; fromUser: string; changes: string }
  | { type: "task-assigned"; taskId: string; taskTitle: string; fromUser: string }
  | { type: "task-completed"; taskId: string; taskTitle: string; byUser: string }
  | { type: "category-shared"; categoryId: string; categoryName: string; fromUser: string }
  | { type: "contact-accepted"; contactName: string }
  | { type: "reminder-due"; taskId: string; taskTitle: string; dueDate: string }
  | {
      type: "overdue-digest";
      tasks: Array<{ id: string; title: string; dueDate: string }>;
      // All of them, when a push only has room for some in tasks
      total?: number;
    };

/**
 * The changes behind a push, so a device whose fetch then fails still saves them. Only ever sent
 * to the account they belong to, and left off a push they would make too large.
 */
export type PushRows = { userId: string; events: Omit<MutationEvent, "sourceClientId">[] };

export type PushMessage = PushPayload & { rows?: PushRows };

/**
 * What can send a device a notification, each of which a person can turn off per device. Stored
 * as what's muted, so a trigger added later starts on.
 */
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

// Background sync for the extensions, so never something to turn off
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

const overdueCount = (payload: Extract<PushPayload, { type: "overdue-digest" }>) =>
  payload.total ?? payload.tasks.length;

export const toNotification = (
  payload: PushPayload,
): { title: string; body: string; url: string } | null => {
  switch (payload.type) {
    case "sync":
    case "deploy":
      return null;
    case "changes":
      return { title: "Ajot", body: "Your lists were updated", url: "/" };
    case "task-shared":
      return {
        title: payload.fromUser,
        body: `Shared "${payload.taskTitle}" with you`,
        url: `/task/${payload.taskId}`,
      };
    case "task-sent":
      return {
        title: payload.fromUser,
        body: `Sent you "${payload.taskTitle}"`,
        url: `/task/${payload.taskId}`,
      };
    case "task-updated":
      return {
        title: payload.fromUser,
        body: `Updated "${payload.taskTitle}": ${payload.changes}`,
        url: `/task/${payload.taskId}`,
      };
    case "task-assigned":
      return {
        title: payload.fromUser,
        body: `Assigned "${payload.taskTitle}" to you`,
        url: `/task/${payload.taskId}`,
      };
    case "task-completed":
      return {
        title: payload.byUser,
        body: `Completed "${payload.taskTitle}"`,
        url: `/task/${payload.taskId}`,
      };
    case "category-shared":
      return {
        title: payload.fromUser,
        body: `Shared category "${payload.categoryName}" with you`,
        url: `/list/${payload.categoryId}`,
      };
    case "contact-accepted":
      return {
        title: "Ajot",
        body: `${payload.contactName} accepted your contact request`,
        url: "/people",
      };
    case "reminder-due":
      return {
        title: "Reminder",
        body: `"${payload.taskTitle}" is due`,
        url: `/task/${payload.taskId}`,
      };
    case "overdue-digest":
      return {
        title: "Overdue tasks",
        body: `You have ${overdueCount(payload)} overdue task${overdueCount(payload) === 1 ? "" : "s"}`,
        url: "/",
      };
  }
};
