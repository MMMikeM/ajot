import { useRef, useState } from "react";
import { CalendarDays, Trash2 } from "lucide-react";
import type { Task } from "~/lib/types";
import { useNotes, updateTask } from "~/lib/db/hooks";
import { useOptimisticUserId } from "~/lib/auth/current-user";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from "~/components/ui/drawer";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Textarea } from "~/components/ui/field";
import { MAX_TEXT, MAX_TITLE } from "@newtab-todo/shared/field-limits";
import { cn } from "~/lib/utils";
import { formatDueDateTime } from "~/lib/dates";
import { keepOpenOnToastPress } from "~/components/sheet-open-change";
import { dockedSheet } from "~/components/docked-sheet";
import { canDeleteTask, canEditTask } from "@newtab-todo/shared/task-access";
import { useCategoriesById } from "~/lib/hooks/use-categories-by-id";
import { holders, ownerNameOf } from "~/lib/task-holders";
import { isReadyToTick } from "~/lib/ready-to-tick";
import { useTasks } from "~/lib/db/hooks";
import { useTaskActions } from "~/components/task/use-actions";
import { AddRow, DetailRow, lineButton } from "~/components/task/detail-row";
import { Notes, Subtasks } from "~/components/task/detail-items";
import {
  AssigneeField,
  ListChip,
  ParentCrumb,
  SharingField,
  SubtaskSharing,
  useListFiling,
  useSharing,
} from "~/components/task/detail-people";

const TITLE_SLOT = "task-title";

// Fallback for engines without `field-sizing: content`
const autoGrow = (el: HTMLTextAreaElement | null) => {
  if (!el || CSS.supports("field-sizing", "content")) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
};

// Underlined only while editing, so the title and details read as text, not a form
const quietField = "border-transparent focus-visible:border-hint";

function TaskDetail({
  taskId,
  open,
  onClose,
  onOpenTask,
}: {
  taskId: string | null;
  open: boolean;
  onClose: () => void;
  onOpenTask: (taskId: string) => void;
}) {
  const { data: allTasks, isLoading: tasksLoading } = useTasks();

  if (!taskId || !open) return null;

  const task = allTasks?.find((t) => t.id === taskId);

  if (tasksLoading || !task) return null;

  return (
    <Drawer
      open={open}
      onOpenChange={keepOpenOnToastPress((next) => {
        if (!next) onClose();
      })}
    >
      {/* On touch its top leaves room for the toast viewport, which moves above an open sheet */}
      <DrawerContent
        className={cn("max-h-[calc(100dvh-env(safe-area-inset-top,0px)-4.5rem)]", dockedSheet)}
      >
        <DrawerHeader className="sr-only">
          <DrawerTitle>{task.title}</DrawerTitle>
          <DrawerDescription>Task details</DrawerDescription>
        </DrawerHeader>
        {/* Keyed: the parent's crumb swaps the task under a sheet that stays open, and the drafts
            of the one it came from must not save onto the next */}
        <TaskDetailContent
          key={task.id}
          task={task}
          parent={allTasks?.find((t) => t.id === task.parentId)}
          // From the live collection, not task.subtasks: that embedded copy only refreshes
          // on a server refetch, so ticking or deleting a subtask here looked like a no-op
          subtasks={(allTasks ?? []).filter((t) => t.parentId === task.id)}
          onClose={onClose}
          onOpenTask={onOpenTask}
        />
      </DrawerContent>
    </Drawer>
  );
}

