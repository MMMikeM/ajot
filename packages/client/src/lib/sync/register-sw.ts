const UPDATE_POLL_MS = 60 * 60 * 1000;
// As often as the browser allows; Chrome decides from how much the app is used, hours apart
const PREWARM_EVERY_MS = 15 * 60 * 1000;

const RECHECK_MS = 1000;
const TEXT_FIELDS =
  "textarea, input:not([type]), input[type=text], input[type=search], input[type=email], input[type=url], input[type=password]";

// A field can't say whether its text is saved, so any that holds some keeps the page: the capture
// input mid-thought, a search, the sign-in form, and an open sheet, whose title is a field
const holdsText = () =>
  [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(TEXT_FIELDS)].some(
    (field) => !field.readOnly && !field.disabled && field.value !== "",
  );

/**
 * A new deploy's worker has taken over, and this page still runs the build before it, which may no
 * longer match the server: reload now, or the moment no field holds text a reload would lose.
 */
const reloadForUpdate = () => {
  if (!holdsText()) return location.reload();
  const recheck = setInterval(() => {
    if (holdsText()) return;
    clearInterval(recheck);
    location.reload();
  }, RECHECK_MS);
};

/** A deploy restarts the server, so whatever notices that asks for the new build straight away. */
export const checkForUpdate = () => {
  if (!("serviceWorker" in navigator)) return;
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

  // The first worker to claim a page changes its controller too, and that page is already current
  let current = !navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (current) {
      current = false;
      return;
    }
    reloadForUpdate();
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
