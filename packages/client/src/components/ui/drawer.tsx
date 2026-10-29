import { ComponentProps, createContext, use, useEffect, useRef, useState } from "react";
import { Drawer as DrawerPrimitive } from "@base-ui/react/drawer";

import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

/** Whether the sheet is open (not on its way out), and whether it has finished sliding in */
const SheetContext = createContext({ open: false, settled: false });

// Base UI skips the enter transition for a drawer that mounts already open, and ours do (a task's
// route mounts its sheet open). Opening a frame after mounting gives the slide its starting frame.
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
    <SheetContext value={{ open: isOpen !== false, settled }}>
      <DrawerPrimitive.Root
        data-slot="drawer"
        open={isOpen}
        onOpenChangeComplete={(next) => {
          setSettled(next);
          onOpenChangeComplete?.(next);
        }}
        {...props}
      />
    </SheetContext>
  );
};

/**
 * Blurs the page above the sheet, once the sheet covers about half the screen: blurring the whole
 * page through the slide drops frames on phones. Settled, it shrinks to the strip left showing,
 * since the opaque sheet hides the rest.
 */
function SheetBlur() {
  const { open, settled } = use(SheetContext);
  const ref = useRef<HTMLDivElement>(null);
  const [halfway, setHalfway] = useState(false);
  useEffect(() => {
    if (halfway || !open) return;
    let frame = requestAnimationFrame(function check() {
      const sheetTop = ref.current?.parentElement?.getBoundingClientRect().top ?? Infinity;
      if (sheetTop <= window.innerHeight / 2) setHalfway(true);
      else frame = requestAnimationFrame(check);
    });
    return () => cancelAnimationFrame(frame);
  }, [halfway, open]);
  const blurred = open && (halfway || settled);
  return (
    <div
      ref={ref}
      aria-hidden="true"
      data-blurred={blurred || undefined}
      data-settled={settled || undefined}
      className="pointer-events-none absolute inset-x-0 bottom-full h-dvh transition-[backdrop-filter] duration-180 ease-out data-[settled]:h-[calc(100dvh-100%)] supports-backdrop-filter:data-[blurred]:backdrop-blur-xs desk:hidden [[data-swiping]>&]:backdrop-blur-none"
    />
  );
}

const DrawerContent = ({
  className,
  children,
  ...props
}: ComponentProps<typeof DrawerPrimitive.Popup>) => {
  const { open, settled } = use(SheetContext);
  const resting = open && settled;
  return (
    <DrawerPrimitive.Portal>
      {/* On touch the sheet is full width, so the page blurs above it instead (SheetBlur). On
          desktop it blurs here once the sheet rests, and stops the moment it moves (closing).
          Three values per list: the build writes backdrop-filter out as two properties. */}
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
            "motion-reduce:transition-opacity motion-reduce:data-[ending-style]:transform-none! motion-reduce:data-[starting-style]:transform-none!",
            "motion-reduce:data-[ending-style]:opacity-0 motion-reduce:data-[starting-style]:opacity-0",
            className,
          )}
          {...props}
        >
          <SheetBlur />
          <div className="mx-auto mt-4 h-1.5 w-[100px] shrink-0 rounded-full bg-muted" />
          <DrawerPrimitive.Content className="overflow-y-auto overscroll-contain">
            {children}
          </DrawerPrimitive.Content>
          {/* Screen readers on a phone can't swipe the sheet away or press Escape, and an
              installed PWA has no back button. Last, so Tab starts in the sheet's own content. */}
          <DrawerPrimitive.Close
            render={
              <Button
                variant="subtle"
                size="sm"
                className="absolute top-2 right-3 not-focus-visible:sr-only"
              />
            }
          >
            Close
          </DrawerPrimitive.Close>
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

const DrawerClose = (props: ComponentProps<typeof DrawerPrimitive.Close>) => (
  <DrawerPrimitive.Close data-slot="drawer-close" {...props} />
);

export { Drawer, DrawerClose, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription };
