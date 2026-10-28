import { sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { hoursFromNow, now } from "@newtab-todo/shared/iso";
import { db } from "./client";
import {
  categories,
  inviteTokens,
  notificationQueue,
  removedCollaborators,
  removedContacts,
  sessions,
  tasks,
  taskShares,
} from "./schema";
import { undoableSince } from "./undo-window";

/** What this needs of a drizzle SQLite database: Turso's, or node:sqlite's in the tests. */
type Database = { all<T>(query: SQL): T[] | PromiseLike<T[]> };

export const KEEP_DELETED_DAYS = 30;
// The digest check reads only today's; the rest is for seeing what went out when one is missed
export const KEEP_SENT_DAYS = 7;

const child = alias(tasks, "child");
const sharedTask = alias(tasks, "shared_task");

/**
 * A task deleted over KEEP_DELETED_DAYS ago, with its notes, shares and reminders, which the
 * foreign keys cascade to. Not while a subtask under it was deleted more recently, which the
 * parent's delete would cascade to. A live one can't be under a deleted parent
 * (live_subtask_has_live_parent).
 */
const purgeTasks = (database: Database, cutoff: string) =>
  database.all<{ id: string }>(sql`DELETE FROM ${tasks}
    WHERE ${tasks.deletedAt} < ${cutoff}
      AND NOT EXISTS (SELECT 1 FROM ${tasks} ${child} WHERE ${child.parentId} = ${tasks.id}
        AND ${child.deletedAt} >= ${cutoff})
    RETURNING ${tasks.id}`);

/**
 * A list deleted over KEEP_DELETED_DAYS ago, with its collaborators and what its Undo kept, once
 * the tasks deleted with it have gone. Not while a live task or share is still filed in it, which
 * the foreign keys would move to the Inbox unannounced.
 */
const purgeLists = (database: Database, cutoff: string) =>
  database.all<{ id: string }>(sql`DELETE FROM ${categories}
    WHERE ${categories.deletedAt} < ${cutoff}
      AND NOT EXISTS (SELECT 1 FROM ${tasks} WHERE ${tasks.categoryId} = ${categories.id}
        AND ${tasks.deletedAt} IS NULL)
      AND NOT EXISTS (SELECT 1 FROM ${taskShares}
        JOIN ${tasks} ${sharedTask} ON ${sharedTask.id} = ${taskShares.taskId}
        WHERE ${taskShares.categoryId} = ${categories.id} AND ${sharedTask.deletedAt} IS NULL)
    RETURNING ${categories.id}`);

/** Undo records past their hour, which the next removal would drop anyway, if there is one. */
const purgeUndoRecords = async (database: Database, since: string) => {
  const contacts = await database.all<{ id: string }>(sql`DELETE FROM ${removedContacts}
    WHERE ${removedContacts.removedAt} < ${since} RETURNING ${removedContacts.id}`);
  const collaborators = await database.all<{ id: string }>(sql`DELETE FROM ${removedCollaborators}
    WHERE ${removedCollaborators.removedAt} < ${since} RETURNING ${removedCollaborators.id}`);
  return { contacts: contacts.length, collaborators: collaborators.length };
};

/** Sessions past their expiry, which sign no one in again. */
const purgeSessions = (database: Database) =>
  database.all<{ id: string }>(sql`DELETE FROM ${sessions}
    WHERE ${sessions.expiresAt} < ${now()} RETURNING ${sessions.id}`);

/**
 * Invites used or expired over KEEP_DELETED_DAYS ago. Kept until then, so accepting a dead link
 * still logs which it was, and a signup that fails can still release the invite it claimed.
 */
const purgeInvites = (database: Database, cutoff: string) =>
  database.all<{ id: string }>(sql`DELETE FROM ${inviteTokens}
    WHERE ${inviteTokens.usedAt} < ${cutoff} OR ${inviteTokens.expiresAt} < ${cutoff}
    RETURNING ${inviteTokens.id}`);

/**
 * Notifications sent over KEEP_SENT_DAYS ago, and ones due over KEEP_DELETED_DAYS ago and never
 * sent, which no run of the cron will send in time to matter. Every one due is marked sent when
 * it's processed, delivered or not.
 */
const purgeNotifications = (database: Database, cutoff: string) =>
  database.all<{ id: string }>(sql`DELETE FROM ${notificationQueue}
    WHERE ${notificationQueue.sentAt} < ${hoursFromNow(-KEEP_SENT_DAYS * 24)}
      OR (${notificationQueue.sentAt} IS NULL AND ${notificationQueue.scheduledFor} < ${cutoff})
    RETURNING ${notificationQueue.id}`);

/** How many of each were purged. Tasks go first, so a list's go before the list is checked. */
export const purgeExpired = async (database: Database = db) => {
  const cutoff = hoursFromNow(-KEEP_DELETED_DAYS * 24);
  const purgedTasks = await purgeTasks(database, cutoff);
  const purgedLists = await purgeLists(database, cutoff);
  const undoRecords = await purgeUndoRecords(database, undoableSince());
  const purgedSessions = await purgeSessions(database);
  const purgedInvites = await purgeInvites(database, cutoff);
  const purgedNotifications = await purgeNotifications(database, cutoff);
  return {
    tasks: purgedTasks.length,
    lists: purgedLists.length,
    undoRecords,
    sessions: purgedSessions.length,
    invites: purgedInvites.length,
    notifications: purgedNotifications.length,
  };
};
