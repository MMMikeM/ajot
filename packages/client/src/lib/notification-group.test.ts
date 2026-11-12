import { expect, test } from "vite-plus/test";
import type { ShownNotification } from "@newtab-todo/shared/push-payload";
import { toNotification } from "@newtab-todo/shared/push-payload";
import { addToGroup, withChangesShown, type Group } from "~/lib/notification-group";

const completed = (title: string, id = "t1"): ShownNotification => ({
  title: "Chrys",
  body: `Completed "${title}"`,
  url: `/task/${id}`,
  tag: `task:${id}`,
});
const changes: ShownNotification = {
  title: "Ajot",
  body: "Your lists were updated",
  url: "/",
  tag: "changes",
};

const after = (...shown: ShownNotification[]) =>
  shown.reduce<ReturnType<typeof addToGroup> | undefined>(
    (group, next) => addToGroup(group?.group as Group | undefined, next),
    undefined,
  )!;

test("'Your lists were updated' shows alone, never beside the rest", () => {
  expect(after(changes).body).toBe("Your lists were updated");
  expect(after(changes, completed("A"))).toMatchObject({ title: "Chrys", body: 'Completed "A"' });
  expect(after(completed("A"), changes)).toMatchObject({ title: "Chrys", body: 'Completed "A"' });
});

const listed = (changed: Parameters<typeof toNotification>[0] & { type: "changes" }) =>
  toNotification(changed)!;
const milk = { id: "t1", model: "tasks", action: "insert", name: "Milk" } as const;
const bread = { id: "t2", model: "tasks", action: "update", name: "Bread" } as const;

test("changes say what changed, and by whom when it wasn't you", () => {
  expect(listed({ type: "changes", changed: [milk], more: 0 })).toMatchObject({
    title: "Ajot",
    body: 'Added "Milk"',
  });
  expect(
    listed({
      type: "changes",
      changed: [
        { ...bread, by: "Sam" },
        { id: "t3", model: "tasks", action: "delete", by: "Sam" },
      ],
      more: 0,
    }),
  ).toMatchObject({ title: "Sam", body: 'Edited "Bread" · removed a task' });
  expect(listed({ type: "changes", changed: [milk, { ...bread, by: "Sam" }], more: 3 }).body).toBe(
    'You: Added "Milk"\nSam: Edited "Bread" · and 3 more',
  );
});

test("a change listed shows beside the rest, grouped", () => {
  const listing = listed({ type: "changes", changed: [milk], more: 0 });
  expect(after(completed("A"), listing).body).toBe('Added "Milk"\nChrys: Completed "A"');
});

test("changes list what the notification they replace did, grouped or not", () => {
  const first = listed({ type: "changes", changed: [milk], more: 0 });
  const next = listed({
    type: "changes",
    changed: [bread, { ...milk, action: "update" }],
    more: 0,
  });
  const merged = 'Added "Milk" · edited "Bread"';

  expect(withChangesShown(next, [{ url: "/", changes: first.changes }]).body).toBe(merged);
  expect(withChangesShown(next, [{ group: after(completed("A"), first).group }]).body).toBe(merged);
  expect(withChangesShown(next, [{ url: "/task/t9" }]).body).toBe(next.body);

  const theirs = listed({ type: "changes", changed: [{ ...bread, by: "Sam" }], more: 0 });
  const mine = listed({ type: "changes", changed: [bread], more: 0 });
  expect(withChangesShown(mine, [{ url: "/", changes: theirs.changes }])).toMatchObject({
    title: "Ajot",
    body: 'Edited "Bread"',
  });
});
