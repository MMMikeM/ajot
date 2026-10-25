import { Suspense } from "react";
import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { TaskInputBar } from "~/components/task/input-bar";
import { SyncHint } from "~/components/SyncHint";
import { Toast, Toasts } from "~/components/ui/toast";
import { TaskView } from "~/components/task/view";
import { CategoryHeader } from "~/components/category-nav/CategoryHeader";

function TaskListView() {
  const navigate = useNavigate();

  return (
    <>
      {/*
       * Desktop: list title, then the input, then content — DOM order.
       * Mobile (touch): flex column with order swapped. Input gets order-2 so it sinks
       * to the bottom of the viewport; content gets order-1 and fills the remaining space.
       * CategoryHeader keeps the default order, so it sits above the content.
       * Fragment children become direct flex children of AppShell via <Outlet />.
       */}
      <CategoryHeader />
      <TaskInputBar />
      {/* Touch: widened by the rows' -mx-2, or overflow-x-hidden cuts off a swiped row's tray */}
      <div className="scroll-edge-fade touch:order-1 touch:-mx-2 touch:flex touch:min-h-0 touch:flex-1 touch:flex-col touch:overflow-x-hidden touch:overflow-y-auto touch:px-2">
        <Suspense fallback={null}>
          <SyncHint />
        </Suspense>
        <div className="mt-2 flex flex-1 flex-col gap-4">
          <TaskView
            onSelectTask={(taskId) => navigate({ to: "/task/$taskId", params: { taskId } })}
          />
          <Outlet />
        </div>
      </div>
      <Toast.Portal>
        {/* Touch: float above the bottom input bar instead of covering it. Over an open sheet,
            sit above it in the room it leaves at the top, where Undo covers none of its controls. */}
        <Toast.Viewport className="fixed bottom-4 left-1/2 z-60 w-[min(360px,90vw)] -translate-x-1/2 sm:bottom-6 touch:bottom-[calc(var(--input-bar-h,7rem)+0.75rem)] desk:bottom-[calc(var(--sheet-inset)+1.5rem)] desk:left-[calc(50%+var(--column-shift))] [body:has([data-slot=drawer-content])_&]:top-[calc(env(safe-area-inset-top,0px)+4rem)] [body:has([data-slot=drawer-content])_&]:bottom-auto desk:[body:has([data-slot=drawer-content])_&]:top-[calc(var(--sheet-inset)+3.5rem)]">
          <Toasts />
        </Toast.Viewport>
      </Toast.Portal>
    </>
  );
}

export const Route = createFileRoute("/_list")({
  component: TaskListView,
});
