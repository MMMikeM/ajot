import { cn } from "~/lib/utils";

/**
 * A sheet over AppShell's column. On desktop it docks inside the notepad's inset, so it reads as a
 * page of the notepad rather than a drawer from the window edge, and it stops short enough to
 * leave room above it for the toast viewport, which moves above an open sheet.
 */
export const dockedSheet = cn(
  "max-w-(--column-w) border-x touch:max-w-none touch:border-x-0",
  "desk:mb-(--sheet-inset) desk:max-h-[calc(100dvh-2*var(--sheet-inset)-4rem)] desk:translate-x-(--column-shift) desk:rounded-2xl desk:border-b",
  "desk:data-[ending-style]:[transform:translateY(calc(100%+var(--sheet-inset)+2px))] desk:data-[starting-style]:[transform:translateY(calc(100%+var(--sheet-inset)+2px))]",
);
