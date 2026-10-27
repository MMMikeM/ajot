import { ChevronDown } from "lucide-react";
import { useCategories, useTasks } from "~/lib/db/hooks";
import { useOptimisticUserId } from "~/lib/auth/current-user";
import { useActiveCategoryId } from "~/lib/state/active-category";
import { useNavContext } from "~/lib/state/nav-context";
import { categoriesById } from "~/lib/task-holders";
import { countOpenTasksByCategory } from "~/lib/effective-category";
import { INBOX_COLOR } from "~/lib/constants";
import { useIsDesk } from "~/lib/hooks/use-is-desk";
import { ColorDot } from "~/components/ui/color-dot";
import { cn } from "~/lib/utils";

/** Opens the category sheet where the sidebar doesn't fit (touch, narrow windows). */
export function CategoryHeader() {
  const activeCategoryId = useActiveCategoryId();
  const userId = useOptimisticUserId();
  const { data: categories } = useCategories();
  const { data: tasks } = useTasks();
  const { setNavOpen } = useNavContext();
  const isDesk = useIsDesk();

  const active = activeCategoryId
    ? (categories ?? []).find((c) => c.id === activeCategoryId)
    : undefined;
  const lists = categoriesById(categories ?? []);
  const openCount = countOpenTasksByCategory(tasks ?? [], userId, lists).get(activeCategoryId) ?? 0;

  // On touch nothing else shows the full name, so it wraps; the dot, chevron and count
  // sit on its first line, a 2.1875rem line box
  const title = (
    <>
      <ColorDot
        color={active ? (active.color ?? undefined) : INBOX_COLOR}
        // oxlint-disable-next-line better-tailwindcss/no-restricted-classes -- centred on the first line box
        className={isDesk ? "mt-1" : "mt-[0.96875rem]"}
      />
      <span
        dir="auto"
        className={cn(
          "font-display text-3xl text-foreground",
          isDesk ? "truncate" : "line-clamp-2 wrap-anywhere",
        )}
      >
        {active?.name ?? "Inbox"}
      </span>
    </>
  );

  return (
    <div
      className={cn(
        "mb-3 flex shrink-0 justify-between gap-4",
        isDesk ? "items-center" : "items-start",
      )}
    >
      <h2 className="flex min-w-0 flex-1">
        {isDesk ? (
          <span className="flex min-w-0 items-center gap-2.5 py-1">{title}</span>
        ) : (
          <button
            data-testid="category-nav-trigger"
            onClick={() => setNavOpen(true)}
            aria-haspopup="dialog"
            className="-ml-1.5 flex min-w-0 cursor-pointer items-start gap-2.5 rounded-lg px-1.5 py-1 text-left transition-opacity active:opacity-60"
          >
            {title}
            <ChevronDown
              size={18}
              // oxlint-disable-next-line better-tailwindcss/no-restricted-classes -- centred on the first line box
              className="mt-[0.71875rem] shrink-0 text-hint"
              aria-hidden="true"
            />
          </button>
        )}
      </h2>
      {openCount > 0 && (
        // oxlint-disable-next-line better-tailwindcss/no-restricted-classes -- centred on the first line box
        <span className={cn("text-sm text-hint tabular-nums", !isDesk && "mt-[0.71875rem]")}>
          {openCount}
          <span className="sr-only"> open</span>
        </span>
      )}
    </div>
  );
}
