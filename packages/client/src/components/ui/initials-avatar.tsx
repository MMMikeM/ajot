import { tv, type VariantProps } from "tailwind-variants";
import { cn } from "~/lib/utils";

const initialsAvatarVariants = tv({
  base: "flex shrink-0 items-center justify-center rounded-full bg-primary-subtle leading-none font-semibold text-primary",
  variants: {
    size: {
      sm: "size-5.5 text-[11px] tracking-tight",
      md: "size-7 text-xs",
    },
  },
  defaultVariants: { size: "sm" },
});

type InitialsAvatarProps = VariantProps<typeof initialsAvatarVariants> & {
  name: string;
  /** What the face means here ("Sam's task"), for screen readers and on hover; defaults to the name. */
  label?: string;
  className?: string;
};

const initialsOf = (name: string) => {
  const words = name.trim().split(/\s+/);
  return words.length > 1
    ? `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase()
    : name.slice(0, 2).toUpperCase();
};

export const InitialsAvatar = ({ name, label, size, className }: InitialsAvatarProps) => (
  <span className={cn(initialsAvatarVariants({ size }), className)} title={label ?? name}>
    {label ? (
      <>
        <span aria-hidden="true">{initialsOf(name)}</span>
        <span className="sr-only">{label}</span>
      </>
    ) : (
      initialsOf(name)
    )}
  </span>
);

export { initialsAvatarVariants };
