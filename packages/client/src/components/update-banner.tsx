import { Button } from "~/components/ui/button";
import { useUpdateReady } from "~/lib/sync/register-sw";

// The shell, the sidebar and a docked sheet sit this much lower while it shows
const publishHeight = (banner: HTMLDivElement | null) => {
  if (!banner) return;
  const root = document.documentElement;
  const observer = new ResizeObserver(([entry]) =>
    root.style.setProperty("--banner-h", `${entry!.borderBoxSize[0]!.blockSize}px`),
  );
  observer.observe(banner);
  return () => {
    observer.disconnect();
    root.style.removeProperty("--banner-h");
  };
};

/** Can't be dismissed: a page on an old build may no longer match the server. */
export const UpdateBanner = () => {
  const ready = useUpdateReady();
  // Always mounted, so a screen reader announces the banner arriving in it
  return (
    <div aria-live="polite">
      {ready && (
        <div
          ref={publishHeight}
          className="fixed inset-x-0 top-0 z-60 border-b border-primary/35 bg-primary-subtle pt-[env(safe-area-inset-top,0px)]"
        >
          <div className="mx-auto flex max-w-[calc(var(--sidebar-w)+var(--column-w))] items-center gap-4 px-6 py-3 touch:max-w-lg touch:px-[max(1.25rem,env(safe-area-inset-left,0px),env(safe-area-inset-right,0px))] touch:py-3.5">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <p className="text-sm font-semibold text-foreground touch:text-base">
                A new version of Ajot is ready
              </p>
              <p className="text-xs text-primary touch:text-sm">
                Reload to keep your lists in step with the server.
              </p>
            </div>
            <Button variant="solid" onClick={() => location.reload()}>
              Reload
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
