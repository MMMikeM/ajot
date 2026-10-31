/** One holder at a time across every page and worker of this origin, where Web Locks exist. */
export const withLock = <T>(name: string, run: () => Promise<T>) =>
  typeof navigator !== "undefined" && navigator.locks ? navigator.locks.request(name, run) : run();
