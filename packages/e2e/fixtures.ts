import { test as base, type Page } from "@playwright/test";
import { watchCsp } from "./helpers/csp";
import { ensureMutualContacts } from "./helpers/api";
import { getOrCreateUser, signIn, type AuthResult } from "./helpers/auth";
import { waitForAppReady } from "./helpers/app";
import { createSyncTracker, type SyncTracker } from "./helpers/sync";
import { USER_1, USER_2, type TestUser } from "./helpers/users";

type Fixtures = {
  /** Navigated to "/" and ready — use for unauthenticated tests. */
  appPage: Page;
  user1Page: Page;
  /** In an isolated browser context, so localStorage is not shared with user1Page. */
  user2Page: Page;
  syncTracker: SyncTracker;
};

type WorkerFixtures = {
  /** This worker's Alice, invited by USER_1. */
  user1Auth: AuthResult;
  /** This worker's Bob, invited by and a contact of this worker's Alice. */
  user2Auth: AuthResult;
};

// One pair of accounts per worker: specs clear their account's tasks and lists before each test,
// which on a shared account would delete what tests in other workers just made
const forWorker = (user: TestUser, workerIndex: number): TestUser => ({
  ...user,
  username: `${user.username}_${workerIndex}`,
});

export const test = base.extend<Fixtures, WorkerFixtures>({
  context: async ({ context }, use) => {
    const expectNoViolations = await watchCsp(context);
    await use(context);
    expectNoViolations();
  },

  appPage: async ({ page }, use) => {
    await waitForAppReady(page);
    await use(page);
  },

  user1Auth: [
    // eslint-disable-next-line no-empty-pattern -- Playwright reads fixture deps from it
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
    const expectNoViolations = await watchCsp(context);
    const page = await context.newPage();
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await signIn(page, user2Auth);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector("#add-task-input", { timeout: 10000 });
    await use(page);
    expectNoViolations();
    await context.close();
  },

  syncTracker: async ({ page }, use) => {
    const tracker = createSyncTracker(page);
    await use(tracker);
    tracker.assertNoFailures();
  },
});

export { expect, type Locator, type Page } from "@playwright/test";
