/**
 * Times everyday interactions against a production build and mocked data, and looks for jank
 * around them. For each step it prints:
 *   - INP: the slowest Event Timing entry, input to next paint, which is what INP reports
 *   - CLS: layout shift the user didn't cause, as Core Web Vitals counts it
 *   - long frames: animation frames over 50ms (the Long Animation Frames API)
 * Then the elements that shifted and the scripts behind the long frames, so a number points
 * somewhere.
 *
 * Usage (with `vp preview` serving packages/client/dist):
 *   BASE_URL=http://localhost:4174 npx tsx interaction-bench.ts [--runs=5] [--cpu=4] [--tasks=150] [--mobile]
 */

import { chromium, devices, type Locator, type Page } from "@playwright/test";
import { mockApi, mockData } from "./helpers/mock-api";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:4174";
const flags = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith("--"))
    .map((a) => {
      const [key, value = "true"] = a.slice(2).split("=");
      return [key, value];
    }),
);
const RUNS = Number(flags.runs ?? 5);
const CPU_RATE = Number(flags.cpu ?? 4);
const EXTRA_TASKS = Number(flags.tasks ?? 150);
const MOBILE = flags.mobile === "true";

const withExtraTasks = () => {
  const data = mockData();
  const [template] = data.tasks;
  for (let i = 0; i < EXTRA_TASKS; i++) {
    const id = `bench-${i}`;
    const sortOrder = `b${i.toString(36).padStart(3, "0")}`;
    data.tasks.push({ ...template!, id, title: `Bench task ${i}`, description: null, sortOrder });
    if (i % 5 === 0) {
      for (const n of [0, 1]) {
        data.tasks.push({
          ...template!,
          id: `${id}-sub-${n}`,
          parentId: id,
          title: `Bench subtask ${i}.${n}`,
          description: null,
          sortOrder: `${sortOrder}${n}`,
        });
      }
    }
  }
  return data;
};

type Shift = { value: number; counted: boolean; sources: string[] };
type Frame = { ms: number; scripts: string[]; renderMs: number };
type Sample = { inp: number; shifts: Shift[]; frames: Frame[] };

// A string, not a function: tsx wraps named functions in a helper the page doesn't have
const OBSERVERS = `
  window.__bench = { events: [], shifts: [], frames: [] };
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) if (e.interactionId) window.__bench.events.push(e.duration);
  }).observe({ type: "event", durationThreshold: 16, buffered: true });
  new PerformanceObserver((list) => {
    for (const e of list.getEntries())
      window.__bench.shifts.push({
        value: e.value,
        // Core Web Vitals leaves out a shift within 500ms of the user's input
        counted: !e.hadRecentInput,
        sources: (e.sources || []).map((s) => {
          const n = s.node;
          if (!n || !n.tagName) return "(text or removed)";
          const id = n.closest && n.closest("[data-task-id]");
          const slot = n.getAttribute("data-slot");
          return n.tagName.toLowerCase() + (slot ? "[data-slot=" + slot + "]" : "") +
            (id ? " in task row" : "") + (n.className && typeof n.className === "string" ? " ." + n.className.split(" ").slice(0, 3).join(".") : "");
        }),
      });
  }).observe({ type: "layout-shift", buffered: true });
  new PerformanceObserver((list) => {
    for (const e of list.getEntries())
      window.__bench.frames.push({
        ms: e.duration,
        renderMs: e.startTime + e.duration - (e.styleAndLayoutStart || e.renderStart || e.startTime + e.duration),
        scripts: (e.scripts || []).map((s) =>
          Math.round(s.duration) + "ms " + s.invoker + " " + (s.sourceFunctionName || "") + " " + (s.sourceURL || "").split("/").pop()),
      });
  }).observe({ type: "long-animation-frame", buffered: true });
`;

/** Runs `act`, waits for what it set off to settle, then returns what happened meanwhile. */
const step = async (page: Page, act: () => Promise<unknown>, settleMs = 300): Promise<Sample> => {
  await page.evaluate(
    "window.__bench.events = []; window.__bench.shifts = []; window.__bench.frames = []",
  );
  await act();
  await page.waitForTimeout(settleMs);
  return page.evaluate(
    "({ inp: Math.max(0, ...window.__bench.events), shifts: window.__bench.shifts, frames: window.__bench.frames })",
  );
};

// A locator's click() runs Playwright's actionability and hit-target checks in the page, which
// Event Timing would count as input delay. Find the point first, then send a bare click.
const tap = async (page: Page, locator: Locator) => {
  // Centred: on a phone the undo toast floats over the bottom of the list
  await locator.evaluate((el) => el.scrollIntoView({ block: "center" }));
  const box = await locator.boundingBox();
  if (!box) throw new Error(`Not on screen: ${String(locator)}`);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  return () => page.mouse.click(x, y);
};

const browser = await chromium.launch();
const results = new Map<string, Sample[]>();
const record = (name: string, sample: Sample) =>
  results.set(name, [...(results.get(name) ?? []), sample]);

