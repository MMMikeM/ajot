// Times each new tab's startup. Every mark is also a performance.mark, so it shows on the
// DevTools performance timeline and in the Firefox Profiler as a user timing.
const marks: string[] = [];
let finished = false;

const STALL_MS = 200;
const stalls: { at: number; ms: number }[] = [];
let stallWatch: ReturnType<typeof setInterval> | undefined;

const now = () => Math.round(performance.now());

/** Records a startup step, in ms since the page started loading. */
export const markStartup = (step: string) => {
  if (typeof window === "undefined") return;
  performance.mark(`startup:${step}`);
  if (finished) console.log(`[startup] ${step} ${now()}ms`);
  else marks.push(`${step} ${now()}ms`);
};

// A timer that fires late means the main thread was busy for the gap: the page was frozen, not
// waiting on storage or the network
const watchForStalls = () => {
  let last = performance.now();
  stallWatch = setInterval(() => {
    const at = performance.now();
    if (at - last > STALL_MS) stalls.push({ at: Math.round(last), ms: Math.round(at - last) });
    last = at;
  }, 50);
};

const pageSteps = () => {
  const nav = performance.getEntriesByType("navigation")[0] as
    | PerformanceNavigationTiming
    | undefined;
  return nav
    ? [
        `html-loaded ${Math.round(nav.responseEnd)}ms`,
        `dom-interactive ${Math.round(nav.domInteractive)}ms`,
      ]
    : [];
};

const slowestFiles = () =>
  (performance.getEntriesByType("resource") as PerformanceResourceTiming[])
    .map((r) => ({ name: r.name.split("/").pop(), start: r.startTime, end: r.responseEnd }))
    .sort((a, b) => b.end - b.start - (a.end - a.start))
    .slice(0, 3)
    .map(({ name, start, end }) => `${name} ${Math.round(start)}→${Math.round(end)}ms`);

/** The list is on screen: prints the steps so far as one line. Later steps log on their own. */
export const finishStartup = (step: string) => {
  if (finished || typeof window === "undefined") return;
  markStartup(step);
  finished = true;
  clearInterval(stallWatch);
  console.log(`[startup] ${[...pageSteps(), ...marks].join(" · ")}`);
  const files = slowestFiles();
  console.log(`[startup] slowest files: ${files.length ? files.join(" · ") : "none recorded"}`);
  console.log(
    `[startup] main thread stalls over ${STALL_MS}ms: ${
      stalls.length ? stalls.map(({ at, ms }) => `${ms}ms at ${at}ms`).join(" · ") : "none"
    }`,
  );
};

// main.tsx imports this module first, so this runs before any other module of ours
if (typeof window !== "undefined") {
  markStartup("js-start");
  watchForStalls();
}
