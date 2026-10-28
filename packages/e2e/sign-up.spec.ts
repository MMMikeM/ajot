import { test, expect, type Page } from "@playwright/test";
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

test("a server with accounts only takes signups through an invite", async ({ page }) => {
  await signedOutAt(page, "/auth");
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.getByText("New here? Ask someone on this server")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create an account" })).toHaveCount(0);
});

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

test("an invite that can't be looked up still signs up with it", async ({ page }) => {
  const lookup = page.waitForResponse("**/api/auth/invites/expired");
  await signedOutAt(page, "/invite/expired");
  await lookup;
  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
  await expect(page.getByText("Signing up accepts your invite.")).toBeVisible();
});
