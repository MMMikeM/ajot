import { inArray, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { hoursFromNow, now } from "@newtab-todo/shared/iso";
import { db } from "./client";
import { fileKey, stagedKey, storage, thumbKey } from "../storage";
import {
  attachments,
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
// The upload queue recreates a row the purge took, so an abandoned upload needn't wait 30 days
export const KEEP_UNFINISHED_HOURS = 24;
// The digest check reads only today's; the rest is for seeing what went out when one is missed
export const KEEP_SENT_DAYS = 7;

type Bucket = Pick<NonNullable<typeof storage>, "remove" | "list">;

const child = alias(tasks, "child");
const subtask = alias(tasks, "subtask");
const sharedTask = alias(tasks, "shared_task");

/**
 * Not while a subtask under it was deleted more recently, which the cascade would take early. A
 * live one can't be under a deleted parent (live_subtask_has_live_parent).
 */
const expiredTaskIds = (cutoff: string) => sql`SELECT ${tasks.id} FROM ${tasks}
  WHERE ${tasks.deletedAt} < ${cutoff}
    AND NOT EXISTS (SELECT 1 FROM ${tasks} ${child} WHERE ${child.parentId} = ${tasks.id}
      AND ${child.deletedAt} >= ${cutoff})`;

/** Its notes, shares, reminders and attachment rows go with it, by the foreign keys' cascade. */
const purgeTasks = (database: Database, cutoff: string) =>
  database.all<{ id: string }>(sql`DELETE FROM ${tasks}
    WHERE ${tasks.id} IN (${expiredTaskIds(cutoff)}) RETURNING ${tasks.id}`);

const removeBytes = async (bucket: Bucket, ids: string[]) => {
  for (const id of ids)
    await Promise.all(
      [fileKey(id), thumbKey(id)].flatMap((key) => [key, stagedKey(key)]).map(bucket.remove),
    );
  return ids;
};

const idsOf = async (rows: { id: string }[] | PromiseLike<{ id: string }[]>) =>
  (await rows).map((row) => row.id);

/** Nothing cascades to the bucket, so the bytes of the tasks about to be purged go first. */
const purgeBytesOfExpiredTasks = async (database: Database, bucket: Bucket, cutoff: string) =>
  removeBytes(
    bucket,
    await idsOf(
      database.all<{ id: string }>(sql`SELECT ${attachments.id} FROM ${attachments}
        WHERE ${attachments.taskId} IN (${expiredTaskIds(cutoff)})
          OR ${attachments.taskId} IN (SELECT ${subtask.id} FROM ${tasks} ${subtask}
            WHERE ${subtask.parentId} IN (${expiredTaskIds(cutoff)}))`),
    ),
  );

/** The row stays as a tombstone, so a late retry of its insert is refused rather than redone. */
const purgeDeletedAttachments = async (database: Database, bucket: Bucket, cutoff: string) => {
  const ids = await removeBytes(
    bucket,
    await idsOf(
      database.all<{ id: string }>(sql`SELECT ${attachments.id} FROM ${attachments}
        WHERE ${attachments.deletedAt} < ${cutoff} AND ${attachments.uploadedAt} IS NOT NULL
          AND ${attachments.purgedAt} IS NULL`),
    ),
  );
  if (ids.length > 0)
    await database.all(sql`UPDATE ${attachments} SET purged_at = ${now()}
      WHERE ${inArray(attachments.id, ids)} RETURNING ${attachments.id}`);
  return ids;
};

/** None of its bytes was confirmed, so there's no tombstone to keep. */
const purgeUnfinishedAttachments = async (database: Database, bucket: Bucket) => {
  const ids = await removeBytes(
    bucket,
    await idsOf(
      database.all<{ id: string }>(sql`SELECT ${attachments.id} FROM ${attachments}
        WHERE ${attachments.uploadedAt} IS NULL
          AND ${attachments.createdAt} < ${hoursFromNow(-KEEP_UNFINISHED_HOURS)}`),
    ),
  );
  if (ids.length > 0)
    await database.all(sql`DELETE FROM ${attachments}
      WHERE ${inArray(attachments.id, ids)} AND ${attachments.uploadedAt} IS NULL
      RETURNING ${attachments.id}`);
  return ids;
};

/**
 * An upload's staged copy, or bytes whose row is gone or was never confirmed, as a step above
 * that failed or a /complete that stopped halfway leaves them.
 */
const purgeStrayObjects = async (database: Database, bucket: Bucket) => {
  const confirmed = new Set(
    await idsOf(
      database.all<{ id: string }>(sql`SELECT ${attachments.id} FROM ${attachments}
        WHERE ${attachments.uploadedAt} IS NOT NULL AND ${attachments.purgedAt} IS NULL`),
    ),
  );
  const before = hoursFromNow(-KEEP_UNFINISHED_HOURS);
  const strays: string[] = [];
  for await (const { key, lastModified } of bucket.list()) {
    const [kind, id = ""] = key.split("/");
    if (new Date(lastModified).toISOString() >= before) continue;
    if (kind === "u" || !confirmed.has(id)) strays.push(key);
  }
  for (const key of strays) await bucket.remove(key);
  return strays;
};

/** A step that fails is logged, and the rest of the purge runs. */
const attempt = async (step: string, run: () => Promise<unknown[]>) => {
  try {
    return (await run()).length;
  } catch (err) {
    console.error(`[purge] ${step} failed:`, err);
    return "failed" as const;
  }
};

/**
 * Not while a live task or share is still filed in it, which the foreign keys would move to the
 * Inbox unannounced.
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

const purgeUndoRecords = async (database: Database, since: string) => {
  const contacts = await database.all<{ id: string }>(sql`DELETE FROM ${removedContacts}
    WHERE ${removedContacts.removedAt} < ${since} RETURNING ${removedContacts.id}`);
  const collaborators = await database.all<{ id: string }>(sql`DELETE FROM ${removedCollaborators}
    WHERE ${removedCollaborators.removedAt} < ${since} RETURNING ${removedCollaborators.id}`);
  return { contacts: contacts.length, collaborators: collaborators.length };
};

const purgeSessions = (database: Database) =>
  database.all<{ id: string }>(sql`DELETE FROM ${sessions}
    WHERE ${sessions.expiresAt} < ${now()} RETURNING ${sessions.id}`);

/** Kept KEEP_DELETED_DAYS after use, so a signup that fails can release the invite it claimed. */
const purgeInvites = (database: Database, cutoff: string) =>
  database.all<{ id: string }>(sql`DELETE FROM ${inviteTokens}
    WHERE ${inviteTokens.usedAt} < ${cutoff} OR ${inviteTokens.expiresAt} < ${cutoff}
    RETURNING ${inviteTokens.id}`);

/**
 * An unsent one due over KEEP_DELETED_DAYS ago no run of the cron will send in time to matter.
 * Every one due is marked sent when it's processed, delivered or not.
 */
const purgeNotifications = (database: Database, cutoff: string) =>
  database.all<{ id: string }>(sql`DELETE FROM ${notificationQueue}
    WHERE ${notificationQueue.sentAt} < ${hoursFromNow(-KEEP_SENT_DAYS * 24)}
      OR (${notificationQueue.sentAt} IS NULL AND ${notificationQueue.scheduledFor} < ${cutoff})
    RETURNING ${notificationQueue.id}`);

/** Tasks go first, so a list's go before the list is checked. */
export const purgeExpired = async (
  database: Database = db,
  bucket: Bucket | undefined = storage,
) => {
  const cutoff = hoursFromNow(-KEEP_DELETED_DAYS * 24);
  const attachmentsOfPurgedTasks =
    bucket &&
    (await attempt("attachments of purged tasks", () =>
      purgeBytesOfExpiredTasks(database, bucket, cutoff),
    ));
  const purgedTasks = await purgeTasks(database, cutoff);
  const attachmentsPurged = bucket && {
    ofPurgedTasks: attachmentsOfPurgedTasks,
    deleted: await attempt("deleted attachments", () =>
      purgeDeletedAttachments(database, bucket, cutoff),
    ),
    unfinished: await attempt("unfinished attachments", () =>
      purgeUnfinishedAttachments(database, bucket),
    ),
    strays: await attempt("stray objects", () => purgeStrayObjects(database, bucket)),
  };
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
    attachments: attachmentsPurged,
  };
};
