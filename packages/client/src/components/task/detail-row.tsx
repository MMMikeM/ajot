import { type ReactNode } from "react";
import { cn } from "~/lib/utils";

const gutter = "flex w-4 shrink-0 items-center justify-center touch:w-4.5 [&_svg]:size-4";

export const lineButton =
  "flex cursor-pointer items-center rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50";

export const quietText = "text-hint hover:text-foreground touch:active:text-foreground";

/**
 * One line of the sheet. The gutter lines up with the title's checkbox, so icons hang
 * under it and every value starts where the title text does.
 */
export const DetailRow = ({
  icon,
  label,
  children,
}: {
  icon?: ReactNode;
  label?: string;
  children: ReactNode;
}) => (
  <div className="flex items-start gap-3" role={label ? "group" : undefined} aria-label={label}>
    <span aria-hidden className={cn(gutter, "h-9 text-hint touch:h-11")}>
      {icon}
    </span>
    <div className="flex min-w-0 flex-1 flex-col">{children}</div>
  </div>
);

/** A fact the viewer can't change, said as a quiet sentence: who else can see the task. */
export const HintRow = ({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label?: string;
  children: ReactNode;
}) => (
  <DetailRow icon={icon} label={label}>
    <p className="py-2 text-sm text-hint touch:py-3 touch:text-base">{children}</p>
  </DetailRow>
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
    className={cn(lineButton, quietText, "h-9 w-full gap-3 text-sm touch:h-11 touch:text-base")}
  >
    <span aria-hidden className={gutter}>
      {icon}
    </span>
    {children}
  </button>
);
