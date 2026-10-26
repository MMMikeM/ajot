import { useEffect } from "react";
import { useRouter } from "@tanstack/react-router";
import { toastManager } from "~/lib/undo-toast";

const AGAIN_WITHIN_MS = 2000;

type IndexedState = { __TSR_index?: number };
const atFirstEntry = (state: unknown) => ((state as IndexedState).__TSR_index ?? 0) === 0;

/**
 * Installed, back from the first page closes the app, and a web app can't ask first: the browser
 * shows no prompt there, and the app can't close itself to honour a "Leave". So, as Android apps
 * do, the first page keeps a spare entry beneath it: back onto that one says to press back again,
 * and only a second press within two seconds leaves. In a browser tab, back still leaves at once.
 */
export const useLeaveGuard = () => {
  const router = useRouter();
  useEffect(() => {
    if (!window.matchMedia("(display-mode: standalone)").matches) return;
    const history = router.history;
    const guard = () => history.push(history.location.href, history.location.state);
    if (atFirstEntry(history.location.state)) guard();

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
      unsubscribe();
      clearTimeout(rearm);
    };
  }, [router]);
};
