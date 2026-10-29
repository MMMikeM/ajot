import { type ComponentProps, type ReactNode } from "react";
import { tv, type VariantProps } from "tailwind-variants";
import { ListRow } from "~/components/ui/list-row";
import { cn } from "~/lib/utils";

/** The sheet's text: Body Small on desktop, 1rem on touch. Fields size their own, so they take it too. */
export const rowText = "text-sm touch:text-base";

export const lineButton =
  "flex cursor-pointer items-center rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50";

export const quietText = "text-hint hover:text-foreground touch:active:text-foreground";

/**
 * One line of the sheet. The gutter lines up with the title's checkbox, so icons hang under it and
 * every value starts where the title text does; a line is tall enough for a 44px target on touch.
 */
const detailRow = tv({
  slots: {
    root: "flex items-start gap-3",
    gutter:
      "flex h-9 w-4 shrink-0 items-center justify-center text-hint touch:h-11 touch:w-4.5 [&_svg]:size-4",
    body: ["min-w-0 flex-1", rowText],
  },
  variants: {
    content: {
      /** Controls the caller lays out */
      stack: { body: "flex flex-col" },
      /** One line of text, centred on the gutter */
      line: { body: "leading-9 touch:leading-11" },
      /** A sentence about the task the viewer can't change, such as who else can see it */
      hint: { body: "py-2 text-hint touch:py-3" },
    },
  },
  defaultVariants: { content: "stack" },
});

export const DetailRow = ({
  icon,
  label,
  content,
  children,
}: {
  icon?: ReactNode;
  label?: string;
  children: ReactNode;
} & VariantProps<typeof detailRow>) => {
  const { root, gutter, body } = detailRow({ content });
  return (
    <div className={root()} role={label ? "group" : undefined} aria-label={label}>
      <span aria-hidden className={gutter()}>
        {icon}
      </span>
      <div className={body()}>{children}</div>
    </div>
  );
};

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
}) => {
  const { root, gutter, body } = detailRow({ content: "line" });
  return (
    <button
      type="button"
      onClick={onClick}
      className={root({ class: [lineButton, quietText, "w-full"] })}
    >
      <span aria-hidden className={gutter({ class: "text-current" })}>
        {icon}
      </span>
      <span className={body()}>{children}</span>
    </button>
  );
};

/** A subtask, note or person on the task: a row of its own that lights up under the pointer. */
export const ItemRow = ({ className, ...props }: Omit<ComponentProps<typeof ListRow>, "size">) => (
  <ListRow size="sm" className={cn("-mx-2 min-h-9 touch:min-h-11", className)} {...props} />
);
