import { test, expect, type Page } from "./fixtures";
import { newId, tasksOf } from "./helpers/api";

const input = (page: Page) => page.locator("#add-task-input");

test("@ shares a task as it's added, offline too, with no request of its own to refuse", async ({
  user1Page: page,
  user1Auth,
  user2Auth,
}) => {
  const refused: string[] = [];
  page.on("response", (response) => {
    if (new URL(response.url()).pathname.startsWith("/api/") && response.status() >= 400)
      refused.push(`${response.status()} ${response.request().method()} ${response.url()}`);
  });
  const title = `Lunch ${newId().slice(0, 8)}`;

  await page.context().setOffline(true);
  await input(page).fill(`${title} @`);
  await input(page).pressSequentially("Bo");
  await expect(page.getByRole("option", { name: new RegExp(user2Auth.name) })).toBeVisible();
  await page.keyboard.press("Enter");

  await expect(
    page.getByRole("button", { name: `Don't share with ${user2Auth.name}` }),
  ).toBeVisible();
  await expect(input(page)).toHaveValue(`${title} `);
  await page.keyboard.press("Enter");
  await expect(input(page)).toHaveValue("");

  await page.context().setOffline(false);
  await expect
    .poll(async () => (await tasksOf(user2Auth.token)).map((t) => t.title), { timeout: 15_000 })
    .toContain(title);
  const added = (await tasksOf(user1Auth.token)).find((t) => t.title === title);
  expect(added?.shares.map((share) => share.sharedWithUserId)).toEqual([user2Auth.userId]);
  expect(refused).toEqual([]);
});

test("the @ picker", async ({ user1Page: page, user2Auth }) => {
  const option = page.getByRole("option", { name: new RegExp(user2Auth.name) });

  await input(page).fill("Write to bob@example.com");
  await expect(input(page)).toHaveAttribute("aria-expanded", "false");

  await input(page).fill("Call @Bo");
  await expect(option).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(option).toBeHidden();
  await expect(input(page)).toHaveValue("Call @Bo");

  await input(page).fill("@Bo");
  await option.click();
  const chip = page.getByRole("button", { name: `Don't share with ${user2Auth.name}` });
  await expect(chip).toBeVisible();
  await expect(input(page)).toBeFocused();
  await page.keyboard.press("Backspace");
  await expect(chip).toBeHidden();
});
