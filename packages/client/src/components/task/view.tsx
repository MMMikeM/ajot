import { useEffect, useRef, useState, type ReactNode, type RefCallback } from "react";
import { ChevronRight } from "lucide-react";
import { DragDropProvider } from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";
import { useTasks, useCategories } from "~/lib/db/hooks";
import { useActiveCategoryId } from "~/lib/state/active-category";
import { useOptimisticUserId } from "~/lib/auth/current-user";
import { useCollaboratedCategoryIds } from "~/lib/hooks/use-collaborated-categories";
import { getEffectiveCategoryId } from "~/lib/effective-category";
import { CategoryNav } from "~/components/category-nav";
import { Button } from "~/components/ui/button";
import { TaskItem } from "./item";
import { TaskRowsSkeleton } from "./rows-skeleton";
import { finishStartup } from "~/lib/startup-timing";
import { useTaskActions } from "./use-actions";
import { handOffRowFocus } from "./focus-handoff";
import { useTaskActions as useDndActions } from "~/lib/hooks/use-task-actions";
import type { Task } from "~/lib/types";

const DoneSection = ({ count, children }: { count: number; children: React.ReactNode }) => {
  const [open, setOpen] = useState(false);

  if (count === 0) return null;

  return (
    <div className="mt-1 border-t border-border pt-2">
      <Button
        variant="ghost"
        size="xs"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="-ml-2.5 font-medium tracking-wide text-muted-foreground uppercase hover:text-foreground aria-expanded:bg-transparent touch:h-11"
      >
        <ChevronRight
          size={14}
          className="transition-transform"
          style={{ transform: open ? "rotate(90deg)" : "none" }}
        />
        Done ({count})
      </Button>
      {open && children}
    </div>
  );
};

const getEmptyPhrase = () => {
  const hour = Temporal.Now.plainDateTimeISO().hour;
  if (hour >= 5 && hour < 12) return "Morning.";
  if (hour >= 12 && hour < 17) return "All clear.";
  if (hour >= 17 && hour < 22) return "Evening.";
  return "All quiet.";
};

const EmptySection = ({ activeTasks, doneTasks }: { activeTasks: Task[]; doneTasks: Task[] }) => {
  if (activeTasks.length !== 0) return null;

  if (doneTasks.length === 0)
    return (
      <div className="flex flex-1 flex-col items-center justify-center pb-8 touch:pb-0">
        <p className="font-display text-2xl text-muted-foreground">{getEmptyPhrase()}</p>
        <p className="mt-1 text-sm text-hint">
          type something <span className="touch:hidden">above</span>
          <span className="hidden touch:inline">below</span> to begin
        </p>
      </div>
    );

  return (
    <p className="text-sm text-hint">All done.</p>
  );
};

function SortableTask({
  id,
  index,
  children,
}: {
  id: string;
  index: number;
  children: (ref: RefCallback<HTMLElement>, handleRef: RefCallback<HTMLElement>) => ReactNode;
}) {
  const { ref, handleRef } = useSortable({ id, index, type: "task" });
  return <>{children(ref, handleRef)}</>;
}

export function TaskView({ onSelectTask }: { onSelectTask: (taskId: string) => void }) {
  const { data: allTasks, isLoading: tasksLoading } = useTasks();
  const { data: rawCategories, isLoading: categoriesLoading } = useCategories();
  const activeCategoryId = useActiveCategoryId();
  // Optimistic id falls back to the device id, so signed-out tasks (stamped with
  // that id by addTask) still count as owned and show up in the list.
  const userId = useOptimisticUserId();
  const actions = useTaskActions();
  const activeListRef = useRef<HTMLUListElement>(null);
  const withFocusHandoff = (action: (task: Task) => void) => (task: Task) => {
    handOffRowFocus(activeListRef.current, task.id);
    action(task);
  };

  const categories = rawCategories
    ? [...rawCategories].sort((a, b) => (a.sortOrder ?? "").localeCompare(b.sortOrder ?? ""))
    : [];

  const collaboratedCategoryIds = useCollaboratedCategoryIds(userId);

  // Computed before loading guard so useDndActions always receives stable values
  const categoryTasks = (allTasks ?? []).filter(
    (t) =>
      !t.parentId &&
      getEffectiveCategoryId(t, userId, collaboratedCategoryIds) === activeCategoryId,
  );

  const activeTasks = categoryTasks
    .filter((t) => t.status !== "done")
    .sort((a, b) => (a.sortOrder ?? "").localeCompare(b.sortOrder ?? ""));

  const { handleDragEnd } = useDndActions({ categories, activeCategoryId, activeTasks });

  const sharedCategoryIds = new Set(
    categories.filter((c) => c.collaborators && c.collaborators.length > 0).map((c) => c.id),
  );

  // A persisted collection only reports ready once the server has answered, but the rows saved
  // on this device are there before that. Show them; the skeleton is for having nothing yet.
  const isLoading =
    tasksLoading || categoriesLoading || allTasks === undefined || rawCategories === undefined;
  const hasRows = !!allTasks?.length;
  useEffect(() => {
    if (hasRows) finishStartup("tasks-shown");
    else if (!isLoading) finishStartup("list-ready");
  }, [hasRows, isLoading]);
  if (isLoading && !hasRows) return <TaskRowsSkeleton />;

  const doneTasks = categoryTasks.filter((t) => t.status === "done");

  return (
    <DragDropProvider onDragEnd={handleDragEnd}>
      <div className="flex flex-1 flex-col gap-4">
        <ul ref={activeListRef} className="flex flex-col gap-1">
          {activeTasks.map((task, index) => (
            <SortableTask key={task.id} id={task.id} index={index}>
              {(ref, handleRef) => (
                <li ref={ref}>
                  <TaskItem
                    task={task}
                    dragHandleRef={handleRef}
                    subtasks={actions.getSubtasks(task.id)}
                    onOpen={onSelectTask}
                    onToggle={withFocusHandoff(actions.handleToggle)}
                    onDelete={withFocusHandoff(actions.handleDelete)}
                    onSetDueDate={actions.handleSetDueDate}
                    onAddSubtask={actions.handleAddSubtask}
                    isInSharedCategory={!!task.categoryId && sharedCategoryIds.has(task.categoryId)}
                    swipeHint={index === 0}
                  />
                </li>
              )}
            </SortableTask>
          ))}
        </ul>

        <EmptySection activeTasks={activeTasks} doneTasks={doneTasks} />

        <DoneSection count={doneTasks.length}>
          <ul className="mt-2 flex flex-col">
            {doneTasks.map((task) => (
              <li key={task.id}>
                <TaskItem
                  task={task}
                  subtasks={actions.getSubtasks(task.id)}
                  onOpen={onSelectTask}
                  onToggle={actions.handleToggle}
                  onDelete={actions.handleDelete}
                  onSetDueDate={actions.handleSetDueDate}
                  onAddSubtask={actions.handleAddSubtask}
                  isInSharedCategory={!!task.categoryId && sharedCategoryIds.has(task.categoryId)}
                />
              </li>
            ))}
          </ul>
        </DoneSection>
      </div>
      {/* After the list so keyboard focus reaches the tasks first */}
      <CategoryNav />
    </DragDropProvider>
  );
}
