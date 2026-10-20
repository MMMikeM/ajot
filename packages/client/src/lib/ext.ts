// Firefox exposes the WebExtension API as `browser`; Chrome only as `chrome`, whose MV3 calls
// return promises for everything this app uses (runtime messaging, storage.local). Undefined
// outside an extension, so callers check getBuildTarget() === "extension" first.
export const ext = ((globalThis as { browser?: typeof browser }).browser ??
  (globalThis as { chrome?: typeof browser }).chrome)!;
