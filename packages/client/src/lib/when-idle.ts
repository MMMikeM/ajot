/** After the first paint, for work no open needs to wait on. */
export const whenIdle = (run: () => void) =>
  typeof requestIdleCallback === "function" ? requestIdleCallback(run) : setTimeout(run, 0);
