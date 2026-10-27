import { test, expect } from "./fixtures";
import { apiRequest } from "./helpers/api";

// eslint-disable-next-line no-empty-pattern
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "the sheet files a share the same way on touch");
});

const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();

type Task = { id: string; shares: { sharedWithUserId: string; categoryId: string | null }[] };

test("a task shared with you, filed offline, reaches the server once back online", async ({
  user1Auth,
  user2Auth,
  user2Page: page,
}) => {
  const title = `File me ${id().slice(0, 8)}`;
  const task = await apiRequest<{ id: string }>(
    "POST",
    "/api/tasks",
    { id: id(), userId: "", title, createdAt: now(), updatedAt: now() },
    user1Auth.token,
  );
  await apiRequest(
    "POST",
    "/api/tasks/share",
    { taskId: task.id, username: user2Auth.username, permission: "edit" },
    user1Auth.token,
  );
  const list = await apiRequest<{ id: string }>(
    "POST",
    "/api/categories",
    { id: id(), userId: "", name: "Bob's own", createdAt: now(), updatedAt: now() },
    user2Auth.token,
  );
  await page.reload({ waitUntil: "domcontentloaded" });

  await page.getByRole("button", { name: new RegExp(`^${title}`) }).click();
  const sheet = page.getByRole("dialog", { name: title });
  await page.context().setOffline(true);
  await sheet.getByRole("button", { name: "Add", exact: true }).click();
  await sheet
    .getByRole("group", { name: "Add to task" })
    .getByRole("button", { name: "List" })
    .click();
  await page.getByRole("option", { name: "Bob's own" }).click();
  await expect(sheet.getByRole("combobox", { name: "List" })).toHaveText("Bob's own");

  await page.context().setOffline(false);
  const filedUnder = async () =>
    (await apiRequest<Task[]>("GET", "/api/tasks", undefined, user2Auth.token))
      .find((t) => t.id === task.id)
      ?.shares.find((s) => s.sharedWithUserId === user2Auth.userId)?.categoryId;
  await expect.poll(filedUnder, { timeout: 15_000 }).toBe(list.id);
});
