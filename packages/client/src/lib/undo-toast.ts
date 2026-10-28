import { useEffect } from "react";
import { Toast } from "@base-ui/react/toast";

/**
 * A title naming what Undo brings back: `name` is cut short to keep the toast on one line, so the
 * words around it, which say what happened, always show.
 */
export type NamedTitle = { before: string; name: string; after?: string };

export type ToastData = { onUndo?: () => void; named?: NamedTitle };

export const toastManager = Toast.createToastManager<ToastData>();

// A thumb has further to travel to the toast than a pointer, and nothing to hover it with
const undoWindowMs = () => (matchMedia("(pointer: coarse)").matches ? 8000 : 5000);

const fullTitle = ({ before, name, after = "" }: NamedTitle) => `${before}${name}${after}`;

/** Pushes a toast whose Undo runs `onUndo`; returns the toast's id. */
export const pushUndoToast = (title: string | NamedTitle, onUndo: () => void) => {
  const isText = typeof title === "string";
  return toastManager.add({
    title: isText ? title : fullTitle(title),
    timeout: undoWindowMs(),
    data: { onUndo, named: isText ? undefined : title },
  });
};

/** A task, note or list as an Undo toast names it, first and quoted, so it gets the most room. */
export const quoted = (name: string, after: string, before = ""): NamedTitle => ({
  before: `${before}“`,
  name: name.split("\n", 1)[0],
  after: `”${after}`,
});

export const UNDO_KEYS = "Control+Z Meta+Z";

const undone = new WeakSet<() => void>();

/**
 * Closes the toast and runs its Undo once. The button stays pressable while the toast animates
 * out, and a second restore would re-insert rows that are already back.
 */
export const pressUndo = (id: string, onUndo: () => void) => {
  toastManager.close(id);
  if (undone.has(onUndo)) return;
  undone.add(onUndo);
  onUndo();
};

/**
 * ⌘Z / Ctrl+Z presses the newest toast's Undo. An open sheet traps Tab, so this is how the
 * keyboard reaches Undo without leaving the sheet. A field keeps its own text undo, except the
 * capture input while it's empty, which is focused on every new tab.
 */
export function UndoShortcut() {
  const { toasts } = Toast.useToastManager<ToastData>();
  useEffect(() => {
    const newest = toasts.find((t) => t.data?.onUndo && t.transitionStatus !== "ending");
    const onUndo = newest?.data?.onUndo;
    if (!newest || !onUndo) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "z" || !(e.metaKey || e.ctrlKey)) return;
      if (e.shiftKey || e.altKey || e.defaultPrevented) return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      const field = target?.closest<HTMLInputElement>(
        "input, textarea, select, [contenteditable='true']",
      );
      if (field && !(field.id === "add-task-input" && !field.value)) return;
      e.preventDefault();
      pressUndo(newest.id, onUndo);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [toasts]);
  return null;
}
