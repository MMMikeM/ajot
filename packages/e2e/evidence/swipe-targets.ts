// Before/after evidence for the swipe tray (title stays in view) and touch tap targets. Run once
// per version of the app:
//   npx tsx evidence/swipe-targets.ts --url http://localhost:5311 --out .evidence/swipe-targets/before
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium, devices, type Browser, type Page } from "@playwright/test";
import { mockApi } from "../helpers/mock-api";
import { createTimeline, enableDemoClicks, showCaption } from "../helpers/demo";
import { startEventStream } from "../helpers/event-stream";

const arg = (name: string) => {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) throw new Error(`missing --${name}`);
  return process.argv[index + 1];
};
const BASE_URL = arg("url");
const OUT = arg("out");
mkdirSync(OUT, { recursive: true });

// The iPhone 14 preset defaults to WebKit; Chromium is what's installed, and it gives a coarse pointer
const { defaultBrowserType: _, ...phone } = devices["iPhone 14"];
const { defaultBrowserType: __, ...smallPhone } = devices["iPhone SE"];
const desktop = { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } };

const stream = await startEventStream();

const shot = (page: Page, name: string) =>
  page.screenshot({
    path: `${OUT}/${name}.png`,
    ...(name.startsWith("desktop") && { clip: { x: 360, y: 0, width: 720, height: 900 } }),
  });

const row = (page: Page, title: string) =>
  page.locator("[data-task-id]", { hasText: title }).first();

const open = async (browser: Browser, device: typeof phone, video?: string) => {
  const context = await browser.newContext({
    ...device,
    colorScheme: "dark",
    serviceWorkers: "block",
    ...(video && { recordVideo: { dir: video, size: device.viewport } }),
  });
  const page = await context.newPage();
  await mockApi(page);
  await stream.holdOpen(page);
  return { context, page };
};

const load = async (page: Page) => {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-task-id]", { timeout: 15000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(900);
};

const fresh = async (
  browser: Browser,
  device: typeof phone,
  run: (page: Page) => Promise<void>,
) => {
  const { context, page } = await open(browser, device);
  await load(page);
  await run(page);
  await context.close();
};

const openTask = async (page: Page, title: string) => {
  await row(page, title).scrollIntoViewIfNeeded();
  await row(page, title)
    .getByRole("button", { name: new RegExp(`^${title}`) })
    .first()
    .click();
  await page.waitForTimeout(800);
};

// A real touch swipe through CDP, so the app's own swipe handling runs
const swipe = async (page: Page, title: string) => {
  await row(page, title).scrollIntoViewIfNeeded();
  const box = (await row(page, title).boundingBox())!;
  const y = box.y + 20;
  const client = await page.context().newCDPSession(page);
  const touch = (type: "touchStart" | "touchMove" | "touchEnd", x: number) =>
    client.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: type === "touchEnd" ? [] : [{ x, y }],
    });
  await touch("touchStart", box.x + box.width - 20);
  for (let i = 1; i <= 12; i++) {
    await touch("touchMove", box.x + box.width - 20 - i * 22);
    await page.waitForTimeout(16);
  }
  await touch("touchEnd", 0);
  await page.waitForTimeout(500);
};

