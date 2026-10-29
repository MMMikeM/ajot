import { useEffect, useEffectEvent } from "react";
import { useRouter } from "@tanstack/react-router";

const SHEET = "ajot-sheet";
// Taking the entry off makes the router render the page again, which stalls the first frames of
// the closing slide; so it waits until the sheet has gone
const CLOSE_MS = 300;
let pendingBack: ReturnType<typeof setTimeout> | undefined;

/**
 * Back (Android's button or gesture) closes an open sheet rather than leaving the page. A sheet
 * that isn't a route of its own gets a history entry while it's open: back pops it and closes the
 * sheet, and closing it another way takes the entry off again. A sheet that navigates elsewhere
 * should replace its entry, so back from there lands on the page, not on a closed sheet.
 */
export const useBackToClose = (open: boolean, close: () => void) => {
  const router = useRouter();
  const onBack = useEffectEvent(close);
  useEffect(() => {
    if (!open) return;
    const history = router.history;
    const isSheetEntry = () => !!(history.location.state as Record<string, unknown>)[SHEET];
    // Reopened before the last close took its entry off: that entry serves this one too
    const reusable = pendingBack !== undefined && isSheetEntry();
    clearTimeout(pendingBack);
    pendingBack = undefined;
    if (!reusable)
      history.push(history.location.href, { ...history.location.state, [SHEET]: true });
    const unsubscribe = history.subscribe(() => {
      if (!isSheetEntry()) onBack();
    });
    return () => {
      unsubscribe();
      if (!isSheetEntry()) return;
      pendingBack = setTimeout(() => {
        pendingBack = undefined;
        if (isSheetEntry()) history.back();
      }, CLOSE_MS);
    };
  }, [open, router]);
};
