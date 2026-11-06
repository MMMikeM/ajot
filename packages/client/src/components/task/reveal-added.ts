/**
 * A task added from the capture input joins the end of the list, often behind the touch input bar.
 * Only that task is revealed: rows arriving from sync or another device mustn't move the list
 * under someone reading it.
 */
let pendingTaskId: string | null = null;

export const revealWhenShown = (taskId: string) => {
  pendingTaskId = taskId;
};

/** Scrolls the pending task's row into view once it's in `list`; focus stays where it is. */
export const revealPendingRow = (list: HTMLElement | null) => {
  if (!pendingTaskId || !list) return;
  const row = list.querySelector(`[data-task-id="${CSS.escape(pendingTaskId)}"]`);
  if (!row) return;
  pendingTaskId = null;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  row.scrollIntoView({ block: "nearest", behavior: reduceMotion ? "auto" : "smooth" });
};
