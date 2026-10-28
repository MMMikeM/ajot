import { createContext, useContext, useSyncExternalStore } from "react";
import type { Task } from "~/lib/types";

/**
 * A list of task rows is one tab stop: only the row last focused keeps its controls in the tab
 * order, so Tab walks that row and then leaves the list, and the arrow keys move between rows.
 * Each row subscribes to whether it's the one, so moving renders two rows, not the list.
 */
export const createRowFocus = () => {
  let rowIds = new Set<string>();
  let lastFocusedId: string | undefined;
  let tabStopId: string | undefined;
  const listeners = new Set<() => void>();

  // A row that left the list (ticked, deleted, moved) hands the tab stop to the first row, or the
  // list would drop out of the tab order
  const settle = () => {
    const next =
      lastFocusedId !== undefined && rowIds.has(lastFocusedId)
        ? lastFocusedId
        : rowIds.values().next().value;
    if (next === tabStopId) return;
    tabStopId = next;
    for (const listener of listeners) listener();
  };

  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    tabStopId: () => tabStopId,
    setRows: (ids: string[]) => {
      rowIds = new Set(ids);
      settle();
    },
    focused: (id: string) => {
      lastFocusedId = id;
      settle();
    },
  };
};

export type RowFocus = ReturnType<typeof createRowFocus>;

export const RowFocusContext = createContext<RowFocus | null>(null);

const noSubscription = () => () => {};

/** Outside a list, a row's controls stay in the tab order. */
export const useIsTabStop = (taskId: string) => {
  const rowFocus = useContext(RowFocusContext);
  const isTabStop = () => !rowFocus || rowFocus.tabStopId() === taskId;
  return useSyncExternalStore(rowFocus?.subscribe ?? noSubscription, isTabStop, isTabStop);
};

/** The rows in the order the list shows them: each task, then its open subtasks. */
export const rowIdsOf = (tasks: Task[], subtasksByParent: Map<string, Task[]>) =>
  tasks.flatMap((task) => [
    task.id,
    ...(subtasksByParent.get(task.id) ?? [])
      .filter((sub) => sub.status !== "done")
      .map((sub) => sub.id),
  ]);

const ROW = "[data-task-id]";
const CHECKBOX = '[data-slot="checkbox"]';
const TEXT_ENTRY = "input, textarea, select, [contenteditable='true']";

const STEPS = new Map([
  ["ArrowDown", 1],
  ["j", 1],
  ["ArrowUp", -1],
  ["k", -1],
]);

/** The control the arrow keys focus in a row, and where Up from the first row goes instead. */
type RowKeys = { focusIn: string; beforeFirst?: () => void };

export const moveRowFocus = (
  list: HTMLElement,
  e: KeyboardEvent,
  { focusIn, beforeFirst }: RowKeys,
) => {
  if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  const target = e.target as HTMLElement;
  if (target.closest(TEXT_ENTRY)) return;
  const current = target.closest<HTMLElement>(ROW);
  // A row on its way out unmounts under the focus it's given
  const rows = [...list.querySelectorAll<HTMLElement>(ROW)].filter(
    (row) => row === current || !row.hasAttribute("data-leaving"),
  );
  const from = rows.indexOf(current!);
  if (from === -1) return;

  const step = STEPS.get(e.key);
  const to =
    e.key === "Home"
      ? 0
      : e.key === "End"
        ? rows.length - 1
        : step !== undefined
          ? Math.min(from + step, rows.length - 1)
          : undefined;
  if (to === undefined) return;
  e.preventDefault();
  if (to < 0) beforeFirst?.();
  else rows[to]!.querySelector<HTMLElement>(focusIn)?.focus();
};

export const listenForRowKeys = (list: HTMLElement, rowFocus: RowFocus) => {
  const onFocusIn = (e: FocusEvent) => {
    const id = (e.target as HTMLElement).closest<HTMLElement>(ROW)?.dataset.taskId;
    if (id) rowFocus.focused(id);
  };
  const onKeyDown = (e: KeyboardEvent) => moveRowFocus(list, e, { focusIn: CHECKBOX });
  list.addEventListener("focusin", onFocusIn);
  list.addEventListener("keydown", onKeyDown);
  return () => {
    list.removeEventListener("focusin", onFocusIn);
    list.removeEventListener("keydown", onKeyDown);
  };
};
