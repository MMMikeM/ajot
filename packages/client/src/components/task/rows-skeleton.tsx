import { Skeleton } from "~/components/ui/skeleton";
import { cn } from "~/lib/utils";

const TITLE_WIDTHS = ["w-3/5", "w-2/5", "w-1/2", "w-1/3"];

export function TaskRowsSkeleton() {
  return (
    <ul aria-hidden="true" className="flex flex-col gap-1">
      {TITLE_WIDTHS.map((width) => (
        <li key={width} className="-mx-2 flex items-center gap-2 px-2 py-2.5 touch:gap-2.5">
          {/* Touch rows lead with a drag handle; desktop hangs it in the gutter */}
          <span className="-ml-1 hidden w-6 shrink-0 touch:block" />
          <Skeleton className="size-4 rounded-[6px] touch:size-[18px]" />
          <Skeleton className={cn("h-4", width)} />
        </li>
      ))}
    </ul>
  );
}
