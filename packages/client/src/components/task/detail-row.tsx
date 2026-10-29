import { type ReactNode } from "react";
import { cn } from "~/lib/utils";

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

/**
 * Something the task doesn't have yet, offered where it would live. The whole line is the
 * control, so the icon in the gutter brightens with its words.
 */
export const AddRow = ({
  icon,
  onClick,
  children,
}: {
  icon: ReactNode;
  onClick: () => void;
  children: ReactNode;
}) => (
  <button
    type="button"
    onClick={onClick}
    className="flex h-9 w-full cursor-pointer items-center gap-3 rounded-md text-left text-sm text-hint outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 touch:h-11 touch:text-base touch:active:text-foreground"
  >
    <span
      aria-hidden
      className="flex w-4 shrink-0 items-center justify-center touch:w-4.5 [&_svg]:size-4"
    >
      {icon}
    </span>
    {children}
  </button>
);