for (let run = 0; run < RUNS; run++) {
  const context = await browser.newContext(MOBILE ? devices["iPhone 14"] : {});
  const page = await context.newPage();
  await mockApi(page, { data: withExtraTasks() });
  await page.addInitScript(OBSERVERS);
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_RATE });

  // Loaded twice, as a new tab is: the second starts from the lists the first saved on the device
  await page.goto(BASE_URL);
  await page.waitForSelector("[data-task-id]");
  await page.waitForTimeout(1500);
  await page.reload();
  await page.waitForSelector("[data-task-id]");
  await page.waitForTimeout(1500);
  // The observers were buffered, so this holds everything since the reload started
  record(
    "load",
    await page.evaluate(
      "({ inp: 0, shifts: window.__bench.shifts, frames: window.__bench.frames })",
    ),
  );

  const input = page.getByPlaceholder("What needs doing?");
  record("type a character", await step(page, () => input.pressSequentially("Buy milk")));
  record("add a task", await step(page, () => input.press("Enter"), 1000));

  // Long enough for the row to move to Done and the toast to settle
  const tick = await tap(page, page.getByRole("checkbox", { name: "Bench task 3", exact: true }));
  record("tick a task", await step(page, tick, 1500));

  const open = await tap(page, page.getByRole("button", { name: "Bench task 7", exact: true }));
  record("open a task", await step(page, open, 800));
  await page.waitForURL("**/task/**");
  record("close a task", await step(page, () => page.keyboard.press("Escape"), 800));

  // Wheel over the middle of the screen: the page scrolls on desktop, the list on a phone
  const viewport = page.viewportSize()!;
  await page.mouse.move(viewport.width / 2, viewport.height / 2);
  record(
    "scroll the list",
    await step(page, async () => {
      for (let i = 0; i < 12; i++) {
        await page.mouse.wheel(0, 250);
        await page.waitForTimeout(50);
      }
    }),
  );

  if (!MOBILE) {
    const lists = page.getByRole("navigation", { name: "Lists" });
    const work = await tap(page, lists.getByText("Work", { exact: true }));
    const inbox = await tap(page, lists.getByText("Inbox", { exact: true }));
    record("switch list", await step(page, work, 800));
    record("back to Inbox", await step(page, inbox, 800));
  }

  await context.close();
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
const cls = (s: Sample) => s.shifts.filter((x) => x.counted).reduce((sum, x) => sum + x.value, 0);
const pad = (value: string | number, width: number) => String(value).padStart(width);

console.log(
  `${RUNS} runs, ${MOBILE ? "iPhone 14" : "desktop"}, ${CPU_RATE}× CPU, ${EXTRA_TASKS} extra tasks`,
);
console.log(`  ${"".padEnd(18)}   INP ms        CLS   long frames   worst frame ms`);
console.log(`  ${"".padEnd(18)} median (max)   worst  median        (render part)`);
for (const [name, samples] of results) {
  const inps = samples.map((s) => Math.round(s.inp));
  const worstFrame = samples
    .flatMap((s) => s.frames)
    .reduce<Frame | undefined>((a, b) => (!a || b.ms > a.ms ? b : a), undefined);
  console.log(
    `  ${name.padEnd(18)} ${name === "load" ? pad("–", 6) + "      " : pad(median(inps), 6) + pad(`(${Math.max(...inps)})`, 6)}` +
      `${pad(Math.max(...samples.map(cls)).toFixed(3), 8)}` +
      `${pad(median(samples.map((s) => s.frames.length)), 9)}` +
      `${worstFrame ? pad(Math.round(worstFrame.ms), 14) + ` (${Math.round(worstFrame.renderMs)})` : pad("–", 14)}`,
  );
}

const shiftSources = new Map<string, number>();
const frameScripts = new Map<string, number>();
for (const [name, samples] of results) {
  for (const shift of samples.flatMap((s) => s.shifts)) {
    for (const source of shift.sources) {
      const key = `${name}: ${source}${shift.counted ? "" : " (after input)"}`;
      shiftSources.set(key, (shiftSources.get(key) ?? 0) + shift.value / RUNS);
    }
  }
  for (const frame of samples.flatMap((s) => s.frames)) {
    for (const script of frame.scripts) {
      const [ms, ...rest] = script.split(" ");
      const key = `${name}: ${rest.join(" ")}`;
      frameScripts.set(key, (frameScripts.get(key) ?? 0) + Number.parseInt(ms!, 10) / RUNS);
    }
  }
}
const top = (m: Map<string, number>, format: (v: number) => string) =>
  [...m]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([key, value]) => `  ${format(value).padStart(8)}  ${key}`);

console.log("\nWhat shifted (layout shift per run, any shift, input-driven ones marked):");
console.log(shiftSources.size ? top(shiftSources, (v) => v.toFixed(3)).join("\n") : "  nothing");
console.log("\nScripts in long frames (ms per run):");
console.log(
  frameScripts.size ? top(frameScripts, (v) => `${Math.round(v)}ms`).join("\n") : "  none",
);

await browser.close();
