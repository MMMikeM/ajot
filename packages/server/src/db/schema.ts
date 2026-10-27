import { defineRelations, sql } from "drizzle-orm";
import {
  check,
  index,
  primaryKey,
  sqliteTable,
  uniqueIndex,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import {
  pk,
  string,
  nullableString,
  oneOf,
  fk,
  nullableFk,
  createdAt,
  updatedAt,
  int,
  json,
  nullableJson,
  bool,
} from "./columns";
import type { PushTrigger } from "@newtab-todo/shared/push-payload";

export const categories = sqliteTable(
  "categories",
  {
    id: pk(),
    userId: fk("user_id", () => users.id, { onDelete: "cascade" }),
    name: string("name"),
    color: nullableString("color"),
    sortOrder: nullableString("sort_order"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    // Deleting hides a list rather than removing it, so Undo brings back its collaborators and
    // its tasks for everyone
    deletedAt: nullableString("deleted_at"),
    deletion: nullableJson<CategoryDeletion>("deletion"),
  },
  (t) => [index("categories_user_idx").on(t.userId)],
);

/** What deleting a list changed beyond the list itself, so Undo can put exactly that back. */
export type CategoryDeletion = {
  deletedTaskIds: string[];
  movedTaskIds: string[];
  unfiledShares: { taskId: string; sharedWithUserId: string }[];
};

export const taskStatuses = ["todo", "in_progress", "done"] as const;

export const tasks = sqliteTable(
  "tasks",
  {
    id: pk(),
    userId: fk("user_id", () => users.id, { onDelete: "cascade" }),
    categoryId: nullableFk("category_id", () => categories.id, { onDelete: "set null" }),
    assigneeId: nullableFk("assignee_id", () => users.id, { onDelete: "set null" }),
    parentId: nullableFk("parent_id", (): AnySQLiteColumn => tasks.id, { onDelete: "cascade" }),
    title: string("title"),
    description: nullableString("description"),
    status: oneOf("status", taskStatuses).default("todo"),
    dueDate: nullableString("due_date"),
    sortOrder: nullableString("sort_order"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    editedAt: nullableString("edited_at"),
    completedAt: nullableString("completed_at"),
    // Deleting hides a task rather than removing it, so Undo restores it for everyone
    deletedAt: nullableString("deleted_at"),
  },
  // A subtask goes wherever its parent is; a list of its own would add that list's people to it
  (t) => [
    check("subtask_has_no_list", sql`${t.parentId} IS NULL OR ${t.categoryId} IS NULL`),
    // For task_access, looked up by task and by user
    index("tasks_user_idx").on(t.userId),
    index("tasks_category_idx").on(t.categoryId),
    index("tasks_parent_idx").on(t.parentId),
  ],
);

export const users = sqliteTable("users", {
  id: pk(),
  name: string("name"),
  username: string("username").unique(),
  passwordHash: string("password_hash"),
  avatarUrl: nullableString("avatar_url"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const sessions = sqliteTable("sessions", {
  id: pk(),
  userId: fk("user_id", () => users.id, { onDelete: "cascade" }),
  expiresAt: string("expires_at"),
  createdAt: createdAt(),
});

export const notes = sqliteTable(
  "notes",
  {
    id: pk(),
    userId: fk("user_id", () => users.id, { onDelete: "cascade" }),
    title: string("title"),
    content: nullableString("content"),
    taskId: fk("task_id", () => tasks.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("notes_user_idx").on(t.userId)],
);

export const sharePermissions = ["view", "edit"] as const;

export const taskShares = sqliteTable(
  "task_shares",
  {
    id: pk(),
    taskId: fk("task_id", () => tasks.id, { onDelete: "cascade" }),
    sharedWithUserId: fk("shared_with_user_id", () => users.id, { onDelete: "cascade" }),
    categoryId: nullableFk("category_id", () => categories.id, { onDelete: "set null" }),
    permission: oneOf("permission", sharePermissions).default("edit"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("task_shares_task_idx").on(t.taskId),
    index("task_shares_user_idx").on(t.sharedWithUserId),
  ],
);

// Only an extension subscription (userVisibleOnly: false) may receive pushes that show nothing.
export const pushSubscriptionKinds = ["web", "extension"] as const;

export const pushSubscriptions = sqliteTable("push_subscriptions", {
  id: pk(),
  userId: nullableFk("user_id", () => users.id, { onDelete: "set null" }),
  endpoint: string("endpoint").unique(),
  p256dh: string("p256dh"),
  auth: string("auth"),
  kind: oneOf("kind", pushSubscriptionKinds).default("web"),
  // The device that subscribed, so a change it made isn't announced back to it
  deviceId: nullableString("device_id"),
  createdAt: createdAt(),
});

// Kept apart from push_subscriptions, whose row is replaced on every upload and deleted when a
// device turns push off
export const pushPreferences = sqliteTable(
  "push_preferences",
  {
    userId: fk("user_id", () => users.id, { onDelete: "cascade" }),
    deviceId: string("device_id"),
    muted: json<PushTrigger[]>("muted"),
    // Off lets an idle phone hold its pushes until it next wakes, saving battery
    urgent: bool("urgent").default(true),
  },
  (t) => [primaryKey({ columns: [t.userId, t.deviceId] })],
);

// Two rows per connection (A→B and B→A) for simple WHERE userId = me queries.
export const contacts = sqliteTable(
  "contacts",
  {
    id: pk(),
    userId: fk("user_id", () => users.id, { onDelete: "cascade" }),
    contactUserId: fk("contact_user_id", () => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("contacts_user_contact_idx").on(t.userId, t.contactUserId)],
);

type ContactRow = typeof contacts.$inferSelect;
type CollaboratorRow = typeof categoryCollaborators.$inferSelect;

// Removing a contact deletes both rows and the lists they shared; this keeps them for Undo
export const removedContacts = sqliteTable("removed_contacts", {
  // The remover's contact row id, which their Undo names
  id: pk(),
  userId: fk("user_id", () => users.id, { onDelete: "cascade" }),
  contacts: json<ContactRow[]>("contacts"),
  collaborators: json<CollaboratorRow[]>("collaborators"),
  removedAt: createdAt("removed_at"),
});

export const inviteTokens = sqliteTable("invite_tokens", {
  id: pk(),
  createdByUserId: fk("created_by_user_id", () => users.id, { onDelete: "cascade" }),
  expiresAt: string("expires_at"),
  usedAt: nullableString("used_at"),
  usedByUserId: nullableFk("used_by_user_id", () => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
});

export const categoryCollaborators = sqliteTable(
  "category_collaborators",
  {
    id: pk(),
    categoryId: fk("category_id", () => categories.id, { onDelete: "cascade" }),
    userId: fk("user_id", () => users.id, { onDelete: "cascade" }),
    addedAt: createdAt("added_at"),
  },
  (t) => [
    uniqueIndex("category_collaborators_cat_user_idx").on(t.categoryId, t.userId),
    index("category_collaborators_user_idx").on(t.userId),
  ],
);

export const notificationQueueTypes = ["reminder-due", "overdue-digest"] as const;

export const notificationQueue = sqliteTable("notification_queue", {
  id: pk(),
  userId: fk("user_id", () => users.id, { onDelete: "cascade" }),
  type: oneOf("type", notificationQueueTypes),
  taskId: nullableFk("task_id", () => tasks.id, { onDelete: "cascade" }),
  scheduledFor: string("scheduled_for"),
  sentAt: nullableString("sent_at"),
  createdAt: createdAt(),
});

// Usage counts per UTC day, with nothing about who: enough to see which features get used
export const metricCounts = sqliteTable(
  "metric_counts",
  {
    name: string("name"),
    day: string("day"),
    count: int("count").default(0),
  },
  (t) => [primaryKey({ columns: [t.name, t.day] })],
);

export { listMembers, taskAccess } from "./views";

export const relations = defineRelations(
  {
    tasks,
    users,
    notes,
    categories,
    pushSubscriptions,
    pushPreferences,
    sessions,
    taskShares,
    contacts,
    removedContacts,
    inviteTokens,
    categoryCollaborators,
    notificationQueue,
    metricCounts,
  },
  (r) => ({
    users: {
      tasks: r.many.tasks({ from: r.users.id, to: r.tasks.userId }),
      notes: r.many.notes(),
      categories: r.many.categories(),
      sessions: r.many.sessions(),
      sharedTasks: r.many.taskShares(),
      categoryCollaborations: r.many.categoryCollaborators(),
    },
    sessions: {
      user: r.one.users({
        from: r.sessions.userId,
        to: r.users.id,
      }),
    },
    categories: {
      user: r.one.users({
        from: r.categories.userId,
        to: r.users.id,
      }),
      tasks: r.many.tasks(),
      collaborators: r.many.categoryCollaborators(),
    },
    tasks: {
      user: r.one.users({
        from: r.tasks.userId,
        to: r.users.id,
      }),
      category: r.one.categories({
        from: r.tasks.categoryId,
        to: r.categories.id,
      }),
      assignee: r.one.users({
        from: r.tasks.assigneeId,
        to: r.users.id,
      }),
      parent: r.one.tasks({
        from: r.tasks.parentId,
        to: r.tasks.id,
      }),
      subtasks: r.many.tasks(),
      notes: r.many.notes(),
      shares: r.many.taskShares(),
    },
    taskShares: {
      task: r.one.tasks({
        from: r.taskShares.taskId,
        to: r.tasks.id,
      }),
      sharedWithUser: r.one.users({
        from: r.taskShares.sharedWithUserId,
        to: r.users.id,
      }),
      category: r.one.categories({
        from: r.taskShares.categoryId,
        to: r.categories.id,
      }),
    },
    notes: {
      user: r.one.users({
        from: r.notes.userId,
        to: r.users.id,
      }),
      task: r.one.tasks({
        from: r.notes.taskId,
        to: r.tasks.id,
      }),
    },
    contacts: {
      user: r.one.users({
        from: r.contacts.userId,
        to: r.users.id,
      }),
      contactUser: r.one.users({
        from: r.contacts.contactUserId,
        to: r.users.id,
      }),
    },
    inviteTokens: {
      createdByUser: r.one.users({
        from: r.inviteTokens.createdByUserId,
        to: r.users.id,
      }),
      usedByUser: r.one.users({
        from: r.inviteTokens.usedByUserId,
        to: r.users.id,
      }),
    },
    categoryCollaborators: {
      category: r.one.categories({
        from: r.categoryCollaborators.categoryId,
        to: r.categories.id,
      }),
      user: r.one.users({
        from: r.categoryCollaborators.userId,
        to: r.users.id,
      }),
    },
    notificationQueue: {
      user: r.one.users({
        from: r.notificationQueue.userId,
        to: r.users.id,
      }),
      task: r.one.tasks({
        from: r.notificationQueue.taskId,
        to: r.tasks.id,
      }),
    },
  }),
);
