import type { Context } from "hono";
import * as reachRepo from "../db/reach.repo";
import * as taskRepo from "../db/task.repo";
import * as categoryRepo from "../db/category.repo";
import attachmentRepo from "../db/attachment.repo";
import { broadcastPerUser, type BroadcastEvent } from "../broadcast";

const compare = (before = new Set<string>(), after = new Set<string>()) => ({
  gained: [...after].filter((u) => !before.has(u)),
  lost: [...before].filter((u) => !after.has(u)),
  kept: [...after].filter((u) => before.has(u)),
});

/**
 * `before` is `reachRepo.read` from before the write; a list in it always changed, since its
 * members did.
 */
export const sendReachChanges = async (
  c: Context,
  before: reachRepo.Reach,
  changedTaskIds: string[] = [],
) => {
  try {
    broadcastPerUser(c, await addressedChanges(before, changedTaskIds));
  } catch (err) {
    // The write has succeeded, and failing its request would only have it sent again
    console.error("[reach] couldn't send who gained or lost what", err);
  }
};

const addressedChanges = async (before: reachRepo.Reach, changedTaskIds: string[]) => {
  const after = await reachRepo.readAgain(before);
  const changed = new Set(changedTaskIds);

  const lists = before.listIds.map((id) => ({
    id,
    ...compare(before.lists.get(id), after.lists.get(id)),
  }));
  const tasks = [...new Set([...before.tasks.keys(), ...after.tasks.keys()])].map((id) => ({
    id,
    ...compare(before.tasks.get(id), after.tasks.get(id)),
  }));

  const [listRows, taskRows, attachmentRows] = await Promise.all([
    categoryRepo.listByIds(
      lists.filter((l) => l.gained.length + l.kept.length > 0).map((l) => l.id),
    ),
    taskRepo.findListItems(
      tasks.filter((t) => t.gained.length > 0 || changed.has(t.id)).map((t) => t.id),
    ),
    attachmentRepo.uploadedOf(
      tasks.filter((t) => t.gained.length + t.lost.length > 0).map((t) => t.id),
    ),
  ]);
  const listById = new Map(listRows.map((row) => [row.id, row]));
  const taskById = new Map(taskRows.map((row) => [row.id, row]));

  const addressed: { userId: string; event: BroadcastEvent }[] = [];
  const send = (userIds: string[], event: BroadcastEvent) => {
    for (const userId of userIds) addressed.push({ userId, event });
  };
  for (const { id, gained, lost, kept } of lists) {
    const row = listById.get(id);
    if (row) send(gained, { model: "categories", action: "insert", data: row });
    if (row) send(kept, { model: "categories", action: "update", data: row });
    send(lost, { model: "categories", action: "delete", data: { id } });
  }
  // Parents first, so a page has the task before its subtasks
  const isSubtask = (id: string) => Number(!!taskById.get(id)?.parentId);
  tasks.sort((a, b) => isSubtask(a.id) - isSubtask(b.id));
  for (const { id, gained, lost, kept } of tasks) {
    const row = taskById.get(id);
    if (row) send(gained, { model: "tasks", action: "insert", data: row });
    if (row && changed.has(id)) send(kept, { model: "tasks", action: "update", data: row });
    send(lost, { model: "tasks", action: "delete", data: { id } });
  }
  const taskReach = new Map(tasks.map((t) => [t.id, t]));
  for (const row of attachmentRows) {
    const { gained = [], lost = [] } = taskReach.get(row.taskId) ?? {};
    send(gained, { model: "attachments", action: "insert", data: row });
    send(lost, { model: "attachments", action: "delete", data: { id: row.id } });
  }
  return addressed;
};
