import { TOKEN_KEY, MSG_SYNC_ALL } from "@newtab-todo/shared/constants";

// Firefox exposes the WebExtension API as `browser`; Chrome only as `chrome`, whose MV3 calls
// return promises for everything this app uses (runtime messaging, storage.local). Undefined
// outside an extension, so callers check getBuildTarget() === "extension" first.
export const ext = ((globalThis as { browser?: typeof browser }).browser ??
  (globalThis as { chrome?: typeof browser }).chrome)!;

export const getStoredToken = async () =>
  ((await ext.storage.local.get(TOKEN_KEY)) as Record<string, string | undefined>)[TOKEN_KEY];

export const notifyTabs = () => ext.runtime.sendMessage({ type: MSG_SYNC_ALL }).catch(() => {});
