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
import { cn } from "~/lib/utils";
import { TaskItem } from "./item";
import { TaskRowsSkeleton } from "./rows-skeleton";
import { finishStartup } from "~/lib/startup-timing";
import { useTaskActions } from "./use-actions";
import { handOffRowFocus } from "./focus-handoff";
import { rowDragSensors } from "./row-drag";
import { useTaskActions as useDndActions } from "~/lib/hooks/use-task-actions";
import { canDeleteTask } from "~/lib/task-permissions";
import type { Task } from "~/lib/types";

const DONE_OPEN_KEY = "newtab-todo-done-open";

// Storage can throw (blocked site data); the section then just starts closed
const readDoneOpen = () => {
  try {
    return localStorage.getItem(DONE_OPEN_KEY) === "1";
  } catch {
    return false;
  }
};

const writeDoneOpen = (open: boolean) => {
  try {
    localStorage.setItem(DONE_OPEN_KEY, open ? "1" : "0");
  } catch {
    /* not remembered this time */
  }
};

const DoneSection = ({
  count,
  onClear,
  clearsAll,
  children,
}: {
  count: number;
  /** Absent when none of the done tasks are yours to delete */
  onClear?: () => void;
  /** Clear empties the section, so it unmounts with the button */
  clearsAll: boolean;
  children: React.ReactNode;
}) => {
  const [open, setOpen] = useState(readDoneOpen);
  const toggleRef = useRef<HTMLButtonElement>(null);

  if (count === 0) return null;

  const toggle = () => {
    writeDoneOpen(!open);
    setOpen(!open);
  };

  // Clear removes itself, so keyboard focus would fall to <body>; as with ticking, pointer focus
  // stays put, since moving it to the capture input raises the on-screen keyboard
  const clear = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (e.currentTarget.matches(":focus-visible"))
      (clearsAll ? document.getElementById("add-task-input") : toggleRef.current)?.focus();
    onClear?.();
  };

  return (
    <div className="mt-1 border-t border-border pt-2">
      <div className="flex items-center justify-between">
        <Button
          ref={toggleRef}
          variant="ghost"
          size="xs"
          onClick={toggle}
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
        {open && onClear && (
          <Button
            variant="subtle"
            size="xs"
            onClick={clear}
            aria-label="Clear done tasks"
            className="-mr-2.5 touch:h-11 touch:px-3"
          >
            Clear
          </Button>
        )}
      </div>
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

  return <ClearedState doneTasks={doneTasks} />;
};

const getClearedLine = () => {
  const hour = Temporal.Now.plainDateTimeISO().hour;
  if (hour >= 5 && hour < 12) return "A clear start to the day.";
  if (hour >= 12 && hour < 17) return "The rest of the afternoon is yours.";
  if (hour >= 17 && hour < 22) return "Nothing left for tonight.";
  return "Rest well.";
};

// Settles in only when the last task was ticked moments ago, here or on another device. A list
// that was already clear (on load, or switching lists) shows it at once.
const CLEARED_WINDOW_MS = 3000;
const wasJustCleared = (doneTasks: Task[]) =>
  doneTasks.some((t) => Date.now() - Date.parse(t.updatedAt) < CLEARED_WINDOW_MS);

const ClearedState = ({ doneTasks }: { doneTasks: Task[] }) => {
  const [settling] = useState(() => wasJustCleared(doneTasks));

  return (
    <div className="flex flex-col items-center py-6 touch:flex-1 touch:justify-center touch:py-0">
      <p
        className={cn(
          "font-display text-2xl text-muted-foreground",
          settling &&
            "animate-[cleared-settle_700ms_cubic-bezier(0.16,1,0.3,1)_both] motion-reduce:animate-none",
        )}
      >
        All done.
      </p>
      <p
        className={cn(
          "mt-1 text-sm text-hint",
          settling &&
            "animate-[cleared-settle_700ms_cubic-bezier(0.16,1,0.3,1)_150ms_both] motion-reduce:animate-none",
        )}
      >
        {getClearedLine()}
      </p>
    </div>
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
  const { ref, handleRef } = useSortable({
    id,
    index,
    type: "task",
    accept: "task",
    sensors: rowDragSensors,
  });
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

  const { handleDragEnd } = useDndActions({
    categories,
    activeCategoryId,
    activeTasks,
    getSubtasks: actions.getSubtasks,
  });

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
  // Deleting a task deletes its subtasks, so one still holding open work stays
  const clearableDoneTasks = doneTasks.filter(
    (t) =>
      canDeleteTask(userId, t) && actions.getSubtasks(t.id).every((sub) => sub.status === "done"),
  );

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

        <DoneSection
          count={doneTasks.length}
          onClear={
            clearableDoneTasks.length > 0
              ? () => actions.handleClearDone(clearableDoneTasks)
              : undefined
          }
          clearsAll={clearableDoneTasks.length === doneTasks.length}
        >
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
