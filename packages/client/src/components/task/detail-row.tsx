import { type ReactNode } from "react";
import { Toast } from "@base-ui/react/toast";
import { cn } from "~/lib/utils";

export type DetailPiece = "description" | "subtask" | "note" | "list" | "share" | "assignee";

/**
 * One line of the sheet. The gutter lines up with the title's checkbox, so icons hang
 * under it and every value starts where the title text does.
 */
export const DetailRow = ({
  icon,
  label,
  className,
  children,
}: {
  icon?: ReactNode;
  label?: string;
  className?: string;
  children: ReactNode;
}) => (
  <div
    className={cn("flex items-start gap-3", className)}
    role={label ? "group" : undefined}
    aria-label={label}
  >
    <span
      aria-hidden
      className="flex h-9 w-4 shrink-0 items-center justify-center text-hint touch:h-11 touch:w-[18px] [&_svg]:size-4"
    >
      {icon}
    </span>
    <div className="flex min-w-0 flex-1 flex-col">{children}</div>
  </div>
);

/** Grows a 36px touch control to a 44px target without changing its size. */
export const hitArea =
  "relative touch:h-9 touch:after:absolute touch:after:inset-x-0 touch:after:-inset-y-1";

export const useUndoToast = () => {
  const toastManager = Toast.useToastManager();
  return (title: string, onUndo: () => void) =>
    toastManager.add({ title, timeout: 5000, data: { onUndo } });
};
