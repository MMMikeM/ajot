import { Toast } from "@base-ui/react/toast";

export const toastManager = Toast.createToastManager();

/** Pushes a toast whose Undo runs `onUndo`; returns the toast's id. */
export const pushUndoToast = (title: string, onUndo: () => void) =>
  toastManager.add({ title, timeout: 5000, data: { onUndo } });
