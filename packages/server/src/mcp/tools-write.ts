import { z } from "@hono/zod-openapi";
import { createId } from "@paralleldrive/cuid2";
import type { McpServer } from "@modelcontextprotocol/server";
import { MAX_ID, MAX_STATUS_IDS, MAX_TEXT, MAX_TITLE } from "@newtab-todo/shared/field-limits";
import { now } from "@newtab-todo/shared/iso";
import { taskStatuses } from "../db/schema";
import { Refusal, refusalOf, type Api } from "./api";
import type { McpCaller } from "./caller";
import { INBOX, loadLists, oneLine, othersInList } from "./lists";
import { guarded } from "./tool";

const writes = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;

const STALE = 409;

export const registerWriteTools = (server: McpServer, caller: McpCaller, api: Api) => {
  const me = caller.userId;

  server.registerTool(
    "add_task",
    {
      description:
        "Adds a task at the end of a list, the Inbox by default. A due date is the user's own wall-clock day, with an optional time.",
      inputSchema: z.object({
        title: z.string().trim().min(1).max(MAX_TITLE),
        listId: z
          .string()
          .max(MAX_ID)
          .optional()
          .describe(`A list's id from list_lists, or "${INBOX}" (the default)`),
        description: z.string().max(MAX_TEXT).optional(),
        dueDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/)
          .optional()
          .describe("YYYY-MM-DD, or YYYY-MM-DDTHH:MM, in the user's own time"),
      }),
      annotations: writes,
    },
    guarded(
      caller,
      "add_task",
      async ({ title, listId = INBOX, description, dueDate }) => {
        const categoryId = listId === INBOX ? null : listId;
        const at = now();
        const res = await api.tasks.$post({
          json: {
            id: createId(),
            userId: me,
            title,
            description: description ?? null,
            dueDate: dueDate ?? null,
            categoryId,
            parentId: null,
            assigneeId: null,
            editedAt: null,
            completedAt: null,
            createdAt: at,
            updatedAt: at,
          },
        });
        if (!res.ok) throw await refusalOf(res);
        const task = await res.json();
        const lists = await loadLists(api);
        const name = lists.lists.find((l) => l.id === categoryId)?.name;
        const listName = categoryId === null ? "the Inbox" : name ? oneLine(name) : "the list";
        const others = othersInList(lists, categoryId, me);
        return [
          `Added "${task.title}" [${task.id}] to ${listName}.`,
          ...(others.length > 0 ? [`Visible to ${others.join(", ")}.`] : []),
        ].join("\n");
      },
      { write: true },
    ),
  );

  server.registerTool(
    "set_task_status",
    {
      description: `Marks up to ${MAX_STATUS_IDS} tasks done, in progress or to do. Anyone they're shared with is told once for the lot.`,
      inputSchema: z.object({
        taskIds: z.array(z.string().max(MAX_ID)).min(1).max(MAX_STATUS_IDS),
        status: z.enum(taskStatuses),
      }),
      annotations: writes,
    },
    guarded(
      caller,
      "set_task_status",
      async ({ taskIds, status }) => {
        const change = async (ids: string[]) => {
          const res = await api.tasks.status.$put({ json: { ids, status, updatedAt: now() } });
          if (!res.ok) throw await refusalOf(res);
          return res.json();
        };
        const first = await change(taskIds);
        // Changed elsewhere in the same instant: once more, now later than that change
        const stale = first.refused.filter((r) => r.status === STALE).map((r) => r.id);
        const again = stale.length > 0 ? await change(stale) : { updated: [], refused: [] };
        const updated = [...first.updated, ...again.updated];
        const refused = [...first.refused.filter((r) => r.status !== STALE), ...again.refused];
        if (updated.length === 0 && refused.length > 0)
          throw new Refusal(refused.map((r) => `[${r.id}] ${r.error}`).join("\n"));
        const label = { todo: "to do", in_progress: "in progress", done: "done" }[status];
        return [
          `Marked ${updated.length} ${label}.`,
          ...refused.map((r) => `Not changed: [${r.id}] ${r.error}`),
        ].join("\n");
      },
      { write: true },
    ),
  );
};
