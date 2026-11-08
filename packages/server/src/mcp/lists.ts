import { compareSortOrder } from "@newtab-todo/shared/sort-order";
import { grants, placement } from "@newtab-todo/shared/task-access";
import { refusalOf, type Api } from "./api";

/** Everything the caller's devices sync, read as the app reads it. */
export const loadLists = async (api: Api) => {
  const [tasksRes, listsRes, contactsRes, notesRes] = await Promise.all([
    api.tasks.$get(),
    api.categories.$get(),
    api.contacts.$get(),
    api.notes.$get(),
  ]);
  if (!tasksRes.ok) throw await refusalOf(tasksRes);
  if (!listsRes.ok) throw await refusalOf(listsRes);
  if (!contactsRes.ok) throw await refusalOf(contactsRes);
  if (!notesRes.ok) throw await refusalOf(notesRes);
  const [tasks, lists, contacts, notes] = await Promise.all([
    tasksRes.json(),
    listsRes.json(),
    contactsRes.json(),
    notesRes.json(),
  ]);
  return { tasks, lists, contacts, notes };
};

export type Lists = Awaited<ReturnType<typeof loadLists>>;
export type Task = Lists["tasks"][number];
export type List = Lists["lists"][number];

export const INBOX = "inbox";

/** The name of everyone whose things the caller can see: their contacts and each list's members. */
export const peopleOf = ({ lists, contacts, tasks }: Lists) => {
  const names = new Map<string, string>();
  for (const list of lists)
    for (const c of list.collaborators ?? []) names.set(c.userId, c.user.name);
  for (const t of tasks) {
    for (const s of t.shares) names.set(s.sharedWithUserId, s.sharedWithUser.name);
    if (t.assignee) names.set(t.assignee.id, t.assignee.name);
    if (t.sentBy) names.set(t.sentBy.id, t.sentBy.name);
  }
  for (const c of contacts) names.set(c.contactUserId, c.contactUser.name);
  return names;
};

export type People = ReadonlyMap<string, string>;

const nameOf = (people: People, id: string) => people.get(id) ?? "someone";

const listById = (lists: List[], id: string | null) =>
  id ? lists.find((l) => l.id === id) : undefined;

const asHeld = (list: List | undefined) =>
  list ? { userId: list.userId, collaborators: list.collaborators ?? [] } : null;

/** The list a top-level task shows in for `me`: a list id, `null` for the Inbox, or nowhere. */
export const listIdOf = (task: Task, me: string, lists: List[]) =>
  placement({ ...task, category: asHeld(listById(lists, task.categoryId)) }, me).categoryId;

export const bySortOrder = (a: Task, b: Task) =>
  compareSortOrder(a.sortOrder, b.sortOrder) || a.createdAt.localeCompare(b.createdAt);

/** Own lists first, as the sidebar has them. */
export const sidebarOrder = (me: string) => (a: List, b: List) =>
  Number(a.userId !== me) - Number(b.userId !== me) || compareSortOrder(a.sortOrder, b.sortOrder);

/** Whoever besides `me` and its owner can change it: what they write reaches the caller too. */
const othersWhoEdit = (task: Task, me: string, lists: List[], parent?: Task) => {
  const holderOf = (t: Task) => ({
    userId: t.userId,
    shares: t.shares,
    category: asHeld(listById(lists, t.categoryId)),
  });
  const root = parent ?? task;
  return grants({ ...holderOf(task), parent: parent && holderOf(root) })
    .filter((g) => g.canEdit && g.userId !== me && g.userId !== root.userId)
    .map((g) => g.userId);
};

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

const STATUS_MARK = { todo: " ", in_progress: "~", done: "x" } as const;

/**
 * One task as a line. Text someone else could have written is marked as theirs, so it reads as
 * data: `from` its owner or sender, `shared with` everyone else who can edit it.
 */
export const taskLine = (
  task: Task,
  { me, lists, people, notes }: { me: string; lists: List[]; people: People; notes: number },
  parent?: Task,
) => {
  const parts = [`[${STATUS_MARK[task.status]}] ${oneLine(task.title)} [${task.id}]`];
  if (task.dueDate) parts.push(`due ${task.dueDate}`);
  if (task.assignee) parts.push(`assigned to ${task.assignee.name}`);
  if (notes > 0) parts.push(`${notes} note${notes === 1 ? "" : "s"} of yours`);
  const owner = (parent ?? task).userId;
  if (owner !== me) parts.push(`from ${nameOf(people, owner)}`);
  else if (task.sentBy) parts.push(`from ${task.sentBy.name}`);
  const editors = othersWhoEdit(task, me, lists, parent);
  if (editors.length > 0)
    parts.push(`shared with ${editors.map((id) => nameOf(people, id)).join(", ")}`);
  return parts.join(" · ");
};

export const notesOn = (lists: Lists, taskId: string) =>
  lists.notes.filter((n) => n.taskId === taskId);

/** Everyone besides `me` who can see a task in `listId`, for a write to say who it reaches. */
export const othersInList = (lists: Lists, listId: string | null, me: string) => {
  const list = listById(lists.lists, listId);
  if (!list) return [];
  const people = peopleOf(lists);
  return [list.userId, ...(list.collaborators ?? []).map((c) => c.userId)]
    .filter((id) => id !== me)
    .map((id) => nameOf(people, id));
};
