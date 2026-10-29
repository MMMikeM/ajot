import { Suspense } from "react";
import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { TaskInputBar } from "~/components/task/input-bar";
import { SyncHint } from "~/components/SyncHint";
import { SetupHint } from "~/components/SetupHint";
import { TaskView } from "~/components/task/view";
import { CategoryHeader } from "~/components/category-nav/CategoryHeader";

function TaskListView() {
  const navigate = useNavigate();

  return (
    <>
      {/*
       * Touch: the input's order-2 sinks it to the bottom of the viewport, below this order-1
       * content; CategoryHeader keeps the default order, above it. Fragment children become
       * direct flex children of AppShell via <Outlet />.
       */}
      <CategoryHeader />
      <TaskInputBar />
      {/* Touch: widened past the rows, or overflow-x-hidden cuts off a swiped row's tray at the end
          and a checkbox's tap target at the start */}
      <div className="scroll-edge-fade touch:order-1 touch:-mr-2 touch:-ml-5 touch:flex touch:min-h-0 touch:flex-1 touch:flex-col touch:overflow-x-hidden touch:overflow-y-auto touch:pr-2 touch:pl-5">
        <Suspense fallback={null}>
          <SyncHint />
          <SetupHint />
        </Suspense>
        <div className="mt-2 flex flex-1 flex-col gap-4">
          <TaskView
            onSelectTask={(taskId) => navigate({ to: "/task/$taskId", params: { taskId } })}
          />
          <Outlet />
        </div>
      </div>
    </>
  );
}

export const Route = createFileRoute("/_list")({
  component: TaskListView,
});
