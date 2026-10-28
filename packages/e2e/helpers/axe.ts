import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

export const expectNoAxeViolations = async (page: Page) => {
  // Mid-fade text reads as low contrast; skip animations that never settle (infinite, scroll-driven)
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (a) =>
          a.playState !== "running" ||
          a.timeline !== document.timeline ||
          a.effect?.getTiming().iterations === Infinity,
      ),
  );
  // Base UI inerts everything behind an open sheet or popover; axe would audit it anyway
  const { violations } = await new AxeBuilder({ page }).exclude("[data-base-ui-inert] *").analyze();
  expect(
    violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
  ).toEqual([]);
};
