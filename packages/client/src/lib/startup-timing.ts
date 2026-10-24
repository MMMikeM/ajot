// Times each new tab's startup. Every mark is also a performance.mark, so it shows on the
// DevTools performance timeline and in the Firefox Profiler as a user timing.
const marks: string[] = [];
let finished = false;

const now = () => Math.round(performance.now());

/** Records a startup step, in ms since the page started loading. */
export const markStartup = (step: string) => {
  if (typeof window === "undefined") return;
  performance.mark(`startup:${step}`);
  if (finished) console.log(`[startup] ${step} ${now()}ms`);
  else marks.push(`${step} ${now()}ms`);
};

/** The list is on screen: prints the steps so far as one line. Later steps log on their own. */
export const finishStartup = (step: string) => {
  if (finished || typeof window === "undefined") return;
  markStartup(step);
  finished = true;
  console.log(`[startup] ${marks.join(" · ")}`);
};
