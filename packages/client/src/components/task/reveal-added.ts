/**
 * A task added from the capture input joins the end of the list, often below the fold or behind
 * the touch input bar. Only that task is revealed: rows arriving from sync or another device
 * mustn't move the list under someone reading it.
 */
let pending: { taskId: string; onShown: () => void } | null = null;

export const revealWhenShown = (taskId: string, onShown: () => void) => {
  pending = { taskId, onShown };
};

/** Scrolls the pending task's row into view once it's in `list`; focus stays where it is. */
export const revealPendingRow = (list: HTMLElement | null) => {
  if (!pending || !list) return;
  const row = list.querySelector(`[data-task-id="${CSS.escape(pending.taskId)}"]`);
  if (!row) return;
  const { onShown } = pending;
  pending = null;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  row.scrollIntoView({ block: "nearest", behavior: reduceMotion ? "auto" : "smooth" });
  onShown();
};
