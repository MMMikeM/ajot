import { and, eq, inArray, isNull, lte, sql, type SQL } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { db } from "./client";
import { notificationQueue, tasks, users } from "./schema";

/**
 * Sets the task's unsent reminder to the due date the task holds as this runs, so two edits at
 * once leave it on the date the task ends up with.
 */
const scheduleReminder = (taskId: string) => upsertReminder(taskId, sql``);

/** Unless the task has had one: a create retried after its reminder went out would send it again. */
const scheduleFirstReminder = (taskId: string) =>
  upsertReminder(
    taskId,
    sql`AND NOT EXISTS (SELECT 1 FROM ${notificationQueue}
      WHERE task_id = ${taskId} AND type = 'reminder-due')`,
  );

const upsertReminder = async (taskId: string, unless: SQL) => {
  await db.run(sql`INSERT INTO ${notificationQueue} (id, user_id, type, task_id, scheduled_for)
    SELECT ${createId()}, user_id, 'reminder-due', id, due_date FROM ${tasks}
    WHERE id = ${taskId} AND due_date IS NOT NULL ${unless}
    ON CONFLICT (task_id) WHERE type = 'reminder-due' AND sent_at IS NULL
    DO UPDATE SET scheduled_for = excluded.scheduled_for`);
};

const cancelReminder = async (taskId: string) => {
  await db
    .delete(notificationQueue)
    .where(
      and(
        eq(notificationQueue.taskId, taskId),
        eq(notificationQueue.type, "reminder-due"),
        isNull(notificationQueue.sentAt),
        sql`(SELECT ${tasks.dueDate} FROM ${tasks} WHERE ${tasks.id} = ${taskId}) IS NULL`,
      ),
    );
};

/** Runs at the same time each mark a reminder only once, so only one sends it. */
const claimDueReminders = async (at: string) => {
  const claimed = await db
    .update(notificationQueue)
    .set({ sentAt: at })
    .where(
      and(
        eq(notificationQueue.type, "reminder-due"),
        isNull(notificationQueue.sentAt),
        lte(notificationQueue.scheduledFor, at),
      ),
    )
    .returning({
      id: notificationQueue.id,
      userId: notificationQueue.userId,
      taskId: notificationQueue.taskId,
    });
  const taskIds = claimed.flatMap((row) => (row.taskId ? [row.taskId] : []));
  if (taskIds.length === 0) return [];
  const toDo = await db.query.tasks.findMany({
    where: { id: { in: taskIds }, status: { ne: "done" }, deletedAt: { isNull: true } },
    columns: { id: true, title: true, dueDate: true },
  });
  const byId = new Map(toDo.map((task) => [task.id, task]));
  return claimed.flatMap(({ id, userId, taskId }) => {
    const task = taskId ? byId.get(taskId) : undefined;
    return task ? [{ id, userId, task }] : [];
  });
};

/** One whose task has a new reminder since stays marked: the new one is its unsent reminder now. */
const releaseReminders = async (ids: string[], at: string) => {
  if (ids.length === 0) return;
  await db.run(sql`UPDATE OR IGNORE ${notificationQueue} SET sent_at = NULL
    WHERE ${inArray(notificationQueue.id, ids)} AND ${eq(notificationQueue.sentAt, at)}`);
};

// Two bound values a user, well under SQLite's limit on them in one statement
export const DIGEST_CLAIM_CHUNK = 200;

/**
 * Records a digest for `day` for each of these users who has none that day. Runs at the same time
 * record each user's only once. A user deleted since they were read is passed over.
 */
const claimDigests = async (userIds: string[], day: string, at: string) => {
  const claimed: { id: string; userId: string }[] = [];
  for (let start = 0; start < userIds.length; start += DIGEST_CLAIM_CHUNK) {
    const chunk = userIds.slice(start, start + DIGEST_CLAIM_CHUNK);
    const rows = sql.join(
      chunk.map((userId) => sql`(${createId()}, ${userId})`),
      sql`, `,
    );
    claimed.push(
      ...(await db.all<{ id: string; userId: string }>(sql`INSERT INTO ${notificationQueue}
          (id, user_id, type, scheduled_for, sent_at)
        SELECT column1, column2, 'overdue-digest', ${day}, ${at} FROM (VALUES ${rows})
        WHERE column2 IN (SELECT id FROM ${users})
        ON CONFLICT DO NOTHING
        RETURNING id, user_id AS "userId"`)),
    );
  }
  return claimed;
};

const releaseDigests = async (ids: string[]) => {
  if (ids.length === 0) return;
  await db.delete(notificationQueue).where(inArray(notificationQueue.id, ids));
};

export default {
  scheduleReminder,
  scheduleFirstReminder,
  cancelReminder,
  claimDueReminders,
  releaseReminders,
  claimDigests,
  releaseDigests,
};
