import { writeFileSync } from "node:fs";
import type { ElementHandle, Locator, Page } from "@playwright/test";

const CLICK_PAUSE_MS = 500;
const HIGHLIGHT = "#fde047";
const demoPages = new WeakSet<Page>();
let isClickPatched = false;

// Headless recordings have no pointer, so the page draws one: a dot that follows the mouse and a
// ripple on each press. Touch recordings get the same ripple from touchstart.
function drawPointer(highlight: string) {
  window.addEventListener("DOMContentLoaded", () => {
    const pointer = document.createElement("div");
    pointer.style.cssText = `position:fixed;left:-40px;top:-40px;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;background:${highlight};border:2px solid #111;box-shadow:0 0 0 2px ${highlight}66;z-index:2147483647;pointer-events:none;transition:left .15s,top .15s`;
    document.body.appendChild(pointer);
    const moveTo = (x: number, y: number) => {
      pointer.style.left = `${x}px`;
      pointer.style.top = `${y}px`;
    };
    const ripple = (x: number, y: number) => {
      const ring = document.createElement("div");
      ring.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:50%;border:3px solid ${highlight};z-index:2147483647;pointer-events:none;transition:transform .45s ease-out,opacity .45s ease-out`;
      document.body.appendChild(ring);
      requestAnimationFrame(() => {
        ring.style.transform = "scale(3.5)";
        ring.style.opacity = "0";
      });
      setTimeout(() => ring.remove(), 500);
    };
    window.addEventListener("mousemove", (e) => moveTo(e.clientX, e.clientY), true);
    window.addEventListener("mousedown", (e) => ripple(e.clientX, e.clientY), true);
    window.addEventListener(
      "touchstart",
      (e) => {
        const touch = e.touches[0];
        if (!touch) return;
        moveTo(touch.clientX, touch.clientY);
        ripple(touch.clientX, touch.clientY);
      },
      true,
    );
    window.addEventListener(
      "touchmove",
      (e) => {
        const touch = e.touches[0];
        if (touch) moveTo(touch.clientX, touch.clientY);
      },
      true,
    );
  });
}

async function outline(target: ElementHandle, isOn: boolean) {
  await target.evaluate(
    (element, { isOn, highlight }) => {
      (element as HTMLElement).style.outline = isOn ? `3px solid ${highlight}` : "";
      (element as HTMLElement).style.outlineOffset = isOn ? "2px" : "";
    },
    { isOn, highlight: HIGHLIGHT },
  );
}

// Every Locator.click on a demo page moves the pointer onto the target, outlines it and holds, so
// a viewer sees what is about to be clicked.
function patchLocatorClick(page: Page) {
  if (isClickPatched) return;
  isClickPatched = true;
  const prototype = Object.getPrototypeOf(page.locator("body"));
  const click = prototype.click;
  prototype.click = async function (this: Locator, ...args: unknown[]) {
    if (!demoPages.has(this.page())) return click.apply(this, args);
    await this.hover();
    // A handle, not the locator: once the click navigates away, a locator would wait out the
    // action timeout for an element that never comes back
    const target = await this.elementHandle();
    if (target) await outline(target, true);
    await this.page().waitForTimeout(CLICK_PAUSE_MS);
    const result = await click.apply(this, args);
    if (target) {
      await outline(target, false).catch(() => undefined);
      await target.dispose().catch(() => undefined);
    }
    return result;
  };
}

export async function enableDemoClicks(page: Page) {
  demoPages.add(page);
  await page.addInitScript(drawPointer, HIGHLIGHT);
  patchLocatorClick(page);
}

export async function showCaption(
  page: Page,
  text: string,
  { placement = "top" }: { placement?: "top" | "bottom" } = {},
) {
  await page.evaluate(
    ({ text, highlight, placement }) => {
      let caption = document.getElementById("demo-caption");
      if (!caption) {
        caption = document.createElement("div");
        caption.id = "demo-caption";
        caption.style.cssText = `position:fixed;${placement}:16px;left:50%;transform:translateX(-50%);z-index:2147483647;max-width:calc(100vw - 32px);padding:10px 18px;border-radius:10px;background:${highlight};color:#111;font:600 16px/1.3 system-ui,sans-serif;text-align:center;box-shadow:0 4px 18px rgba(0,0,0,.45);pointer-events:none`;
        document.body.appendChild(caption);
      }
      caption.textContent = text;
    },
    { text, highlight: HIGHLIGHT, placement },
  );
}

/** Which stretches of a recording are worth watching, in seconds since the page opened, for cut-demo to keep. */
export function createTimeline(outFile: string) {
  const startedAt = Date.now();
  const segments: [number, number][] = [];
  const elapsed = () => (Date.now() - startedAt) / 1000;
  let segmentStart: number | undefined;
  const hide = () => {
    if (segmentStart === undefined) return;
    segments.push([segmentStart, elapsed()]);
    segmentStart = undefined;
  };
  return {
    show: () => {
      segmentStart = elapsed();
    },
    hide,
    save: () => {
      hide();
      writeFileSync(outFile, JSON.stringify({ segments }, null, 2));
    },
  };
}
