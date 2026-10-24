import { Skeleton } from "~/components/ui/skeleton";
import { TaskRowsSkeleton } from "./rows-skeleton";

/** Stands in for the task list until the app runs: same blocks and touch ordering as the index route. */
export function TaskListSkeleton() {
  return (
    <>
      <div className="mb-3 flex shrink-0 items-center gap-2.5 py-1">
        <Skeleton className="size-2 rounded-full" />
        <Skeleton className="h-7 w-28" />
        <output className="sr-only">Loading tasks</output>
      </div>
      <div className="touch:order-2 touch:-mx-(--gutter) touch:shrink-0 touch:border-t touch:border-ghost touch:px-(--gutter) touch:pt-2 touch:pb-[max(0.75rem,env(safe-area-inset-bottom,0px))]">
        <div className="hidden h-9 items-center touch:flex">
          <Skeleton className="h-4 w-20" />
        </div>
        <div className="flex h-11 items-center border-b border-ghost">
          <Skeleton className="h-5 w-40" />
        </div>
      </div>
      <div className="mt-2 touch:order-1 touch:flex-1">
        <TaskRowsSkeleton />
      </div>
    </>
  );
}
