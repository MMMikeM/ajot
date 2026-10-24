import { Skeleton } from "~/components/ui/skeleton";
import { TaskRowsSkeleton } from "./rows-skeleton";

/** Stands in for the task list until the app runs: same blocks and touch ordering as the index route. */
export function TaskListSkeleton() {
  return (
    <>
      {/* The title's line box: text-[1.75rem] leading-tight */}
      <div className="mb-3 box-content flex h-[2.1875rem] shrink-0 items-center gap-2.5 py-1">
        <Skeleton data-testid="skeleton-dot" className="mt-1 size-2 rounded-full" />
        <Skeleton data-testid="skeleton-title" className="h-7 w-28" />
        <output className="sr-only">Loading tasks</output>
      </div>
      <div className="touch:order-2 touch:-mx-(--gutter) touch:shrink-0 touch:border-t touch:border-ghost touch:px-(--gutter) touch:pt-2 touch:pb-[max(0.75rem,env(safe-area-inset-bottom,0px))]">
        <div className="hidden h-9 items-center gap-2 touch:flex">
          <Skeleton className="size-2 rounded-full" />
          <Skeleton className="h-4 w-16" />
        </div>
        {/* The input's box: py-2, a text-lg line, then the underline */}
        <div
          data-testid="skeleton-input"
          className="box-content flex h-7 items-center border-b border-ghost py-2"
        >
          <Skeleton className="h-5 w-40" />
        </div>
      </div>
      <div className="mt-2 touch:order-1 touch:flex-1">
        <TaskRowsSkeleton />
      </div>
    </>
  );
}
