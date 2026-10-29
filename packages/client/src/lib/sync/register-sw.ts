const UPDATE_POLL_MS = 60 * 60 * 1000;
// As often as the browser allows; Chrome decides from how much the app is used, hours apart
const PREWARM_EVERY_MS = 15 * 60 * 1000;

type PeriodicSyncRegistration = ServiceWorkerRegistration & {
  periodicSync?: { register: (tag: string, options: { minInterval: number }) => Promise<void> };
};

/** Chromium only, and only once the PWA is installed; elsewhere this does nothing. */
const registerPeriodicPrewarm = async (reg: PeriodicSyncRegistration) => {
  if (!reg.periodicSync) return;
  const { state } = await navigator.permissions.query({
    name: "periodic-background-sync" as PermissionName,
  });
  if (state !== "granted") return;
  await reg.periodicSync.register("prewarm", { minInterval: PREWARM_EVERY_MS });
};

export const registerServiceWorker = () => {
  console.log("[sw] guards:", {
    hasWindow: typeof window !== "undefined",
    isExtension: typeof window !== "undefined" && location.protocol.endsWith("-extension:"),
    hasSW: typeof window !== "undefined" && "serviceWorker" in navigator,
  });

  if (typeof window === "undefined") return console.log("[sw] skipped: no window");
  if (location.protocol.endsWith("-extension:"))
    return console.log("[sw] skipped: extension context");
  if (!("serviceWorker" in navigator)) return console.log("[sw] skipped: no serviceWorker API");

  // Pick up the new worker, but never reload the page while the user is looking at it
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (document.visibilityState === "hidden") {
      window.location.reload();
      return;
    }
    const reloadOnHide = () => {
      if (document.visibilityState === "hidden") {
        window.location.reload();
      }
    };
    document.addEventListener("visibilitychange", reloadOnHide);
  });

  console.log("[sw] calling register(/sw.js)");
  navigator.serviceWorker
    .register("/sw.js")
    .then((reg) => {
      console.log("[sw] registered:", reg.scope, reg);
      registerPeriodicPrewarm(reg).catch((err) => console.warn("[sw] periodic sync:", err));

      // Fallback: deploy pushes are the primary update signal
      setInterval(() => {
        reg.update().catch((err) => console.warn("[sw] update check failed:", err));
      }, UPDATE_POLL_MS);

      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
          reg.update().catch((err) => console.warn("[sw] update check failed:", err));
        }
      });
    })
    .catch((err) => console.error("[sw] registration failed:", err));
};
