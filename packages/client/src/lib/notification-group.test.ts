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

test("'Your lists were updated' shows alone, never beside the rest", () => {
  expect(after(changes).body).toBe("Your lists were updated");
  expect(after(changes, completed("A"))).toMatchObject({ title: "Chrys", body: 'Completed "A"' });
  expect(after(completed("A"), changes)).toMatchObject({ title: "Chrys", body: 'Completed "A"' });
});
