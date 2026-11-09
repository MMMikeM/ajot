import { expect, test } from "vite-plus/test";
import { inboxOf } from "./widget-inbox";

type Task = Parameters<typeof inboxOf>[0][number];
type List = Parameters<typeof inboxOf>[1][number];

const ME = "me";
const SARAH = "sarah";

const task = (id: string, fields: Partial<Task> = {}) =>
  ({
    id,
    userId: ME,
    categoryId: null,
    parentId: null,
    status: "todo",
    sortOrder: null,
    shares: [],
    ...fields,
  }) as Task;

const sharedWithMe = (categoryId: string | null) => [
  { sharedWithUserId: ME, permission: "edit", categoryId },
];

const list = (id: string, userId: string, collaborators: string[] = []) =>
  ({ id, userId, collaborators: collaborators.map((c) => ({ userId: c })) }) as unknown as List;

const ids = (tasks: Task[]) => tasks.map((t) => t.id);

test("the Inbox is what the app shows there: my own unfiled tasks, and shares filed nowhere", () => {
  const tasks = [
    task("mine"),
    task("in-my-list", { categoryId: "work" }),
    task("shared-unfiled", { userId: SARAH, shares: sharedWithMe(null) as Task["shares"] }),
    task("shared-filed", { userId: SARAH, shares: sharedWithMe("work") as Task["shares"] }),
    task("in-her-list-im-in", { userId: SARAH, categoryId: "hers" }),
  ];
  const lists = [list("work", ME), list("hers", SARAH, [ME])];

  expect(ids(inboxOf(tasks, lists, ME))).toEqual(["mine", "shared-unfiled"]);
});

test("a share stays in the Inbox when its list is one I'm not in", () => {
  const tasks = [
    task("from-her-list", {
      userId: SARAH,
      categoryId: "private",
      shares: sharedWithMe(null) as Task["shares"],
    }),
  ];

  expect(ids(inboxOf(tasks, [], ME))).toEqual(["from-her-list"]);
});

test("done tasks and subtasks are left out, and the rest keep the app's order", () => {
  const tasks = [
    task("b", { sortOrder: "a1" }),
    task("done", { status: "done", sortOrder: "a0" }),
    task("sub", { parentId: "b", sortOrder: "a0" }),
    task("a", { sortOrder: "a0" }),
  ];

  expect(ids(inboxOf(tasks, [], ME))).toEqual(["a", "b"]);
});
