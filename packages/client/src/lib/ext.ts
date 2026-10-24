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

type DataCollectionPermissions = {
  request: (permissions: { data_collection: string[] }) => Promise<boolean>;
};

/**
 * Asks Firefox to let the add-on send the account to a sync server, as the manifest's optional
 * data_collection_permissions declare. Chrome has no such consent, so it resolves true there.
 * Firefox only shows the prompt when this is called straight from a click or key handler.
 */
export const requestSyncDataConsent = (): Promise<boolean> => {
  const gecko = ext.runtime.getManifest().browser_specific_settings?.gecko as
    | { data_collection_permissions?: { optional?: string[] } }
    | undefined;
  const optional = gecko?.data_collection_permissions?.optional;
  if (!optional?.length) return Promise.resolve(true);
  return (ext.permissions as unknown as DataCollectionPermissions).request({
    data_collection: optional,
  });
};
