/**
 * Times the task list's startup against a production build: loads it once so the lists are saved
 * on the device, then reloads it and reports the median of each [startup] step.
 *
 * Usage (with `vp preview` serving packages/client/dist):
 *   BASE_URL=http://localhost:4174 npx tsx startup-bench.ts [--runs=15] [--cpu=4]
 */

import { chromium } from "@playwright/test";
import { mockApi } from "./helpers/mock-api";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:4174";
const flags = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith("--"))
    .map((a) => a.slice(2).split("=") as [string, string]),
);
const RUNS = Number(flags.runs ?? 15);
const CPU_RATE = Number(flags.cpu ?? 4);

const browser = await chromium.launch();
const page = await browser.newPage();
await mockApi(page);
const cdp = await page.context().newCDPSession(page);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_RATE });

let startupLine: Promise<string> = Promise.resolve("");
const nextStartupLine = () =>
  new Promise<string>((resolve) => {
    const onConsole = (msg: { text: () => string }) => {
      const text = msg.text();
      if (!text.startsWith("[startup]") || !/tasks-shown|list-ready/.test(text)) return;
      page.off("console", onConsole);
      resolve(text);
    };
    page.on("console", onConsole);
  });

startupLine = nextStartupLine();
await page.goto(BASE_URL);
await page.waitForSelector("[data-task-id]");
await startupLine;
// Past the snapshot's save delay, so each reload starts from saved lists
await page.waitForTimeout(1000);

const steps = new Map<string, number[]>();
for (let i = 0; i < RUNS; i++) {
  startupLine = nextStartupLine();
  await page.reload();
  const line = await startupLine;
  for (const [, step, ms] of line.matchAll(/([\w:-]+) (\d+)ms/g)) {
    steps.set(step, [...(steps.get(step) ?? []), Number(ms)]);
  }
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
console.log(`${RUNS} reloads at ${CPU_RATE}× CPU, median per step:`);
for (const [step, ms] of steps) console.log(`  ${step.padEnd(20)} ${median(ms)}ms`);

await browser.close();
