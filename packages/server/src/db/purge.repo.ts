import { sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { hoursFromNow } from "@newtab-todo/shared/iso";
import { db } from "./client";
import { categories, removedCollaborators, removedContacts, tasks, taskShares } from "./schema";
import { undoableSince } from "./undo-window";

/** What this needs of a drizzle SQLite database: Turso's, or node:sqlite's in the tests. */
type Database = { all<T>(query: SQL): T[] | PromiseLike<T[]> };

export const KEEP_DELETED_DAYS = 30;

const child = alias(tasks, "child");
const sharedTask = alias(tasks, "shared_task");

/**
 * A task deleted over KEEP_DELETED_DAYS ago, with its notes, shares and reminders, which the
 * foreign keys cascade to. Not while a subtask under it is live or deleted more recently: the
 * parent's delete would cascade to it, and a subtask's own restore can bring one back under a
 * deleted parent.
 */
const purgeTasks = (database: Database, cutoff: string) =>
  database.all<{ id: string }>(sql`DELETE FROM ${tasks}
    WHERE ${tasks.deletedAt} < ${cutoff}
      AND NOT EXISTS (SELECT 1 FROM ${tasks} ${child} WHERE ${child.parentId} = ${tasks.id}
        AND (${child.deletedAt} IS NULL OR ${child.deletedAt} >= ${cutoff}))
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

/** How many of each were purged. Tasks go first, so a list's go before the list is checked. */
export const purgeExpired = async (database: Database = db) => {
  const cutoff = hoursFromNow(-KEEP_DELETED_DAYS * 24);
  const purgedTasks = await purgeTasks(database, cutoff);
  const purgedLists = await purgeLists(database, cutoff);
  const undoRecords = await purgeUndoRecords(database, undoableSince());
  return { tasks: purgedTasks.length, lists: purgedLists.length, undoRecords };
};
