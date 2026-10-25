import { test, expect } from "./fixtures";
import { apiRequest } from "./helpers/api";
import { BASE_URL } from "./helpers/stack";

// Only the server is under test, so one browser project is enough
// eslint-disable-next-line no-empty-pattern
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "server-only checks");
});

const now = () => new Date().toISOString();

// Deleting reads the subtasks before it writes. Overlapping deletes once failed with
// SQLITE_BUSY ("database is locked") rather than waiting for each other.
test("deleting several tasks at once deletes them all", async ({ user1Auth }) => {
  const created = await Promise.all(
    Array.from({ length: 6 }, (_, i) =>
      apiRequest<{ id: string }>(
        "POST",
        "/api/tasks",
        {
          id: crypto.randomUUID(),
          userId: "",
          title: `Concurrent ${i}`,
          createdAt: now(),
          updatedAt: now(),
        },
        user1Auth.token,
      ),
    ),
  );

  const statuses = await Promise.all(
    created.map(
      async ({ id }) =>
        (
          await fetch(`${BASE_URL}/api/tasks`, {
            method: "DELETE",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${user1Auth.token}`,
            },
            body: JSON.stringify({ id }),
          })
        ).status,
    ),
  );

  expect(statuses).toEqual(created.map(() => 200));
});
