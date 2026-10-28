import { type ComponentProps } from "react";
import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { tv } from "tailwind-variants";
import { buttonVariants } from "~/components/ui/button";
import { cn, type StyledProps } from "~/lib/utils";

const revealButtonVariants = tv({
  extend: buttonVariants,
  // Hover-revealed on desktop; always visible on touch, where there is no hover to reveal it
  base: "opacity-0 transition-[color,opacity] group-hover/row:opacity-100 focus-visible:opacity-100 touch:text-sm touch:opacity-100",
  defaultVariants: {
    variant: "subtle",
    size: "xs",
    intent: "destructive",
  },
});

type RevealButtonProps = StyledProps<ButtonPrimitive.Props, typeof revealButtonVariants>;

const splitProps = <P extends object, K extends keyof P>(props: P, keys: readonly K[]) => {
  const picked = {} as Pick<P, K>;
  const rest = { ...props };
  for (const key of keys) {
    picked[key] = props[key];
    delete rest[key];
  }
  return [picked, rest as Omit<P, K>] as const;
};

// Renders the primitive directly: revealButtonVariants already extends the full Button
// class set. Going through <Button> would re-apply Button's own defaults (variant
// "default" = bg-primary) underneath these classes.
export const RevealButton = ({ className, ...props }: RevealButtonProps) => {
  const [variants, rest] = splitProps(props, revealButtonVariants.variantKeys);
  return (
    <ButtonPrimitive
      data-slot="button"
      className={revealButtonVariants({ ...variants, class: className })}
      {...rest}
    />
  );
};

// Desktop: floats over the row's end instead of reserving space. Touch: in flow.
export const RevealGroup = ({ className, ...props }: ComponentProps<"div">) => (
  <div
    className={cn(
      "pointer-events-none absolute inset-y-0 right-0 flex items-center rounded-r-[inherit] bg-muted [mask-image:linear-gradient(to_right,transparent,black_1.5rem)] pr-1 pl-6 opacity-0 transition-opacity group-hover/row:pointer-events-auto group-hover/row:opacity-100 touch:pointer-events-auto touch:static touch:bg-transparent touch:[mask-image:none] touch:p-0 touch:opacity-100 row-focus-visible:pointer-events-auto row-focus-visible:opacity-100",
      className,
    )}
    {...props}
  />
);

export { revealButtonVariants };
