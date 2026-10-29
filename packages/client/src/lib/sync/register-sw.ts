import { MSG_BUILD_VERSION } from "@newtab-todo/shared/constants";
import { toastManager } from "~/lib/undo-toast";
const UPDATE_POLL_MS = 60 * 60 * 1000;
// As often as the browser allows; Chrome decides from how much the app is used, hours apart
const PREWARM_EVERY_MS = 15 * 60 * 1000;

let offered = false;

/**
 * A newer build's worker has taken over, and this page, on the build before it, may no longer match
 * the server. Reloading is the user's call while they're looking, since it would lose whatever
 * they're in the middle of; once the page is hidden there's nothing on screen to lose.
 */
const offerReload = () => {
  if (offered) return;
  offered = true;
  toastManager.add({
    title: "Ajot has been updated.",
    timeout: 0,
    data: { action: { label: "Reload", onPress: () => location.reload() } },
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") location.reload();
  });
};

/** A deploy restarts the server, so whatever notices that asks for the new build straight away. */
export const checkForUpdate = () => {
  if (!("serviceWorker" in navigator) || location.protocol.endsWith("-extension:")) return;
  navigator.serviceWorker
    .getRegistration()
    .then((reg) => reg?.update())
    .catch((err) => console.warn("[sw] update check failed:", err));
};

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

  // Any worker taking over, the first included, is asked its build: only a different one is news
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    navigator.serviceWorker.controller?.postMessage({ type: MSG_BUILD_VERSION });
  });
  navigator.serviceWorker.addEventListener("message", (event) => {
    const reply = event.data as { type?: string; version?: string } | null;
    if (reply?.type === MSG_BUILD_VERSION && reply.version !== __BUILD_VERSION__) offerReload();
  });

  console.log("[sw] calling register(/sw.js)");
  navigator.serviceWorker
    .register("/sw.js")
    .then((reg) => {
      console.log("[sw] registered:", reg.scope, reg);
      registerPeriodicPrewarm(reg).catch((err) => console.warn("[sw] periodic sync:", err));

      // Fallbacks for when the stream can't reopen, such as a server without one
      setInterval(checkForUpdate, UPDATE_POLL_MS);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") checkForUpdate();
      });
    })
    .catch((err) => console.error("[sw] registration failed:", err));
};
