import { useEffect } from "react";
import { useRouter } from "@tanstack/react-router";
import { toastManager } from "~/lib/undo-toast";

const AGAIN_WITHIN_MS = 2000;

type IndexedState = { __TSR_index?: number };
const atFirstEntry = (state: unknown) => ((state as IndexedState).__TSR_index ?? 0) === 0;

// Firefox reports an installed app as minimal-ui, since it keeps its own navigation controls
const INSTALLED_MODES = ["standalone", "minimal-ui", "fullscreen"];
const isInstalled = () =>
  INSTALLED_MODES.some((mode) => window.matchMedia(`(display-mode: ${mode})`).matches);

/**
 * Back skips an entry the user never interacted with before the page added the one above it
 * (Firefox: https://bugzilla.mozilla.org/show_bug.cgi?id=1645211, Chrome does the same), so a
 * spare entry pushed on load is skipped and back leaves at once.
 */
const onFirstInteraction = (run: () => void) => {
  const events = ["pointerup", "keydown"] as const;
  const stop = () => events.forEach((event) => window.removeEventListener(event, handle, true));
  const handle = () => {
    stop();
    run();
  };
  events.forEach((event) => window.addEventListener(event, handle, true));
  return stop;
};

/**
 * Installed, back from the first page closes the app, and a web app can't ask first: the browser
 * shows no prompt there, and the app can't close itself to honour a "Leave". So, as Android apps
 * do, the first page keeps a spare entry beneath it: back onto that one says to press back again,
 * and only a second press within two seconds leaves. In a browser tab, back still leaves at once.
 */
export const useLeaveGuard = () => {
  const router = useRouter();
  useEffect(() => {
    if (!isInstalled()) return;
    const history = router.history;
    const guard = () => {
      if (atFirstEntry(history.location.state))
        history.push(history.location.href, history.location.state);
    };
    const stopWaiting = onFirstInteraction(guard);

    let rearm: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = history.subscribe(() => {
      if (!atFirstEntry(history.location.state) || rearm) return;
      toastManager.add({ title: "Press back again to leave", timeout: AGAIN_WITHIN_MS, data: {} });
      rearm = setTimeout(() => {
        rearm = undefined;
        if (atFirstEntry(history.location.state)) guard();
      }, AGAIN_WITHIN_MS);
    });
    return () => {
      stopWaiting();
      unsubscribe();
      clearTimeout(rearm);
    };
  }, [router]);
};
