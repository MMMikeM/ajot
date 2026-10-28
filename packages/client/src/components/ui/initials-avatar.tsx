import type { CSSProperties } from "react";
import { tv, type VariantProps } from "tailwind-variants";

const initialsAvatarVariants = tv({
  base: "flex shrink-0 items-center justify-center rounded-full leading-none font-semibold",
  variants: {
    size: {
      sm: "size-5.5 text-[11px] tracking-tight",
      md: "size-7 text-xs",
    },
    // Hollow, so an assignee doesn't read as the owner
    hollow: {
      false: "bg-(--face) text-face-foreground",
      true: "bg-transparent text-hint ring-1 ring-(--face) ring-inset",
    },
  },
  defaultVariants: { size: "sm", hollow: false },
});

const FACES = ["slate", "iris", "plum", "clay", "ochre", "teal"] as const;

/** The same face colour for a person everywhere, from their id (FNV-1a). */
const faceOf = (userId: string) => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < userId.length; i++) hash = Math.imul(hash ^ userId.charCodeAt(i), 0x01000193);
  return FACES[(hash >>> 0) % FACES.length];
};

type InitialsAvatarProps = VariantProps<typeof initialsAvatarVariants> & {
  name: string;
  userId: string;
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

export const InitialsAvatar = ({
  name,
  userId,
  label,
  size,
  hollow,
  className,
}: InitialsAvatarProps) => (
  <span
    className={initialsAvatarVariants({ size, hollow, class: className })}
    style={{ "--face": `var(--face-${faceOf(userId)})` } as CSSProperties}
    title={label ?? name}
  >
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
