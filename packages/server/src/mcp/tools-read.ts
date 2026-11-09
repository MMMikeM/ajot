import { z } from "@hono/zod-openapi";
import type { McpServer } from "@modelcontextprotocol/server";
import { MAX_ID } from "@newtab-todo/shared/field-limits";
import { Refusal, type Api } from "./api";
import type { McpCaller } from "./caller";
import {
  INBOX,
  bySortOrder,
  listIdOf,
  loadLists,
  notesOn,
  oneLine,
  othersWhoWrite,
  peopleOf,
  quoted,
  sidebarOrder,
  taskLine,
  type Lists,
  type Task,
} from "./lists";
import { guarded } from "./tool";

const RECENT_DONE = 20;
const reads = { readOnlyHint: true, openWorldHint: false } as const;
const listId = z
  .string()
  .max(MAX_ID)
  .describe(`A list's id from list_lists, or "${INBOX}" for the Inbox`);

const context = (lists: Lists, me: string) => ({ me, lists: lists.lists, people: peopleOf(lists) });

const lineOf = (lists: Lists, me: string) => (task: Task, parent?: Task) =>
  taskLine(task, { ...context(lists, me), notes: notesOn(lists, task.id).length }, parent);

const recentlyDone = (tasks: Task[]) =>
  tasks
    .filter((t) => t.status === "done")
    .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""))
    .slice(0, RECENT_DONE);

const subtasksOf = (lists: Lists, parentId: string) =>
  lists.tasks.filter((t) => t.parentId === parentId).sort(bySortOrder);

const topLevelIn = (lists: Lists, me: string, id: string | null) =>
  lists.tasks.filter((t) => !t.parentId && listIdOf(t, me, lists.lists) === id);

