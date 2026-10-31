import { expect, test } from "vite-plus/test";
import type { ShownNotification } from "@newtab-todo/shared/push-payload";
import { addToGroup, type Group } from "~/lib/notification-group";

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

test("one notification reads as itself and opens its task", () => {
  expect(after(completed("Renew passport"))).toMatchObject({
    title: "Chrys",
    body: 'Completed "Renew passport"',
    url: "/task/t1",
  });
});

test("a newer one about the same task replaces its line", () => {
  const updated = { ...completed("Renew passport"), body: 'Updated "Renew passport"' };
  expect(after(updated, completed("Renew passport"))).toMatchObject({
    title: "Chrys",
    body: 'Completed "Renew passport"',
  });
});

test("several things: counted, newest first, opening the list", () => {
  expect(after(completed("A", "a"), completed("B", "b"))).toMatchObject({
    title: "2 updates",
    body: 'Chrys: Completed "B"\nChrys: Completed "A"',
    url: "/",
  });
});

test("past four lines, the rest are counted", () => {
  const group = after(...["a", "b", "c", "d", "e", "f"].map((id) => completed(id, id)));
  expect(group.title).toBe("6 updates");
  expect(group.body.split("\n")).toHaveLength(5);
  expect(group.body).toMatch(/and 2 more$/);
});

test("'Your lists were updated' shows alone, never beside the rest", () => {
  expect(after(changes).body).toBe("Your lists were updated");
  expect(after(changes, completed("A"))).toMatchObject({ title: "Chrys", body: 'Completed "A"' });
  expect(after(completed("A"), changes)).toMatchObject({ title: "Chrys", body: 'Completed "A"' });
});
