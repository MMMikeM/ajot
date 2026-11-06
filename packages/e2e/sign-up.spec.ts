import { test, expect, type Page } from "./fixtures";
import { mockApi } from "./helpers/mock-api";

const signedOutAt = async (page: Page, path: string, awaitingFirstUser = false) => {
  await mockApi(page, { signedIn: false });
  await page.route("**/api/config", (route) =>
    route.fulfill({ json: { vapidPublicKey: "", awaitingFirstUser } }),
  );
  const config = page.waitForResponse("**/api/config");
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await config;
};

test("a new server opens on its first account", async ({ page }) => {
  await signedOutAt(page, "/auth", true);
  await expect(
    page.getByRole("heading", { name: "Create the server's first account" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "I already have an account" }).click();
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
});

test("an invite link opens on signing up with its invite", async ({ page }) => {
  await signedOutAt(page, "/invite/abc");
  await expect(page).toHaveURL(/\/auth$/);
  await expect(
    page.getByRole("heading", { name: "Sarah Murray invited you to Ajot" }),
  ).toBeVisible();
  await page.getByLabel("Name", { exact: true }).fill("Sam Okafor");
  await page.getByLabel("Username").fill("sam");
  await page.getByLabel("Password").fill("correct horse");

  const signup = page.waitForRequest((r) => r.url().endsWith("/api/auth/signup"));
  await page.getByRole("button", { name: "Create account" }).click();
  expect((await signup).postDataJSON()).toMatchObject({ username: "sam", invite: "abc" });
});

test("signing in asks for notifications within the tap, and an answer after it still subscribes", async ({
  page,
}) => {
  // Stands in for the browser's prompt, noting whether each ask came within a tap, and answering
  // only when the test says
  await page.addInitScript(() => {
    let permission: NotificationPermission = "default";
    let answer: (next: NotificationPermission) => void = () => {};
    const asks: boolean[] = [];
    Object.defineProperty(Notification, "permission", { get: () => permission });
    Notification.requestPermission = () => {
      asks.push(navigator.userActivation.isActive);
      if (permission !== "default") return Promise.resolve(permission);
      return new Promise((resolve) => {
        answer = (next) => {
          permission = next;
          resolve(next);
        };
      });
    };
    Object.assign(window, {
      notificationAsks: asks,
      answerNotifications: (next: NotificationPermission) => answer(next),
    });
  });
  const registering: string[] = [];
  page.on("console", (message) => {
    if (message.text().startsWith("[push]")) registering.push(message.text());
  });
  await signedOutAt(page, "/auth");
  await page.route("**/api/auth/login", (route) =>
    route.fulfill({ json: { userId: "u-me", token: "t", name: "Mike Murray", username: "mike" } }),
  );
  const asks = () => page.evaluate(() => (window as unknown as { notificationAsks: boolean[] }).notificationAsks);

  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("Enter your username")).toBeVisible();
  expect(await asks()).toEqual([]);

  await page.getByLabel("Username").fill("mike");
  await page.getByLabel("Password").fill("correct horse");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).not.toHaveURL(/\/auth$/);
  expect(await asks()).toEqual([true]);
  expect(registering).toEqual([]);

  await page.evaluate(() =>
    (window as unknown as { answerNotifications: (p: string) => void }).answerNotifications("granted"),
  );
  // The mocked server has no VAPID key, the first thing a subscription needs after the permission
  await expect.poll(() => registering).toContain("[push] the server has no VAPID_PUBLIC_KEY");
});