export const registerReadTools = (server: McpServer, caller: McpCaller, api: Api) => {
  const me = caller.userId;

  server.registerTool(
    "list_lists",
    {
      description:
        "The Inbox and every list you can see, in the app's order, with how many open tasks each has. Lists someone else owns name their owner.",
      inputSchema: z.object({}),
      annotations: reads,
    },
    guarded(caller, "list_lists", async () => {
      const lists = await loadLists(api);
      const people = peopleOf(lists);
      const open = (id: string | null) =>
        topLevelIn(lists, me, id).filter((t) => t.status !== "done").length;
      const lines = [`Inbox [${INBOX}] · ${open(null)} open`];
      for (const list of [...lists.lists].sort(sidebarOrder(me))) {
        const parts = [`${oneLine(list.name)} [${oneLine(list.id)}]`, `${open(list.id)} open`];
        if (list.userId !== me) parts.push(`${people.get(list.userId) ?? "someone"}'s list`);
        const others = (list.collaborators ?? []).filter((c) => c.userId !== me);
        if (others.length > 0)
          parts.push(`shared with ${others.map((c) => oneLine(c.user.name)).join(", ")}`);
        lines.push(parts.join(" · "));
      }
      return lines.join("\n");
    }),
  );

  server.registerTool(
    "get_list",
    {
      description:
        "The tasks in one list, in the app's order, each with its subtasks indented under it. [ ] is to do, [~] in progress, [x] done.",
      inputSchema: z.object({
        listId,
        includeDone: z.boolean().optional().describe(`Also the ${RECENT_DONE} most recently done`),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .describe("Open tasks to show, 100 by default"),
      }),
      annotations: reads,
    },
    guarded(caller, "get_list", async ({ listId: id, includeDone, limit = 100 }) => {
      const lists = await loadLists(api);
      const target = id === INBOX ? null : id;
      if (target && !lists.lists.some((l) => l.id === target))
        throw new Refusal(`There's no list [${id}] you can see. list_lists names them.`);
      const line = lineOf(lists, me);
      const inList = topLevelIn(lists, me, target);
      const open = inList.filter((t) => t.status !== "done").sort(bySortOrder);
      const shown = [...open.slice(0, limit), ...(includeDone ? recentlyDone(inList) : [])];
      if (shown.length === 0) return "Nothing here.";
      const lines = shown.flatMap((task) => [
        `- ${line(task)}`,
        ...subtasksOf(lists, task.id)
          .filter((s) => includeDone || s.status !== "done")
          .map((s) => `  - ${line(s, task)}`),
      ]);
      if (open.length > limit) lines.push(`…and ${open.length - limit} more open.`);
      return lines.join("\n");
    }),
  );

  server.registerTool(
    "search_tasks",
    {
      description:
        "Tasks in every list whose title, details or your notes contain the words, ignoring case.",
      inputSchema: z.object({
        query: z.string().min(2).max(200),
        includeDone: z.boolean().optional(),
        limit: z.number().int().min(1).max(50).optional().describe("20 by default"),
      }),
      annotations: reads,
    },
    guarded(caller, "search_tasks", async ({ query, includeDone, limit = 20 }) => {
      const lists = await loadLists(api);
      const needle = query.toLowerCase();
      const has = (text: string | null | undefined) => !!text?.toLowerCase().includes(needle);
      const byId = new Map(lists.tasks.map((t) => [t.id, t]));
      const listName = (task: Task) => {
        const id = listIdOf(task, me, lists.lists);
        const name = lists.lists.find((l) => l.id === id)?.name;
        return id === null ? "Inbox" : name ? oneLine(name) : "a list";
      };
      const line = lineOf(lists, me);
      const found = lists.tasks
        .filter((t) => includeDone || t.status !== "done")
        .filter(
          (t) =>
            has(t.title) ||
            has(t.description) ||
            notesOn(lists, t.id).some((n) => has(n.title) || has(n.content)),
        )
        .slice(0, limit);
      if (found.length === 0) return "No task matches.";
      return found
        .map((task) => {
          const parent = task.parentId ? byId.get(task.parentId) : undefined;
          const where = parent ? `under "${oneLine(parent.title)}"` : `in ${listName(task)}`;
          return `- ${line(task, parent)} · ${where}`;
        })
        .join("\n");
    }),
  );

  server.registerTool(
    "get_task",
    {
      description:
        "One task in full: details, dates, who it's shared with, subtasks and your notes.",
      inputSchema: z.object({ taskId: z.string().max(MAX_ID) }),
      annotations: reads,
    },
    guarded(caller, "get_task", async ({ taskId }) => {
      const lists = await loadLists(api);
      const task = lists.tasks.find((t) => t.id === taskId);
      if (!task)
        throw new Refusal(`There's no task [${taskId}] you can see. It may have been deleted.`);
      const parent = task.parentId ? lists.tasks.find((t) => t.id === task.parentId) : undefined;
      const line = lineOf(lists, me);
      const lines = [line(task, parent)];
      if (parent) lines.push(`Subtask of "${oneLine(parent.title)}" [${oneLine(parent.id)}]`);
      else {
        const id = listIdOf(task, me, lists.lists);
        const name = lists.lists.find((l) => l.id === id)?.name;
        lines.push(`In ${id === null ? "the Inbox" : name ? oneLine(name) : "a list"}`);
      }
      const shares = task.shares.map((s) => `${oneLine(s.sharedWithUser.name)} (${s.permission})`);
      if (shares.length > 0) lines.push(`Shared with ${shares.join(", ")}`);
      const done = task.completedAt ? `, done ${oneLine(task.completedAt)}` : "";
      lines.push(`Added ${task.createdAt}${done}`);
      if (task.description) {
        const writers = othersWhoWrite(task, context(lists, me), parent);
        const heading =
          writers.length > 0
            ? `Details, which ${writers.join(", ")} may have written:`
            : "Details:";
        lines.push("", heading, ...quoted(task.description));
      }
      const subtasks = subtasksOf(lists, task.id);
      if (subtasks.length > 0)
        lines.push("", "Subtasks:", ...subtasks.map((s) => `- ${line(s, task)}`));
      const notes = notesOn(lists, task.id);
      if (notes.length > 0)
        lines.push(
          "",
          "Your notes:",
          ...notes.map(
            (n) => `- ${n.createdAt}: ${[n.title, n.content].filter(Boolean).join(" — ")}`,
          ),
        );
      return lines.join("\n");
    }),
  );
};