// Walks out from each control's centre until a tap would land on something else, so the measured
// target includes its ::after and any clip by an ancestor's overflow. A string, since tsx would
// inject __name into named inner functions.
const MEASURE_TARGETS = `(() => {
  const scope = document.querySelector('[data-slot="drawer-content"]') ?? document;
  const hits = (el, x, y) => {
    const t = document.elementFromPoint(x, y);
    return !!t && (t === el || el.contains(t));
  };
  const reach = (el, cx, cy, dx, dy) => {
    let n = 0;
    while (n < 60 && hits(el, cx + dx * (n + 1), cy + dy * (n + 1))) n++;
    return n;
  };
  const kindOf = (el) =>
    el.matches('[data-slot="checkbox"]') ? "checkbox" : "date";
  const candidates = [
    ...scope.querySelectorAll('[data-slot="checkbox"]'),
    ...scope.querySelectorAll('[data-task-id] button:not([data-swipe-tray] button)'),
  ].filter((el) => {
    if (el.matches('[data-slot="checkbox"]')) return true;
    const after = getComputedStyle(el, "::after");
    return after.position === "absolute" && !/done/.test(el.textContent);
  });
  const out = [];
  for (const el of candidates) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.bottom < 0 || r.top > innerHeight - 90) continue;
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    if (!hits(el, cx, cy)) continue;
    const left = reach(el, cx, cy, -1, 0);
    const right = reach(el, cx, cy, 1, 0);
    const up = reach(el, cx, cy, 0, -1);
    const down = reach(el, cx, cy, 0, 1);
    out.push({
      kind: kindOf(el),
      label: el.getAttribute("aria-label") ?? el.textContent.trim(),
      visible: Math.round(r.width) + "x" + Math.round(r.height),
      target: { x: cx - left, y: cy - up, w: left + right + 1, h: up + down + 1 },
    });
  }
  for (const t of out) {
    const box = document.createElement("div");
    const ok = t.target.w >= 44 && t.target.h >= 44;
    box.style.cssText =
      "position:fixed;pointer-events:none;z-index:2147483647;box-sizing:border-box;" +
      "border:1px solid " + (ok ? "#4ade80" : "#f472b6") + ";" +
      "left:" + t.target.x + "px;top:" + t.target.y + "px;width:" + t.target.w + "px;height:" + t.target.h + "px";
    const tag = document.createElement("span");
    tag.textContent = t.target.w + "×" + t.target.h;
    tag.style.cssText =
      "position:absolute;left:0;bottom:100%;font:600 9px/1 system-ui;padding:1px 2px;color:#111;" +
      "background:" + (ok ? "#4ade80" : "#f472b6");
    box.appendChild(tag);
    document.body.appendChild(box);
  }
  return out.map((t) => ({ kind: t.kind, label: t.label, visible: t.visible, target: t.target.w + "x" + t.target.h }));
})()`;

const measured: Record<string, unknown> = {};
const targetsShot = async (page: Page, name: string) => {
  measured[name] = await page.evaluate(MEASURE_TARGETS);
  await shot(page, name);
};

const browser = await chromium.launch();

await fresh(browser, phone, async (page) => {
  await shot(page, "phone-01-list");
  await targetsShot(page, "phone-02-list-targets");
});
await fresh(browser, phone, async (page) => {
  await swipe(page, "Pick up dry cleaning");
  await shot(page, "phone-03-swipe-short-title");
});
await fresh(browser, phone, async (page) => {
  await swipe(page, "Renew passport");
  await shot(page, "phone-04-swipe-short-title-overdue");
});
await fresh(browser, phone, async (page) => {
  await swipe(page, "Book flights");
  await shot(page, "phone-05-swipe-long-title");
});
await fresh(browser, phone, async (page) => {
  await swipe(page, "Sort out the car insurance");
  await shot(page, "phone-06-swipe-long-title-assigned");
});
await fresh(browser, phone, async (page) => {
  await swipe(page, "Pick a restaurant for Friday");
  await shot(page, "phone-07-swipe-someone-elses-task");
});
await fresh(browser, phone, async (page) => {
  await openTask(page, "Book flights");
  await shot(page, "phone-08-detail-subtasks");
  await targetsShot(page, "phone-09-detail-targets");
});
// A 375px phone leaves the least title beside the tray
await fresh(browser, smallPhone, async (page) => {
  await swipe(page, "Pick up dry cleaning");
  await shot(page, "phone-10-small-screen-swipe-short-title");
});
await fresh(browser, smallPhone, async (page) => {
  await swipe(page, "Book flights");
  await shot(page, "phone-11-small-screen-swipe-long-title");
});

await fresh(browser, desktop, async (page) => {
  await shot(page, "desktop-01-list");
  await targetsShot(page, "desktop-02-list-targets");
});
await fresh(browser, desktop, async (page) => {
  await openTask(page, "Book flights");
  await shot(page, "desktop-03-detail-subtasks");
  await targetsShot(page, "desktop-04-detail-targets");
});

writeFileSync(`${OUT}/targets.json`, JSON.stringify(measured, null, 2));

// A swipe, which a still shows only at rest
{
  const dir = `${OUT}/clip-swipe`;
  mkdirSync(dir, { recursive: true });
  const { context, page } = await open(browser, phone, dir);
  const timeline = createTimeline(`${dir}/timeline.json`);
  await enableDemoClicks(page);
  await load(page);
  await showCaption(page, "1. Swipe a short title");
  timeline.show();
  await page.waitForTimeout(700);
  await swipe(page, "Pick up dry cleaning");
  await page.waitForTimeout(1500);
  await showCaption(page, "2. Swipe a long title");
  await swipe(page, "Book flights");
  await page.waitForTimeout(1800);
  timeline.save();
  const video = page.video();
  await context.close();
  await video?.saveAs(`${dir}/video.webm`);
}

await browser.close();
stream.close();
console.log(`evidence written to ${OUT}`);
