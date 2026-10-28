import { expect, type Locator } from "@playwright/test";

// boundingBox() leaves out ::after, where these targets grow. Walks out from the centre until a
// tap would land elsewhere, so a clip or a neighbour drawn on top counts too.
const tapTarget = (el: Element) => {
  const box = el.getBoundingClientRect();
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2;
  const reach = (dx: number, dy: number) => {
    let n = 0;
    while (n < 60) {
      const hit = document.elementFromPoint(cx + dx * (n + 1), cy + dy * (n + 1));
      if (!hit || !el.contains(hit)) break;
      n++;
    }
    return n;
  };
  return { width: reach(-1, 0) + reach(1, 0) + 1, height: reach(0, -1) + reach(0, 1) + 1 };
};

export const expectTapTarget = async (target: Locator) => {
  await target.scrollIntoViewIfNeeded();
  const { width, height } = await target.evaluate(tapTarget);
  expect(width).toBeGreaterThanOrEqual(44);
  expect(height).toBeGreaterThanOrEqual(44);
};
