import type { Locator } from "@playwright/test";
import { test, expect } from "./fixtures";
import { taskRow as row } from "./helpers/app";
import { mockData, openList } from "./helpers/mock-api";

test("a right-to-left title reads right to left wherever it shows", async ({ page }) => {
  const hebrew = "לקנות חלב ולחם לשבת";
  const data = mockData();
  data.tasks.find((t) => t.title === "Pick up dry cleaning")!.title = hebrew;
  data.categories.find((c) => c.id === "c-home")!.name = "בית";
  await openList(page, { data });

  const isRtl = (el: Element) => el.matches(":dir(rtl)");
  const title = row(page, hebrew).getByText(hebrew, { exact: true });
  expect(await title.evaluate(isRtl)).toBe(true);
  expect(await row(page, "Renew passport").getByText("Renew passport").evaluate(isRtl)).toBe(false);
  expect(await page.getByTestId("category-sidebar").getByText("בית").evaluate(isRtl)).toBe(true);

  await title.click();
  const sheet = page.locator('[data-slot="drawer-content"]');
  expect(await sheet.getByRole("textbox", { name: "Title" }).evaluate(isRtl)).toBe(true);
});

test("a ticked task holds in place before moving to Done", async ({ page }) => {
  await openList(page);
  const target = row(page, "Pick up dry cleaning");
  const checkbox = target.getByRole("checkbox");

  await checkbox.click();
  await expect(checkbox).toHaveAttribute("aria-checked", "true");
  await expect(target).toBeVisible();

  await expect(page.locator("[data-task-id]", { hasText: "Pick up dry cleaning" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /done \(3\)/i })).toBeVisible();
});

test("a task dragged across its own list's pill still drops onto another list", async ({
  page,
}) => {
  await openList(page);
  const sidebar = page.getByTestId("category-sidebar");
  const pill = (name: string) => sidebar.getByRole("button", { name: new RegExp(`^${name}`) });
  await pill("Work").click();
  const title = "Reply to Priya about the contract";
  await expect(row(page, title)).toBeVisible();

  const centre = async (target: Locator) => {
    const box = (await target.boundingBox())!;
    return [box.x + box.width / 2, box.y + box.height / 2] as const;
  };
  await page.mouse.move(
    ...(await centre(row(page, title).getByRole("button", { name: title }).first())),
  );
  await page.mouse.down();
  await page.mouse.move(...(await centre(pill("Work"))), { steps: 12 });
  await page.mouse.move(...(await centre(pill("Home"))), { steps: 12 });
  await page.mouse.up();

  await expect(row(page, title)).toHaveCount(0);
  await pill("Home").click();
  await expect(row(page, title)).toBeVisible();
});

test("ticking again during the hold cancels the move", async ({ page }) => {
  await openList(page);
  const target = row(page, "Renew passport");
  const checkbox = target.getByRole("checkbox");

  await checkbox.click();
  await checkbox.click();
  await page.waitForTimeout(700);

  await expect(checkbox).toHaveAttribute("aria-checked", "false");
  await expect(target).toBeVisible();
});

test("only a task added now slides in; the loaded list appears at once", async ({ page }) => {
  await openList(page);
  const entering = page.locator('[data-task-id] [class*="task-enter"]');
  await expect(entering).toHaveCount(0);

  await page.fill("#add-task-input", "Water the plants");
  await page.keyboard.press("Enter");
  await expect(row(page, "Water the plants").locator('[class*="task-enter"]')).toHaveCount(1);
  await expect(entering).toHaveCount(1);
});

test("a list dragged above another moves there, still one list to a row", async ({ page }) => {
  await openList(page);
  const rows = page.getByTestId("category-sidebar").locator(".group\\/pill");
  const firstLine = async () => (await rows.allInnerTexts()).map((text) => text.split("\n")[0]);
  const [first, second] = await firstLine();

  const centre = async (target: Locator) => {
    const box = (await target.boundingBox())!;
    return [box.x + box.width / 2, box.y + box.height / 2] as const;
  };
  await page.mouse.move(...(await centre(rows.nth(1).getByRole("button").first())));
  await page.mouse.down();
  await page.mouse.move(...(await centre(rows.nth(0).getByRole("button").first())), { steps: 12 });
  await page.mouse.up();

  await expect.poll(async () => (await firstLine()).slice(0, 2)).toEqual([second, first]);
  for (const listRow of await rows.all())
    await expect(listRow.locator(":scope > button:not([data-slot])")).toHaveCount(1);
});

test("a tick still holding when another list opens is saved", async ({ page }) => {
  await openList(page);
  const target = row(page, "Pick up dry cleaning");
  const taskId = await target.getAttribute("data-task-id");
  const saved = page.waitForRequest(
    (req) =>
      req.method() === "PUT" &&
      new URL(req.url()).pathname === "/api/tasks" &&
      req.postDataJSON()?.id === taskId &&
      req.postDataJSON()?.status === "done",
  );

  await target.getByRole("checkbox").click();
  await page.getByTestId("category-sidebar").getByRole("button", { name: /^Work/ }).click();

  await saved;
});

test("a task shared with you to view neither ticks nor moves among the others", async ({
  page,
}) => {
  const data = mockData();
  const restaurant = data.tasks.find((t) => t.title === "Pick a restaurant for Friday")!;
  restaurant.shares = restaurant.shares.map((s) => ({ ...(s as object), permission: "view" }));
  await openList(page, { data });
  const writes: string[] = [];
  page.on("request", (req) => {
    if (req.method() !== "GET" && new URL(req.url()).pathname.startsWith("/api/tasks"))
      writes.push(`${req.method()} ${new URL(req.url()).pathname}`);
  });
  const target = row(page, restaurant.title);
  const checkbox = target.getByRole("checkbox");

  await expect(checkbox).toHaveAttribute("aria-readonly", "true");
  await checkbox.click();
  await expect(checkbox).toHaveAttribute("aria-checked", "false");

  const centre = async (locator: Locator) => {
    const box = (await locator.boundingBox())!;
    return [box.x + box.width / 2, box.y + box.height / 2] as const;
  };
  const titles = () => page.locator("ul[data-flip-key='active'] > li").allInnerTexts();
  const before = await titles();
  await page.mouse.move(...(await centre(target.getByRole("button", { name: restaurant.title }))));
  await page.mouse.down();
  await page.mouse.move(...(await centre(row(page, "Pick up dry cleaning"))), { steps: 12 });
  await page.mouse.up();

  await expect(page.getByText("You can only view this task.")).toBeVisible();
  await expect.poll(titles).toEqual(before);
  expect(writes).toEqual([]);
});
