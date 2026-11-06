import type { CurrentUser } from "~/lib/auth/signed-in";
import type { Category, Contact, Task } from "~/lib/types";

/**
 * The name of everyone whose things this device can show, by user id: you, your contacts, and
 * each list's owner and members. Whoever shares a task with you is a contact, since removing one
 * unshares the tasks between you.
 */
export type People = ReadonlyMap<string, string>;

export const peopleFrom = (
  me: CurrentUser | null,
  contacts: readonly Contact[],
  lists: Iterable<Category>,
): People => {
  const names = new Map<string, string>();
  for (const list of lists) {
    if (list.user?.name) names.set(list.userId, list.user.name);
    for (const c of list.collaborators ?? []) names.set(c.userId, c.user.name);
  }
  for (const c of contacts) names.set(c.contactUserId, c.contactUser.name);
  if (me?.name) names.set(me.id, me.name);
  return names;
};

export const samePeople = (a: People | undefined, b: People | undefined) =>
  a === b || (!!a && !!b && a.size === b.size && [...a].every(([id, name]) => b.get(id) === name));

// The task's own copy covers someone no longer in your people, such as whoever made a subtask
// in a list they've since left
export const ownerNameOf = (task: Task, people: People) =>
  people.get(task.userId) ?? task.user?.name;
