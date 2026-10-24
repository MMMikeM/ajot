import { Toast } from "@base-ui/react/toast";

/** Pushes a toast whose Undo runs `onUndo`; returns the toast's id. */
export const useUndoToast = () => {
  const toastManager = Toast.useToastManager();
  return (title: string, onUndo: () => void) =>
    toastManager.add({ title, timeout: 5000, data: { onUndo } });
};
