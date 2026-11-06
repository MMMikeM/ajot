import type { CurrentUser } from "~/lib/auth/signed-in";
import type { Category, Contact, Task } from "~/lib/types";

/**
 * The name of everyone whose things this device can show, by user id: you, your contacts, and
 * each list's members. A list's owner is one of your contacts, as is whoever shares a task with
 * you, since removing a contact takes you out of each other's lists and unshares the tasks between
 * you.
 */
export type People = ReadonlyMap<string, string>;

export const peopleFrom = (
  me: CurrentUser | null,
  contacts: readonly Contact[],
  lists: Iterable<Category>,
): People => {
  const names = new Map<string, string>();
  for (const list of lists)
    for (const c of list.collaborators ?? []) names.set(c.userId, c.user.name);
  for (const c of contacts) names.set(c.contactUserId, c.contactUser.name);
  if (me?.name) names.set(me.id, me.name);
  return names;
};

export const samePeople = (a: People | undefined, b: People | undefined) =>
  a === b || (!!a && !!b && a.size === b.size && [...a].every(([id, name]) => b.get(id) === name));

/** Undefined for someone no longer among your people, such as whoever made a subtask in a list
 * they've since left. */
export const ownerNameOf = (task: Task, people: People) => people.get(task.userId);
