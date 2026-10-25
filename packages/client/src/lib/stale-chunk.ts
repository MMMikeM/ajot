const RELOADED_AT_KEY = "newtab-todo-stale-chunk-reload";
// Long enough that a chunk still missing after the reload is a real fault, not a loop to keep feeding
const RELOAD_COOLDOWN_MS = 60_000;

const lastReload = () => {
  try {
    return Number(sessionStorage.getItem(RELOADED_AT_KEY) ?? 0);
  } catch {
    return 0;
  }
};

/**
 * A deploy replaces the hashed chunks, so a tab opened before it can't load the lazy ones it hasn't
 * fetched yet. Reload once to pick up the new build, as a hard refresh did by hand.
 */
export const reloadOnStaleChunk = () => {
  window.addEventListener("vite:preloadError", (event) => {
    if (Date.now() - lastReload() < RELOAD_COOLDOWN_MS) return;
    try {
      sessionStorage.setItem(RELOADED_AT_KEY, String(Date.now()));
    } catch {
      // Without storage there's no loop guard, so leave the error to show instead
      return;
    }
    event.preventDefault();
    location.reload();
  });
};