const TaskDetailContent = ({
  task,
  parent,
  subtasks,
  onClose,
  onOpenTask,
}: {
  task: Task;
  parent?: Task;
  subtasks: Task[];
  onClose: () => void;
  onOpenTask: (taskId: string) => void;
}) => {
  const userId = useOptimisticUserId();
  const { handleToggle, handleDelete } = useTaskActions();
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const isDone = task.status === "done";
  const isTopLevel = !task.parentId;
  const dateRef = useRef<HTMLInputElement>(null);

  // Sync local state when task changes externally (but not mid-edit)
  if (title !== task.title && document.activeElement?.getAttribute("data-slot") !== TITLE_SLOT) {
    setTitle(task.title);
  }

  const { data: allNotes = [] } = useNotes();
  const notes = allNotes.filter((n) => n.taskId === task.id);
  const filing = useListFiling(task);
  const lists = useCategoriesById();
  const sharing = useSharing(task, lists, parent);
  const ownerName = ownerNameOf(task, lists);
  const held = holders(task, lists, parent);
  const canEdit = canEditTask(held, userId);

  return (
    <div className="relative mx-auto flex w-full max-w-2xl flex-col gap-3 px-6 pt-1 pb-[max(1rem,env(safe-area-inset-bottom))] touch:gap-2 touch:px-5">
      <div className="flex flex-col">
        <div className="flex items-center gap-3">
          {isTopLevel ? (
            <ListChip filing={filing} />
          ) : (
            <ParentCrumb parent={parent} onOpen={onOpenTask} />
          )}
          {canDeleteTask(held, userId) && (
            <Button
              variant="subtle"
              intent="destructive"
              size="default"
              icon
              bleed="end"
              aria-label={isTopLevel ? "Delete task" : "Delete subtask"}
              title={isTopLevel ? "Delete task" : "Delete subtask"}
              onClick={() => {
                handleDelete(task);
                onClose();
              }}
              className="ml-auto"
            >
              <Trash2 className="touch:size-4.5" />
            </Button>
          )}
        </div>

        {/* A textarea so long titles wrap; Enter commits like a single-line field */}
        <div className="flex items-start gap-3">
          <Checkbox
            checked={isDone}
            onCheckedChange={() => handleToggle(task)}
            aria-label="Mark done"
            className={cn(
              "mt-3 touch:mt-2.75 touch:size-4.5 touch:after:-inset-y-3.5 touch:after:-right-3 touch:after:-left-4",
              isReadyToTick(task, subtasks) && "border-primary",
            )}
          />
          {/* Bare control + aria-label: a raw <textarea> doesn't register with Base UI's
              Field, so a FieldLabel wouldn't be associated with it */}
          <div className="flex min-w-0 flex-1 flex-col">
            <Textarea
              ref={autoGrow}
              data-slot={TITLE_SLOT}
              aria-label="Title"
              readOnly={!canEdit}
              rows={1}
              maxLength={MAX_TITLE}
              enterKeyHint="done"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value.replace(/\n/g, " "));
                autoGrow(e.target);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  e.currentTarget.blur();
                }
              }}
              onBlur={() => {
                const trimmed = title.trim();
                if (trimmed && trimmed !== task.title) updateTask(task.id, { title: trimmed });
              }}
              className={cn(
                "py-2 text-lg leading-snug font-semibold md:text-lg",
                quietField,
                isDone && "text-muted-foreground line-through",
              )}
            />
            {!sharing.isOwner && ownerName && (
              <p className="text-sm text-hint">
                <span dir="auto">{ownerName}</span>’s task
              </p>
            )}
            {sharing.isOwner && task.sentBy && (
              <p className="text-sm text-hint">
                Sent by <span dir="auto">{task.sentBy.name}</span>
              </p>
            )}
          </div>
        </div>

        {(canEdit || !!task.description) && (
          <DetailRow>
            <Textarea
              ref={autoGrow}
              aria-label="Details"
              value={description}
              maxLength={MAX_TEXT}
              readOnly={!canEdit}
              onChange={(e) => {
                setDescription(e.target.value);
                autoGrow(e.target);
              }}
              onBlur={() => {
                const val = description.trim() || null;
                if (val !== (task.description ?? null)) updateTask(task.id, { description: val });
              }}
              placeholder="Add details"
              rows={1}
              className={cn("py-1.5 text-muted-foreground", quietField)}
            />
          </DetailRow>
        )}

        {/* Hidden native picker: the browser supplies the date UI. Absolute, so it takes no
            gap in the column; the picker opens where it sits, by the date line. */}
        <input
          ref={dateRef}
          type="datetime-local"
          step="1800"
          value={task.dueDate ?? ""}
          tabIndex={-1}
          aria-hidden
          onChange={(e) => updateTask(task.id, { dueDate: e.target.value || null })}
          className="invisible absolute size-0"
        />

        <div className="flex flex-col empty:hidden">
          {task.dueDate ? (
            <DueDateRow
              dueDate={task.dueDate}
              canEdit={canEdit}
              onPick={() => dateRef.current?.showPicker()}
              onClear={() => updateTask(task.id, { dueDate: null })}
            />
          ) : (
            canEdit && (
              <AddRow icon={<CalendarDays />} onClick={() => dateRef.current?.showPicker()}>
                Add a date
              </AddRow>
            )
          )}
          {isTopLevel ? (
            <SharingField task={task} sharing={sharing} />
          ) : (
            parent && <SubtaskSharing parent={parent} sharing={sharing} lists={lists} />
          )}
          <AssigneeField task={task} sharing={sharing} />
        </div>
      </div>

      {isTopLevel && (
        <Subtasks task={task} subtasks={subtasks} canAdd={canEdit} onToggle={handleToggle} />
      )}

      <Notes taskId={task.id} notes={notes} />
    </div>
  );
};

const DueDateRow = ({
  dueDate,
  canEdit,
  onPick,
  onClear,
}: {
  dueDate: string;
  canEdit: boolean;
  onPick: () => void;
  onClear: () => void;
}) => {
  const label = formatDueDateTime(dueDate);
  return (
    <DetailRow icon={<CalendarDays />} content={canEdit ? "stack" : "line"}>
      {canEdit ? (
        <div className="flex items-center">
          <button
            type="button"
            onClick={onPick}
            aria-label={`Due date: ${label}`}
            className={cn(lineButton, "h-9 flex-1 text-date touch:h-11")}
          >
            {label}
          </button>
          <Button variant="subtle" size="sm" bleed="end" onClick={onClear}>
            Clear
          </Button>
        </div>
      ) : (
        <span className="text-date">{label}</span>
      )}
    </DetailRow>
  );
};

export default TaskDetail;
