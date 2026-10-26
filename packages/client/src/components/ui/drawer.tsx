import { ComponentProps, createContext, use, useEffect, useState } from "react";
import { Drawer as DrawerPrimitive } from "@base-ui/react/drawer";

import { cn } from "~/lib/utils";

/** Whether the sheet has finished sliding in and isn't on its way out */
const RestingContext = createContext(false);

// Base UI skips the enter transition for a drawer that mounts already open, and ours do (a task's
// route mounts its sheet open), so they appeared at once instead of sliding in. Opening a frame
// after mounting gives the slide its starting frame.
const Drawer = ({
  open,
  onOpenChangeComplete,
  ...props
}: ComponentProps<typeof DrawerPrimitive.Root>) => {
  const [mounted, setMounted] = useState(false);
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  const isOpen = open === undefined ? undefined : open && mounted;
  return (
    <RestingContext value={settled && isOpen !== false}>
      <DrawerPrimitive.Root
        data-slot="drawer"
        open={isOpen}
        onOpenChangeComplete={(next) => {
          setSettled(next);
          onOpenChangeComplete?.(next);
        }}
        {...props}
      />
    </RestingContext>
  );
};

const DrawerContent = ({
  className,
  children,
  ...props
}: ComponentProps<typeof DrawerPrimitive.Popup>) => {
  const resting = use(RestingContext);
  return (
    <DrawerPrimitive.Portal>
      {/* Re-blurring the page every frame dropped frames on phones, so the page only blurs while
          the sheet rests, and stops the moment it moves (closing, or dragged). Three values per
          list: the build writes backdrop-filter out as two properties. On touch the sheet is
          full width, so the blur sits above it instead (below), never under it. */}
      <DrawerPrimitive.Backdrop
        data-slot="drawer-backdrop"
        data-resting={resting || undefined}
        className="fixed inset-0 z-50 bg-backdrop transition-[opacity,backdrop-filter] duration-[380ms,180ms,180ms] ease-[cubic-bezier(0.16,1,0.3,1),ease-out,ease-out] data-[ending-style]:opacity-0 data-[ending-style]:duration-[calc(var(--drawer-swipe-strength,1)*280ms),0ms,0ms] data-[starting-style]:opacity-0 data-[swiping]:backdrop-blur-none data-[swiping]:duration-0 supports-backdrop-filter:desk:data-[resting]:backdrop-blur-xs"
      />
      <DrawerPrimitive.Viewport className="fixed inset-0 z-50 flex touch-none items-end justify-center">
        <DrawerPrimitive.Popup
          data-slot="drawer-content"
          className={cn(
            "relative flex h-auto max-h-[80vh] w-full flex-col rounded-t-xl border-t border-border bg-popover text-sm text-popover-foreground",
            "[transform:translateY(var(--drawer-swipe-movement-y,0px))]",
            "transition-transform duration-[380ms] ease-[cubic-bezier(0.16,1,0.3,1)]",
            "data-[swiping]:duration-0 data-[swiping]:select-none",
            "data-[starting-style]:[transform:translateY(calc(100%+2px))]",
            "data-[ending-style]:[transform:translateY(calc(100%+2px))]",
            "data-[ending-style]:duration-[calc(var(--drawer-swipe-strength,1)*280ms)]",
            className,
          )}
          {...props}
        >
          {/* Exactly the page left showing above the sheet: the opaque sheet hides the rest */}
          <div
            aria-hidden="true"
            data-resting={resting || undefined}
            className="pointer-events-none absolute inset-x-0 bottom-full h-[calc(100dvh-100%)] transition-[backdrop-filter] duration-180 ease-out supports-backdrop-filter:data-[resting]:backdrop-blur-xs desk:hidden [[data-swiping]>&]:backdrop-blur-none"
          />
          <div className="mx-auto mt-4 h-1.5 w-[100px] shrink-0 rounded-full bg-muted" />
          <DrawerPrimitive.Content className="overflow-y-auto overscroll-contain">
            {children}
          </DrawerPrimitive.Content>
        </DrawerPrimitive.Popup>
      </DrawerPrimitive.Viewport>
    </DrawerPrimitive.Portal>
  );
};

const DrawerHeader = ({ className, ...props }: ComponentProps<"div">) => {
  return (
    <div
      data-slot="drawer-header"
      className={cn("flex flex-col gap-0.5 p-4 md:gap-1.5", className)}
      {...props}
    />
  );
};

const DrawerTitle = ({ className, ...props }: ComponentProps<typeof DrawerPrimitive.Title>) => {
  return (
    <DrawerPrimitive.Title
      data-slot="drawer-title"
      className={cn("font-medium text-foreground", className)}
      {...props}
    />
  );
};

const DrawerDescription = ({
  className,
  ...props
}: ComponentProps<typeof DrawerPrimitive.Description>) => {
  return (
    <DrawerPrimitive.Description
      data-slot="drawer-description"
      className={cn("text-sm text-hint", className)}
      {...props}
    />
  );
};

export { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription };
