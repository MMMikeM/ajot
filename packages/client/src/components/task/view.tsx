import {
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type RefObject,
} from "react";
import { ChevronRight } from "lucide-react";
import { DragDropProvider } from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";
import { useTasks, useCategories } from "~/lib/db/hooks";
import { useActiveCategoryId } from "~/lib/state/active-category";
import { useOptimisticUserId } from "~/lib/auth/current-user";
import { getEffectiveCategoryId } from "~/lib/effective-category";
import { categoriesById, holders } from "~/lib/task-holders";
import { CategoryNav } from "~/components/category-nav";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { TaskItem, sameRowProps } from "./item";
import { FlipList } from "./flip-list";
import { TaskRowsSkeleton } from "./rows-skeleton";
import { finishStartup } from "~/lib/startup-timing";
import { useTaskActions } from "./use-actions";
import { handOffRowFocus } from "./focus-handoff";
import {
  createRowFocus,
  listenForRowKeys,
  RowFocusContext,
  rowIdsOf,
  type RowFocus,
} from "./row-focus";
import { rowDragSensors } from "./row-drag";
import { useTaskActions as useDndActions } from "~/lib/hooks/use-task-actions";
import { canDeleteTask } from "@newtab-todo/shared/task-access";
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

/**
 * A task moving from the list into Done, here or on another device. Ticking a row removes it from
 * the list, and on a phone Done is usually closed, so the count drops in to show where it went;
 * ticking the last one settles "All done." in. Loading, switching lists, Clear and its Undo don't
 * move one across, so they show either at once.
 */
const useLandingInDone = (doneCount: number, activeCount: number, listId: string | null) => {
  const [seen, setSeen] = useState({ doneCount, activeCount, listId });
  const [landings, setLandings] = useState(0);
  const [landing, setLanding] = useState(false);
  if (doneCount !== seen.doneCount || activeCount !== seen.activeCount || listId !== seen.listId) {
    const landed =
      listId === seen.listId && doneCount > seen.doneCount && activeCount < seen.activeCount;
    setSeen({ doneCount, activeCount, listId });
    setLanding(landed);
    if (landed) setLandings(landings + 1);
  }
  return { landings, landing, onLanded: () => setLanding(false) };
};

type Landing = ReturnType<typeof useLandingInDone>;

const DoneSection = ({
  count,
  countLanding,
  onClear,
  clearsAll,
  children,
}: {
  count: number;
  countLanding: Landing;
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
    <div data-flip-key="done" className="mt-1 border-t border-border pt-2">
      <div className="flex items-center justify-between">
        <Button
          ref={toggleRef}
          variant="ghost"
          size="xs"
          onClick={toggle}
          aria-expanded={open}
          // The count's inline-block would read as "Done ( 3 )"
          aria-label={`Done (${count})`}
          bleed="start"
          className="font-medium tracking-wider text-muted-foreground uppercase hover:text-foreground aria-expanded:bg-transparent"
        >
          <ChevronRight
            size={14}
            className="transition-transform"
            style={{ transform: open ? "rotate(90deg)" : "none" }}
          />
          <span>
            Done (
            <span
              key={countLanding.landings}
              onAnimationEnd={countLanding.onLanded}
              className={cn(
                "inline-block tabular-nums",
                countLanding.landing && "animate-done-count-land motion-reduce:animate-none",
              )}
            >
              {count}
            </span>
            )
          </span>
        </Button>
        {open && onClear && (
          <Button
            variant="subtle"
            size="xs"
            onClick={clear}
            aria-label="Clear done tasks"
            bleed="end"
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

const settleIn =
  "animate-[cleared-settle_700ms_cubic-bezier(0.16,1,0.3,1)_both] motion-reduce:animate-none";
const settleInAfter =
  "animate-[cleared-settle_700ms_cubic-bezier(0.16,1,0.3,1)_150ms_both] motion-reduce:animate-none";

const EmptySection = ({
  activeTasks,
  doneTasks,
  clearedAt,
  justFinished,
}: {
  activeTasks: Task[];
  doneTasks: Task[];
  /** When this list's done tasks were last cleared, if they were */
  clearedAt?: number;
  /** The last open task has just moved into Done */
  justFinished: boolean;
}) => {
  if (activeTasks.length !== 0) return null;
  if (doneTasks.length === 0) return <EmptyState clearedAt={clearedAt} />;
  return <ClearedState justFinished={justFinished} />;
};

// Clearing an all-done list hands "All done." over to the resting phrase, so that settles in too
const EmptyState = ({ clearedAt }: { clearedAt?: number }) => {
  const [settling] = useState(
    () => clearedAt !== undefined && Date.now() - clearedAt < CLEARED_WINDOW_MS,
  );

  return (
    <div
      data-flip-key="empty"
      className="flex flex-1 flex-col items-center justify-center pb-8 touch:pb-0"
    >
      <p className={cn("font-display text-2xl text-muted-foreground", settling && settleIn)}>
        {getEmptyPhrase()}
      </p>
      <p className={cn("mt-1 text-sm text-hint", settling && settleInAfter)}>
        type something <span className="touch:hidden">above</span>
        <span className="hidden touch:inline">below</span> to begin
      </p>
    </div>
  );
};

const getClearedLine = () => {
  const hour = Temporal.Now.plainDateTimeISO().hour;
  if (hour >= 5 && hour < 12) return "A clear start to the day.";
  if (hour >= 12 && hour < 17) return "The rest of the afternoon is yours.";
  if (hour >= 17 && hour < 22) return "Nothing left for tonight.";
  return "Rest well.";
};

const CLEARED_WINDOW_MS = 3000;

const ClearedState = ({ justFinished }: { justFinished: boolean }) => {
  const [settling] = useState(justFinished);

  return (
    <div
      data-flip-key="empty"
      className="flex flex-col items-center py-6 touch:flex-1 touch:justify-center touch:py-0"
    >
      <p className={cn("font-display text-2xl text-muted-foreground", settling && settleIn)}>
        All done.
      </p>
      <p className={cn("mt-1 text-sm text-hint", settling && settleInAfter)}>{getClearedLine()}</p>
    </div>
  );
};

const stampClear = (listId: string | null) => ({ listId, at: Date.now() });

const SortableTask = memo(function SortableTask({
  index,
  ...props
}: { index: number } & ComponentProps<typeof TaskItem>) {
  const { ref, handleRef } = useSortable({
    id: props.task.id,
    index,
    type: "task",
    accept: "task",
    sensors: rowDragSensors,
  });
  return (
    <li ref={ref} data-flip-key={props.task.id}>
      <TaskItem {...props} dragHandleRef={handleRef} />
    </li>
  );
}, sameRowProps);

const RowList = ({
  rowFocus,
  listRef,
  ...props
}: { rowFocus: RowFocus; listRef: RefObject<HTMLUListElement | null> } & ComponentProps<"ul">) => {
  useEffect(() => listenForRowKeys(listRef.current!, rowFocus), [listRef, rowFocus]);
  return (
    <RowFocusContext value={rowFocus}>
      <ul ref={listRef} {...props} />
    </RowFocusContext>
  );
};

const NO_SUBTASKS: Task[] = [];

const bySortOrder = (a: Task, b: Task) => (a.sortOrder ?? "").localeCompare(b.sortOrder ?? "");

const groupSubtasks = (tasks: Task[]) => {
  const groups = new Map<string, Task[]>();
  for (const task of tasks) {
    if (!task.parentId) continue;
    const group = groups.get(task.parentId);
    if (group) group.push(task);
    else groups.set(task.parentId, [task]);
  }
  for (const group of groups.values()) group.sort(bySortOrder);
  return groups;
};

export function TaskView({ onSelectTask }: { onSelectTask: (taskId: string) => void }) {
  const { data: allTasks, isLoading: tasksLoading } = useTasks();
  const { data: rawCategories, isLoading: categoriesLoading } = useCategories();
  const activeCategoryId = useActiveCategoryId();
  // Optimistic id falls back to the device id, so signed-out tasks (stamped with
  // that id by addTask) still count as owned and show up in the list.
  const userId = useOptimisticUserId();
  const actions = useTaskActions();
  const [lastClear, setLastClear] = useState<{ listId: string | null; at: number }>();
  const activeListRef = useRef<HTMLUListElement>(null);
  const columnRef = useRef<HTMLDivElement>(null);
  const doneListRef = useRef<HTMLUListElement>(null);
  // Not built by a shared wrapper: the compiler won't cache a call's result that reads a ref, and a
  // new handler each render would render every row again
  const toggleActive = (task: Task) => {
    handOffRowFocus(activeListRef.current, task.id);
    actions.handleToggle(task);
  };
  const deleteActive = (task: Task) => {
    handOffRowFocus(activeListRef.current, task.id);
    actions.handleDelete(task);
  };

  const categories = rawCategories
    ? [...rawCategories].sort((a, b) => (a.sortOrder ?? "").localeCompare(b.sortOrder ?? ""))
    : [];

  const lists = categoriesById(rawCategories ?? []);

  // Computed before loading guard so useDndActions always receives stable values
  const categoryTasks = (allTasks ?? []).filter(
    (t) => !t.parentId && getEffectiveCategoryId(t, userId, lists) === activeCategoryId,
  );

  const activeTasks = categoryTasks.filter((t) => t.status !== "done").sort(bySortOrder);
  const landing = useLandingInDone(
    categoryTasks.length - activeTasks.length,
    activeTasks.length,
    activeCategoryId,
  );
  const subtasksByParent = groupSubtasks(allTasks ?? []);
  const doneTasks = categoryTasks.filter((t) => t.status === "done");

  const [activeRowFocus] = useState(createRowFocus);
  const [doneRowFocus] = useState(createRowFocus);
  const activeRowIds = rowIdsOf(activeTasks, subtasksByParent);
  const doneRowIds = rowIdsOf(doneTasks, subtasksByParent);
  useLayoutEffect(() => {
    activeRowFocus.setRows(activeRowIds);
    doneRowFocus.setRows(doneRowIds);
  });

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

  // Deleting a task deletes its subtasks, so one still holding open work stays
  const clearableDoneTasks = doneTasks.filter(
    (t) =>
      canDeleteTask(holders(t, lists), userId) &&
      (subtasksByParent.get(t.id) ?? NO_SUBTASKS).every((sub) => sub.status === "done"),
  );

  return (
    <DragDropProvider onDragEnd={handleDragEnd}>
      <FlipList list={columnRef} resetKey={activeCategoryId}>
        <div ref={columnRef} className="flex flex-1 flex-col gap-4">
          <FlipList list={activeListRef} resetKey={activeCategoryId} arrivals>
            <RowList
              rowFocus={activeRowFocus}
              listRef={activeListRef}
              data-flip-key="active"
              className="flex flex-col gap-1"
            >
              {activeTasks.map((task, index) => (
                <SortableTask
                  key={task.id}
                  index={index}
                  task={task}
                  subtasks={subtasksByParent.get(task.id) ?? NO_SUBTASKS}
                  lists={lists}
                  onOpen={onSelectTask}
                  onToggle={toggleActive}
                  onDelete={deleteActive}
                  onSetDueDate={actions.handleSetDueDate}
                  onAddSubtask={actions.handleAddSubtask}
                  isInSharedCategory={!!task.categoryId && sharedCategoryIds.has(task.categoryId)}
                  swipeHint={index === 0}
                />
              ))}
            </RowList>
          </FlipList>

          <EmptySection
            activeTasks={activeTasks}
            doneTasks={doneTasks}
            clearedAt={lastClear?.listId === activeCategoryId ? lastClear.at : undefined}
            justFinished={landing.landing}
          />

          <DoneSection
            count={doneTasks.length}
            countLanding={landing}
            onClear={
              clearableDoneTasks.length > 0
                ? () => {
                    setLastClear(stampClear(activeCategoryId));
                    actions.handleClearDone(clearableDoneTasks);
                  }
                : undefined
            }
            clearsAll={clearableDoneTasks.length === doneTasks.length}
          >
            <FlipList list={doneListRef} arrivals>
              <RowList rowFocus={doneRowFocus} listRef={doneListRef} className="mt-2 flex flex-col">
                {doneTasks.map((task) => (
                  <li key={task.id} data-flip-key={task.id}>
                    <TaskItem
                      task={task}
                      subtasks={subtasksByParent.get(task.id) ?? NO_SUBTASKS}
                      lists={lists}
                      onOpen={onSelectTask}
                      onToggle={actions.handleToggle}
                      onDelete={actions.handleDelete}
                      onSetDueDate={actions.handleSetDueDate}
                      onAddSubtask={actions.handleAddSubtask}
                      isInSharedCategory={
                        !!task.categoryId && sharedCategoryIds.has(task.categoryId)
                      }
                    />
                  </li>
                ))}
              </RowList>
            </FlipList>
          </DoneSection>
        </div>
      </FlipList>
      {/* After the list so keyboard focus reaches the tasks first */}
      <CategoryNav />
    </DragDropProvider>
  );
}
