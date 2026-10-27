import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { tv } from "tailwind-variants";
import { type StyledProps } from "~/lib/utils";

const buttonVariants = tv({
  base: "group/button inline-flex shrink-0 items-center justify-center rounded-4xl border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  variants: {
    variant: {
      // Not the solid primary fill: light text on it measures about 3.2:1
      default:
        "bg-primary-subtle text-primary hover:bg-primary-selected active:bg-primary-selected",
      outline: "border-border bg-input/30 text-foreground hover:bg-input/50 aria-expanded:bg-muted",
      // A phone has no hover, so a press shows the well instead
      ghost:
        "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground touch:active:bg-muted touch:active:text-foreground",
      subtle:
        "text-hint hover:text-foreground touch:active:bg-secondary touch:active:text-foreground",
      link: "text-primary underline-offset-4 hover:underline",
    },
    intent: {
      default: "",
      destructive: "",
    },
    size: {
      default:
        "h-9 gap-1.5 px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5 touch:h-11",
      // 36px on touch, with a 44px target around it
      xs: "relative h-6 gap-1 px-2.5 text-xs has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 touch:h-9 touch:px-3 touch:after:absolute touch:after:inset-x-0 touch:after:-inset-y-1 [&_svg:not([class*='size-'])]:size-3",
      sm: "h-8 gap-1 px-3 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 touch:h-11 touch:px-3.5",
    },
    icon: {
      true: "px-0",
    },
    // Pulls a button out by its padding, so its label or glyph lines up with the column edge
    bleed: {
      start: "",
      end: "",
    },
  },
  compoundVariants: [
    {
      intent: "destructive",
      variant: "ghost",
      class:
        "bg-transparent text-destructive hover:bg-destructive/20 hover:text-destructive touch:active:bg-destructive/20 touch:active:text-destructive",
    },
    {
      intent: "destructive",
      variant: "subtle",
      class: "text-hint hover:text-destructive touch:active:text-destructive",
    },
    {
      intent: "destructive",
      class: "focus-visible:border-destructive/70 focus-visible:ring-destructive/70",
    },
    { icon: true, size: "default", class: "size-9 touch:size-11" },
    {
      icon: true,
      size: "xs",
      class:
        "size-6 touch:size-9 touch:px-0 touch:after:-inset-1 [&_svg:not([class*='size-'])]:size-3",
    },
    { icon: true, size: "sm", class: "size-8 touch:size-11 touch:px-0" },
    { bleed: "start", size: "xs", icon: false, class: "-ml-2.5 touch:-ml-3" },
    { bleed: "end", size: "xs", icon: false, class: "-mr-2.5 touch:-mr-3" },
    { bleed: "start", size: "sm", icon: false, class: "-ml-3 touch:-ml-3.5" },
    { bleed: "end", size: "sm", icon: false, class: "-mr-3 touch:-mr-3.5" },
    // An icon button lines up its glyph instead: half the box around a 12px (xs) or 16px glyph
    { bleed: "start", size: "xs", icon: true, class: "-ml-1.5 touch:-ml-3" },
    { bleed: "end", size: "xs", icon: true, class: "-mr-1.5 touch:-mr-3" },
    { bleed: "start", size: "sm", icon: true, class: "-ml-2 touch:-ml-3.5" },
    { bleed: "end", size: "sm", icon: true, class: "-mr-2 touch:-mr-3.5" },
    { bleed: "start", size: "default", icon: true, class: "-ml-2.5 touch:-ml-3.5" },
    { bleed: "end", size: "default", icon: true, class: "-mr-2.5 touch:-mr-3.5" },
  ],
  defaultVariants: {
    variant: "default",
    intent: "default",
    size: "default",
    icon: false,
  },
});

type ButtonProps = StyledProps<ButtonPrimitive.Props, typeof buttonVariants>;

const Button = ({ className, variant, intent, size, icon, bleed, ...props }: ButtonProps) => (
  <ButtonPrimitive
    data-slot="button"
    className={buttonVariants({ variant, intent, size, icon, bleed, class: className })}
    {...props}
  />
);

export { Button, buttonVariants };
