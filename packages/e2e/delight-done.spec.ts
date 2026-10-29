import { test, expect, type Locator, type Page } from "./fixtures";
import { mockApi } from "./helpers/mock-api";

// Finishing a list: the cleared state, its settle-in, and how done checkboxes recede.

test.use({ serviceWorkers: "block" });

const LONG_AGO = "2026-09-20T09:00:00.000Z";

const inboxTask = (id: string, title: string, status: "todo" | "done") => ({
  id,
  userId: "u-mike",
  categoryId: null,
  assigneeId: null,
  parentId: null as string | null,
  title,
  description: null,
  status,
  dueDate: null,
  sortOrder: `a${id}`,
  createdAt: LONG_AGO,
  updatedAt: LONG_AGO,
  user: { id: "u-mike", name: "Mike Murray" },
  subtasks: [],
  shares: [],
  assignee: null,
});

const doneTasks = [
  inboxTask("d1", "Buy oat milk", "done"),
  inboxTask("d2", "Return library books", "done"),
];

const openInbox = async (page: Page, tasks: ReturnType<typeof inboxTask>[]) => {
  await mockApi(page);
  // Registered after mockApi, so it answers first
  await page.route("**/api/tasks", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(tasks) })
      : route.fallback(),
  );
  await page.goto("/", { waitUntil: "domcontentloaded" });
  // Done rows stay collapsed, so the Done toggle is what every fixture here renders
  await page.getByRole("button", { name: /done \(/i }).waitFor({ timeout: 15000 });
};

const checkboxOf = (page: Page, title: string) =>
  page.locator("[data-task-id]", { hasText: title }).getByRole("checkbox");

const clearedHeadline = (page: Page) => page.getByText("All done.", { exact: true });

const runningAnimations = (locator: Locator) =>
  locator.evaluate((el) => el.getAnimations().map((a) => (a as CSSAnimation).animationName));

test("a list with only done tasks shows the serif cleared headline, without settling in", async ({
  page,
}) => {
  await openInbox(page, doneTasks);
  const headline = clearedHeadline(page);

  await expect(headline).toBeVisible();
  await expect(headline).toHaveCSS("font-family", /DM Serif Display/);
  await expect(headline).toHaveCSS("font-size", "24px");
  expect(await runningAnimations(headline)).toEqual([]);
  await expect(page.getByRole("button", { name: /done \(2\)/i })).toBeVisible();
});

test("ticking the last open task clears the list and settles the headline in", async ({ page }) => {
  await openInbox(page, [inboxTask("o1", "Water the plants", "todo"), ...doneTasks]);
  await expect(clearedHeadline(page)).toHaveCount(0);

  await checkboxOf(page, "Water the plants").click();

  const headline = clearedHeadline(page);
  await expect(headline).toBeVisible();
  expect(await runningAnimations(headline)).toContain("cleared-settle");
  await expect(page.getByRole("button", { name: /done \(3\)/i })).toBeVisible();

  // Stays cleared once the mutation has round-tripped
  await page.waitForTimeout(1500);
  await expect(headline).toBeVisible();
  await expect(headline).toHaveCSS("opacity", "1");
});

test("with reduced motion the cleared state appears without animating", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openInbox(page, [inboxTask("o1", "Water the plants", "todo"), ...doneTasks]);

  await checkboxOf(page, "Water the plants").click();

  const headline = clearedHeadline(page);
  await expect(headline).toBeVisible();
  expect(await runningAnimations(headline)).toEqual([]);
  await expect(headline).toHaveCSS("opacity", "1");
});

test("done checkboxes recede next to a freshly ticked one", async ({ page }) => {
  await openInbox(page, [inboxTask("o1", "Water the plants", "todo"), ...doneTasks]);
  await page.getByRole("button", { name: /done \(2\)/i }).click();

  const doneBox = checkboxOf(page, "Buy oat milk");
  await expect(doneBox).toHaveAttribute("data-checked", "");
  const doneFill = await doneBox.evaluate((el) => getComputedStyle(el).backgroundColor);

  const activeBox = checkboxOf(page, "Water the plants");
  await activeBox.click();
  // Read inside the 450ms hold, before the row moves to Done
  await expect(activeBox).toHaveAttribute("data-checked", "");
  const tickedFill = await activeBox.evaluate((el) => getComputedStyle(el).backgroundColor);

  expect(doneFill).not.toEqual(tickedFill);
});

// Recorded as they start: the drop is over before a poll after the 450ms hold would see it
const recordAnimationStarts = (page: Page) =>
  page.evaluateHandle(() => {
    const names: string[] = [];
    document.addEventListener("animationstart", (e) => names.push(e.animationName));
    return names;
  });

const doneToggle = (page: Page, count: number) =>
  page.getByRole("button", { name: `Done (${count})`, exact: true });

const doneCount = (page: Page, count: number) =>
  doneToggle(page, count).getByText(String(count), { exact: true });

test("a ticked task drops into the Done count, which stays still on load", async ({ page }) => {
  await openInbox(page, [
    inboxTask("o1", "Water the plants", "todo"),
    inboxTask("o2", "Call the dentist", "todo"),
    ...doneTasks,
  ]);
  expect(await runningAnimations(doneCount(page, 2))).toEqual([]);
  const started = await recordAnimationStarts(page);

  await checkboxOf(page, "Water the plants").click();

  await expect(doneToggle(page, 3)).toBeVisible();
  expect(await started.jsonValue()).toContain("done-count-land");
});

test("with reduced motion the Done count changes without moving", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openInbox(page, [inboxTask("o1", "Water the plants", "todo"), ...doneTasks]);
  const started = await recordAnimationStarts(page);

  await checkboxOf(page, "Water the plants").click();

  await expect(doneToggle(page, 3)).toBeVisible();
  expect(await started.jsonValue()).not.toContain("done-count-land");
});

test("a task whose subtasks are all done reads as ready to tick, in the list and its sheet", async ({
  page,
}) => {
  const parent = inboxTask("p1", "Pack for the weekend", "todo");
  await openInbox(page, [
    parent,
    { ...inboxTask("s1", "Chargers", "done"), parentId: "p1" },
    { ...inboxTask("s2", "Raincoat", "todo"), parentId: "p1" },
    ...doneTasks,
  ]);
  const parentBox = page.getByRole("checkbox", { name: "Pack for the weekend", exact: true });
  const restingEdge = await parentBox.evaluate((el) => getComputedStyle(el).borderColor);

  await page.getByRole("checkbox", { name: "Raincoat", exact: true }).click();

  await expect(page.getByRole("button", { name: /2 done/ })).toBeVisible();
  await expect(parentBox).not.toHaveCSS("border-color", restingEdge);
  await expect(parentBox).not.toHaveAttribute("data-checked", "");
  const readyEdge = await parentBox.evaluate((el) => getComputedStyle(el).borderColor);

  await page.getByRole("button", { name: "Pack for the weekend", exact: true }).click();

  const sheetBox = page.getByRole("checkbox", { name: "Mark done" });
  await expect(sheetBox).toHaveCSS("border-color", readyEdge);
  await expect(sheetBox).not.toHaveAttribute("data-checked", "");
});
