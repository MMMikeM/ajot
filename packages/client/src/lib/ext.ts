import { TOKEN_KEY, SERVER_URL_KEY, MSG_SYNC_ALL } from "@newtab-todo/shared/constants";

// Firefox exposes the WebExtension API as `browser`; Chrome only as `chrome`, whose MV3 calls
// return promises for everything this app uses (runtime messaging, storage.local). Undefined
// outside an extension, so callers check getBuildTarget() === "extension" first.
export const ext = ((globalThis as { browser?: typeof browser }).browser ??
  (globalThis as { chrome?: typeof browser }).chrome)!;

const getStored = async (key: string) =>
  ((await ext.storage.local.get(key)) as Record<string, string | undefined>)[key];

/**
 * Signed in to the server the user chose, as the background scripts see it. Both are needed:
 * without a server, there's nowhere to sync to.
 */
export const getStoredSession = async () => {
  const [token, serverUrl] = await Promise.all([getStored(TOKEN_KEY), getStored(SERVER_URL_KEY)]);
  return token && serverUrl ? { token, serverUrl } : null;
};

export const notifyTabs = () => ext.runtime.sendMessage({ type: MSG_SYNC_ALL }).catch(() => {});
