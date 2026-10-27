import { tv } from "tailwind-variants";

/** A row in the desktop sidebar or the phone's lists sheet, as a button or a link */
export const navRow = tv({
  base: "relative flex items-center rounded-lg text-sm transition-colors",
  variants: {
    place: {
      sidebar: "gap-2 px-3 py-1.5",
      sheet: "mx-2 h-12 gap-3 px-3 active:bg-secondary active:text-foreground",
    },
    active: {
      true: "text-foreground",
      false: "text-hint hover:text-foreground",
    },
  },
  defaultVariants: {
    place: "sidebar",
    active: false,
  },
});
