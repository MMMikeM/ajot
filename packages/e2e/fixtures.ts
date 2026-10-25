import { test as base, type Page } from "@playwright/test";
import { ensureMutualContacts } from "./helpers/api";
import { getOrCreateUser, signIn, type AuthResult } from "./helpers/auth";
import { waitForAppReady } from "./helpers/app";
import { createSyncTracker, type SyncTracker } from "./helpers/sync";
import { USER_1, USER_2, type TestUser } from "./helpers/users";

type Fixtures = {
  /** Navigated to "/" and ready — use for unauthenticated tests. */
  appPage: Page;
  /** Page signed in as USER_1 in the default browser context. */
  user1Page: Page;
  /**
   * Page signed in as USER_2 in an isolated browser context.
   * Use together with user1Page to test cross-user interactions — localStorage
   * is not shared between the two contexts.
   */
  user2Page: Page;
  /**
   * Tracks all non-GET /api/* requests made against `page`.
   * Calls assertNoFailures() automatically in teardown.
   */
  syncTracker: SyncTracker;
};

type WorkerFixtures = {
  /** This worker's Alice, invited by USER_1. */
  user1Auth: AuthResult;
  /** This worker's Bob, invited by and a contact of this worker's Alice. */
  user2Auth: AuthResult;
};

// One pair of accounts per worker: specs clear their account's tasks and lists before each test,
// which on a shared account deleted what tests in other workers had just made
const forWorker = (user: TestUser, workerIndex: number): TestUser => ({
  ...user,
  username: `${user.username}_${workerIndex}`,
});

export const test = base.extend<Fixtures, WorkerFixtures>({
  appPage: async ({ page }, use) => {
    await waitForAppReady(page);
    await use(page);
  },

  user1Auth: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use, workerInfo) => {
      const root = await getOrCreateUser(USER_1);
      await use(await getOrCreateUser(forWorker(USER_1, workerInfo.workerIndex), root));
    },
    { scope: "worker" },
  ],

  user2Auth: [
    async ({ user1Auth }, use, workerInfo) => {
      const user2 = await getOrCreateUser(forWorker(USER_2, workerInfo.workerIndex), user1Auth);
      await ensureMutualContacts(user1Auth.token, user2.token);
      await use(user2);
    },
    { scope: "worker" },
  ],

  user1Page: async ({ page, user1Auth }, use) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await signIn(page, user1Auth);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector("#add-task-input", { timeout: 10000 });
    await use(page);
  },

  user2Page: async ({ browser, user2Auth }, use) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await signIn(page, user2Auth);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector("#add-task-input", { timeout: 10000 });
    await use(page);
    await context.close();
  },

  syncTracker: async ({ page }, use) => {
    const tracker = createSyncTracker(page);
    await use(tracker);
    tracker.assertNoFailures();
  },
});

export { expect } from "@playwright/test";
