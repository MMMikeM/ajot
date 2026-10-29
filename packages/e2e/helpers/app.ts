import type { Locator, Page } from "@playwright/test";

export const waitForAppReady = async (page: Page): Promise<void> => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#add-task-input", { timeout: 10000 });
};

export const createTask = async (page: Page, text: string): Promise<void> => {
  await page.fill("#add-task-input", text);
  await page.keyboard.press("Enter");
};

/** `"sidebar"` is the desktop form; `"sheet"` is the touch one, which must already be open. */
export const createCategory = async (
  page: Page,
  name: string,
  context: "sidebar" | "sheet",
): Promise<void> => {
  if (context === "sidebar") {
    await page.getByTestId("category-sidebar").getByLabel("Add list").click();
    await page.locator('input[placeholder="Name..."]').fill(name);
  } else {
    await page.getByRole("button", { name: "Add list" }).tap();
    await page.locator('input[placeholder="List name..."]').fill(name);
  }
  await page.keyboard.press("Enter");
};

export const clearLocalStorage = async (page: Page): Promise<void> => {
  await page.evaluate(() => localStorage.clear());
};

/** Clears IndexedDB: the offline outbox and the saved lists. */
export const clearIDB = async (page: Page): Promise<void> => {
  await page.evaluate(async () => {
    const dbs = (await indexedDB.databases?.()) ?? [];
    await Promise.all(
      dbs.map(({ name }) =>
        name
          ? new Promise<void>((res, rej) => {
              const req = indexedDB.deleteDatabase(name);
              req.onsuccess = () => res();
              req.onerror = () => rej(req.error);
            })
          : Promise.resolve(),
      ),
    );
  });
};

/** A pattern for a name that begins with `text`, as a task row's button is named after its title */
export const startsWith = (text: string) =>
  new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);

/** The sheet offers what a task doesn't have yet on a quiet line where it would live */
export const tapAddLine = (
  sheet: Locator,
  line:
    | "Add a date"
    | "Share"
    | "Share with someone else"
    | "Assign"
    | "Add a subtask"
    | "Add a note",
) => sheet.getByRole("button", { name: line, exact: true }).click();

/** Opens the List picker in the sheet's header */
export const openListPicker = (sheet: Locator) =>
  sheet.getByRole("combobox", { name: "List" }).click();

export const taskRow = (page: Page, title: string) =>
  page.locator("[data-task-id]", { hasText: title }).first();
