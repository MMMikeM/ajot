import { hoursFromNow } from "@newtab-todo/shared/iso";

/** Outlasts an Undo toast paused while the page is hidden, but not a later change of mind. */
export const undoableSince = () => hoursFromNow(-1);
