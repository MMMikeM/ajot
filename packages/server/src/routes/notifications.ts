import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { now, today } from "@newtab-todo/shared/iso";
import notificationQueueRepo from "../db/notification-queue.repo";
import taskRepo from "../db/task.repo";
import { sendNotification } from "../notify";
import { isSecret } from "../secret";

const DIGEST_TASKS = 10;
const DIGEST_TITLE_LENGTH = 100;

/** Sends each, and returns those whose send threw, for their claims to be released. */
const sendEach = <T>(claims: T[], send: (claim: T) => void) => {
  const unsent: T[] = [];
  for (const claim of claims) {
    try {
      send(claim);
    } catch (error) {
      console.error("[cron] Send failed, to retry next run:", error);
      unsent.push(claim);
    }
  }
  return unsent;
};

const app = new Hono();

app.post("/process", async (c) => {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new HTTPException(500, { message: "CRON_SECRET not configured" });

  if (!isSecret(c.req.header("authorization"), `Bearer ${secret}`)) {
    throw new HTTPException(401, { message: "Invalid cron secret" });
  }

  const ts = now();
  const todayStr = today();

  const reminders = await notificationQueueRepo.claimDueReminders(ts);
  const unsentReminders = sendEach(reminders, ({ userId, task }) =>
    sendNotification(userId, {
      type: "reminder-due",
      taskId: task.id,
      taskTitle: task.title,
      dueDate: task.dueDate ?? "",
    }),
  );
  await notificationQueueRepo.releaseReminders(
    unsentReminders.map((reminder) => reminder.id),
    ts,
  );

  const overdueTasks = await taskRepo.findOverdue(todayStr);

  const byUser = new Map<string, Array<{ id: string; title: string; dueDate: string }>>();
  for (const task of overdueTasks) {
    if (!task.dueDate) continue;
    const list = byUser.get(task.userId) ?? [];
    list.push({ id: task.id, title: task.title, dueDate: task.dueDate });
    byUser.set(task.userId, list);
  }

  // At most one overdue digest per user per day: only those this run claims are sent one
  const digests = await notificationQueueRepo.claimDigests([...byUser.keys()], todayStr, ts);
  const unsentDigests = sendEach(digests, ({ userId }) => {
    const userTasks = byUser.get(userId)!;
    // Only the count shows, and a long list wouldn't fit in a push
    sendNotification(userId, {
      type: "overdue-digest",
      tasks: userTasks
        .slice(0, DIGEST_TASKS)
        .map((task) => ({ ...task, title: task.title.slice(0, DIGEST_TITLE_LENGTH) })),
      total: userTasks.length,
    });
  });
  await notificationQueueRepo.releaseDigests(unsentDigests.map((digest) => digest.id));

  const remindersSent = reminders.length - unsentReminders.length;
  const digestsSent = digests.length - unsentDigests.length;
  console.log(`[cron] Sent ${remindersSent} reminders, ${digestsSent} overdue digests`);
  return c.json({ ok: true, reminders: remindersSent, digests: digestsSent }, 200);
});

export const notificationRoutes = app;
