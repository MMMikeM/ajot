import { inArray } from "drizzle-orm";
import { db, type Transaction } from "./client";
import { listMembers, taskAccess } from "./schema";

type Reader = typeof db | Transaction;

/**
 * A hidden task reaches no one, though `task_access` keeps its rows for the restore, and a
 * deleted list has no members.
 */
export type Reach = {
  /** Every task asked about, so the read after a write asks about the same ones */
  taskIds: string[];
  listIds: string[];
  /** By task or subtask id, for the live ones only */
  tasks: Map<string, Set<string>>;
  lists: Map<string, Set<string>>;
};

const grouped = (rows: { key: string; userId: string }[]) => {
  const byKey = new Map<string, Set<string>>();
  for (const { key, userId } of rows) byKey.set(key, (byKey.get(key) ?? new Set()).add(userId));
  return byKey;
};

const tasksAndSubtasks = (ids: string[]) =>
  ids.length === 0 ? [] : [{ id: { in: ids } }, { parentId: { in: ids } }];

const inLists = (ids: string[]) =>
  ids.length === 0
    ? []
    : [
        { categoryId: { in: ids } },
        { parent: { categoryId: { in: ids } } },
        { shares: { categoryId: { in: ids } } },
        { parent: { shares: { categoryId: { in: ids } } } },
      ];

const liveTaskIds = async (q: Reader, matching: object[]) => {
  if (matching.length === 0) return [];
  const rows = await q.query.tasks.findMany({
    where: { deletedAt: { isNull: true }, OR: matching },
    columns: { id: true },
  });
  return rows.map((r) => r.id);
};

const accessTo = async (q: Reader, taskIds: string[]) =>
  grouped(
    taskIds.length === 0
      ? []
      : await q
          .select({ key: taskAccess.taskId, userId: taskAccess.userId })
          .from(taskAccess)
          .where(inArray(taskAccess.taskId, taskIds)),
  );

const membersOf = async (q: Reader, listIds: string[]) =>
  grouped(
    listIds.length === 0
      ? []
      : await q
          .select({ key: listMembers.listId, userId: listMembers.userId })
          .from(listMembers)
          .where(inArray(listMembers.listId, listIds)),
  );

/** Before a write that changes who reaches what, inside its transaction when it has one. */
export const read = async (
  { taskIds = [], listIds = [] }: { taskIds?: string[]; listIds?: string[] },
  q: Reader = db,
): Promise<Reach> => {
  const rowIds = await liveTaskIds(q, [...tasksAndSubtasks(taskIds), ...inLists(listIds)]);
  return {
    taskIds: [...new Set([...taskIds, ...rowIds])],
    listIds,
    tasks: await accessTo(q, rowIds),
    lists: await membersOf(q, listIds),
  };
};

/** The same tasks and lists after the write, including any it moved out of those lists. */
export const readAgain = async ({ taskIds, listIds }: Reach): Promise<Reach> => {
  const rowIds = await liveTaskIds(db, tasksAndSubtasks(taskIds));
  const [tasks, lists] = await Promise.all([accessTo(db, rowIds), membersOf(db, listIds)]);
  return { taskIds, listIds, tasks, lists };
};
