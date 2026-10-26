import { createRootRoute, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { ClientOnly, Outlet } from "@tanstack/react-router";
import { AppShell } from "~/AppBackground";
import { SyncSettings } from "~/components/SyncSettings";
import { TaskListSkeleton } from "~/components/task/list-skeleton";
import { Toast } from "~/components/ui/toast";
import { NavContextProvider } from "~/lib/state/nav-context";
import { isListPath } from "~/lib/list-path";
import { registerServiceWorker } from "~/lib/sync/register-sw";
import { toastManager } from "~/lib/undo-toast";

export const Route = createRootRoute({
  component: RootComponent,
});

export default function RootComponent() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    registerServiceWorker();
  }, []);

  return (
    <NavContextProvider>
      <Toast.Provider toastManager={toastManager} limit={3}>
        <AppShell
          withSidebar={isListPath(pathname) || pathname === "/people" || pathname === "/settings"}
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
      </Toast.Provider>
    </NavContextProvider>
  );
}
