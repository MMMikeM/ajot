import { type ReactNode } from "react";
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
      className="flex h-9 w-4 shrink-0 items-center justify-center text-hint touch:h-11 touch:w-4.5 [&_svg]:size-4"
    >
      {icon}
    </span>
    <div className="flex min-w-0 flex-1 flex-col">{children}</div>
  </div>
);
