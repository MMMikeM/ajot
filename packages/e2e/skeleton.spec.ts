import { type Browser } from "@playwright/test";
import { test, expect, type Locator } from "./fixtures";
import { mockApi } from "./helpers/mock-api";

// The skeleton only exists in the prerendered index.html, so this runs against a production
// build: `pnpm test:e2e:prerender` (playwright.prerender.config.ts)
test.use({
  serviceWorkers: "block",
  // Rows slide in as they mount; measure where they settle
  reducedMotion: "reduce",
});

const box = async (locator: Locator) => {
  const b = await locator.boundingBox();
  if (!b) throw new Error(`${locator.toString()} has no box`);
  return { ...b, bottom: b.y + b.height, centerY: b.y + b.height / 2 };
};

const openPrerendered = async (browser: Browser, baseURL: string | undefined) => {
  const context = await browser.newContext({
    ...test.info().project.use,
    baseURL,
    javaScriptEnabled: false,
  });
  const prerendered = await context.newPage();
  await prerendered.goto("/");
  return prerendered;
};

test("the prerendered skeleton lines up with the loaded list", async ({
  browser,
  baseURL,
  page,
}) => {
  const skeleton = await openPrerendered(browser, baseURL);
  await mockApi(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-task-id]", { timeout: 15000 });

  const pairs = {
    header: [skeleton.locator("header"), page.locator("header")],
    dot: [skeleton.getByTestId("skeleton-dot"), page.locator("h2 span.rounded-full")],
    title: [skeleton.getByTestId("skeleton-title"), page.locator("h2 .font-display")],
    input: [skeleton.getByTestId("skeleton-input"), page.locator("#add-task-input")],
    firstCheckbox: [
      skeleton.getByTestId("skeleton-rows").locator('[data-slot="skeleton"]').first(),
      page.locator("[data-task-id]").first().getByRole("checkbox").first(),
    ],
    oneLineRow: [
      skeleton.getByTestId("skeleton-rows").locator("li").first(),
      page.locator("[data-task-id]", { hasText: "Pick up dry cleaning" }).locator(".group\\/task"),
    ],
  } as const;

  const boxes = Object.fromEntries(
    await Promise.all(
      Object.entries(pairs).map(async ([name, [s, l]]) => [name, [await box(s), await box(l)]]),
    ),
  );
  const near = (actual: number, expected: number, what: string) =>
    expect(
      Math.abs(actual - expected),
      `${what}: skeleton ${actual}, loaded ${expected}`,
    ).toBeLessThanOrEqual(1);

  const [header, loadedHeader] = boxes.header;
  near(header.height, loadedHeader.height, "header height");

  const [dot, loadedDot] = boxes.dot;
  near(dot.y, loadedDot.y, "title dot y");

  // The title bar is shorter than the text's line box, so compare centres
  const [title, loadedTitle] = boxes.title;
  near(title.centerY, loadedTitle.centerY, "title centre");
  near(title.x, loadedTitle.x, "title x");

  const [input, loadedInput] = boxes.input;
  near(input.y, loadedInput.y, "input top");
  near(input.bottom, loadedInput.bottom, "input underline");

  const [checkbox, loadedCheckbox] = boxes.firstCheckbox;
  near(checkbox.x, loadedCheckbox.x, "first checkbox x");
  near(checkbox.y, loadedCheckbox.y, "first checkbox y");

  const [row, loadedRow] = boxes.oneLineRow;
  near(row.height, loadedRow.height, "one-line row height");

  await skeleton.context().close();
});
