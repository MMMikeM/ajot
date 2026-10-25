import type { ComponentProps } from "react";
import type { Drawer } from "@base-ui/react/drawer";

type OnOpenChange = NonNullable<ComponentProps<typeof Drawer.Root>["onOpenChange"]>;

// Toasts sit above an open sheet but outside it, so pressing Undo or dismiss reads as a press outside
const isToastPress = (event: Event) =>
  event.target instanceof Element && event.target.closest("[data-toast-undo]") !== null;

/** A sheet's onOpenChange that ignores presses on a toast, so Undo doesn't close the sheet under it. */
export const keepOpenOnToastPress =
  (setOpen: (open: boolean) => void): OnOpenChange =>
  (open, details) => {
    if (!open && details.reason === "outside-press" && isToastPress(details.event)) {
      details.cancel();
      return;
    }
    setOpen(open);
  };
