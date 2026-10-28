import { test, expect, type Page, type Request, type Route } from "@playwright/test";
import { mockApi } from "./helpers/mock-api";

const openPeople = async (page: Page) => {
  await mockApi(page);
  await page.goto("/people", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("@sarah")).toBeVisible();
};

const remove = async (page: Page, name: string) => {
  const contactRow = page
    .locator("div")
    .filter({ hasText: name })
    .filter({ has: page.getByRole("button", { name: "Remove" }) });
  await contactRow.last().hover();
  await contactRow.last().getByRole("button", { name: "Remove" }).click();
};

test("Undo brings them back", async ({ page }) => {
  await openPeople(page);
  await remove(page, "Sarah Murray");

  const toast = page.locator("[data-toast-undo]", { hasText: "Removed Sarah Murray" });
  await expect(toast).toBeVisible();
  await expect(page.getByText("@sarah")).toHaveCount(0);

  const restore = page.waitForRequest(
    (r) => r.method() === "POST" && r.url().endsWith("/api/contacts/ct-u-sarah/restore"),
  );
  await toast.getByRole("button", { name: "Undo" }).click();
  await restore;
  await expect(page.getByText("@sarah")).toBeVisible();
});

test("a remove the server refuses says so and keeps them", async ({ page }) => {
  await openPeople(page);
  await page.route("**/api/contacts/*", (route) =>
    route.request().method() === "DELETE"
      ? route.fulfill({ status: 403, contentType: "application/json", body: '{"error":"no"}' })
      : route.fallback(),
  );
  await remove(page, "Sarah Murray");

  await expect(page.getByText("Couldn't remove Sarah Murray. Try again.")).toBeVisible();
  await expect(page.getByText("@sarah")).toBeVisible();
});

/** Each contact write that reached the server, and each that couldn't. */
const contactWrites = (page: Page) => {
  const writes = { sent: [] as string[], failed: [] as string[] };
  const isWrite = (r: Request) =>
    new URL(r.url()).pathname.startsWith("/api/contacts/") && r.method() !== "GET";
  const named = (r: Request) => `${r.method()} ${new URL(r.url()).pathname}`;
  page.on("requestfinished", (r) => isWrite(r) && writes.sent.push(named(r)));
  page.on("requestfailed", (r) => isWrite(r) && writes.failed.push(named(r)));
  return writes;
};

// page.route still answers while the context is offline, so the mocked API refuses too
const dropConnection = async (page: Page) => {
  const refuse = (route: Route) => route.abort("internetdisconnected");
  await page.context().setOffline(true);
  await page.route("**/api/**", refuse);
  return async () => {
    await page.unroute("**/api/**", refuse);
    await page.context().setOffline(false);
  };
};

const pressUndo = (page: Page) =>
  page
    .locator("[data-toast-undo]", { hasText: "Removed Sarah Murray" })
    .getByRole("button", { name: "Undo" })
    .click();

const removedThenRestored = [
  "DELETE /api/contacts/ct-u-sarah",
  "POST /api/contacts/ct-u-sarah/restore",
];

test("Undo pressed after the connection drops lands once it's back", async ({ page }) => {
  await openPeople(page);
  const writes = contactWrites(page);
  await remove(page, "Sarah Murray");
  await expect.poll(() => writes.sent).toEqual(["DELETE /api/contacts/ct-u-sarah"]);

  const reconnect = await dropConnection(page);
  await pressUndo(page);
  await expect.poll(() => writes.failed).toContain("POST /api/contacts/ct-u-sarah/restore");
  await expect(page.getByText("@sarah")).toBeVisible();
  await expect(page.getByText("Couldn't bring back Sarah Murray")).toHaveCount(0);

  await reconnect();
  await expect.poll(() => writes.sent, { timeout: 15_000 }).toEqual(removedThenRestored);
  await expect(page.getByText("@sarah")).toBeVisible();
  await expect(page.getByText("Couldn't bring back Sarah Murray")).toHaveCount(0);
});

test("removed and undone with no connection, both reach the server in order once back", async ({
  page,
}) => {
  await openPeople(page);
  const writes = contactWrites(page);
  const reconnect = await dropConnection(page);
  await remove(page, "Sarah Murray");
  await expect(page.getByText("@sarah")).toHaveCount(0);
  await expect.poll(() => writes.failed).toContain("DELETE /api/contacts/ct-u-sarah");
  await pressUndo(page);
  await expect(page.getByText("@sarah")).toBeVisible();

  await reconnect();
  await expect.poll(() => writes.sent, { timeout: 15_000 }).toEqual(removedThenRestored);
  await expect(page.getByText("@sarah")).toBeVisible();
  await expect(page.getByText(/Couldn't (remove|bring back)/)).toHaveCount(0);
});

test("a connection that drops as the remove lands doesn't hold up its Undo", async ({ page }) => {
  await openPeople(page);
  const writes = contactWrites(page);
  let reconnect = async () => {};
  await page.route("**/api/contacts/*", async (route) => {
    if (route.request().method() === "DELETE") {
      await route.fallback();
      reconnect = await dropConnection(page);
    } else await route.fallback();
  });
  await remove(page, "Sarah Murray");
  await expect.poll(() => writes.sent).toEqual(["DELETE /api/contacts/ct-u-sarah"]);
  await pressUndo(page);
  await expect(page.getByText("@sarah")).toBeVisible();

  await reconnect();
  await expect.poll(() => writes.sent, { timeout: 15_000 }).toEqual(removedThenRestored);
  await expect(page.getByText("@sarah")).toBeVisible();
});

test("one removed on another device while the list loads is gone once it has", async ({ page }) => {
  const rejected: string[] = [];
  page.on("console", (m) => m.text().startsWith("[sse] write rejected") && rejected.push(m.text()));
  await mockApi(page);
  let streams = 0;
  await page.route("**/api/events*", (route) => {
    const removal = { model: "contacts", action: "delete", data: { id: "ct-u-sarah" } };
    const events =
      ++streams === 1 ? `event: data-changed\ndata: ${JSON.stringify(removal)}\n\n` : "";
    return route.fulfill({
      headers: { "content-type": "text/event-stream" },
      body: `retry: 60000\n\n${events}`,
    });
  });
  await page.route("**/api/contacts", async (route) => {
    await new Promise((loaded) => setTimeout(loaded, 1000));
    await route.fallback();
  });
  await page.goto("/people", { waitUntil: "domcontentloaded" });

  await expect(page.getByText("@sam")).toBeVisible();
  await expect(page.getByText("@sarah")).toHaveCount(0);
  expect(rejected).toEqual([]);
});
