import { createRootRoute, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { ClientOnly, Outlet } from "@tanstack/react-router";
import { AppShell } from "~/AppBackground";
import { UpdateBanner } from "~/components/update-banner";
import { SyncSettings } from "~/components/SyncSettings";
import { TaskListSkeleton } from "~/components/task/list-skeleton";
import { Toast, Toasts } from "~/components/ui/toast";
import { NavContextProvider } from "~/lib/state/nav-context";
import { isListPath } from "~/lib/list-path";
import { registerServiceWorker } from "~/lib/sync/register-sw";
import { UndoShortcut, toastManager } from "~/lib/undo-toast";
import { useLeaveGuard } from "~/lib/hooks/use-leave-guard";

export const Route = createRootRoute({
  component: RootComponent,
});

export default function RootComponent() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    registerServiceWorker();
  }, []);
  useLeaveGuard();

  return (
    <NavContextProvider>
      <Toast.Provider toastManager={toastManager} limit={3}>
        <ClientOnly>
          <UpdateBanner />
        </ClientOnly>
        <AppShell
          withSidebar={
            isListPath(pathname) ||
            pathname.startsWith("/search") ||
            pathname === "/people" ||
            pathname === "/settings"
          }
          right={
            <ClientOnly
              fallback={
                <span className="text-muted-foreground opacity-40 touch:flex touch:h-9 touch:items-center">
                  &#x2699;
                </span>
              }
            >
              <SyncSettings />
            </ClientOnly>
          }
        >
          {/* Routes read localStorage-backed stores, which have no value to prerender */}
          <ClientOnly fallback={<TaskListSkeleton />}>
            <Outlet />
          </ClientOnly>
        </AppShell>
        <ClientOnly>
          <Toast.Portal>
            {/* Here rather than on a page, so every page shows its toasts. Touch: float above the
                bottom input bar, where a page has one, instead of covering it. Over an open sheet,
                sit above it in the room it leaves at the top, where Undo covers none of its controls. */}
            <Toast.Viewport className="fixed bottom-4 left-1/2 z-60 w-[min(360px,90vw)] -translate-x-1/2 sm:bottom-6 touch:bottom-[calc(var(--input-bar-h,env(safe-area-inset-bottom,0px))+0.75rem)] desk:bottom-[calc(var(--sheet-inset)+1.5rem)] desk:left-[calc(50%+var(--column-shift))] [body:has([data-slot=drawer-content])_&]:top-[calc(max(env(safe-area-inset-top,0px),var(--banner-h,0px))+4rem)] [body:has([data-slot=drawer-content])_&]:bottom-auto desk:[body:has([data-slot=drawer-content])_&]:top-[calc(var(--sheet-inset)+3.5rem+var(--banner-h,0px))]">
              <Toasts />
            </Toast.Viewport>
          </Toast.Portal>
          <UndoShortcut />
        </ClientOnly>
      </Toast.Provider>
    </NavContextProvider>
  );
}
