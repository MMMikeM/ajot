import { useRef, useState, type RefObject } from "react";
import { flushSync } from "react-dom";
import {
  AlignLeft,
  CalendarDays,
  ListChecks,
  ListPlus,
  Plus,
  StickyNote,
  Trash2,
  UserPlus,
  UserRound,
  type LucideIcon,
} from "lucide-react";
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
import { cn } from "~/lib/utils";
import { keepOpenOnToastPress } from "~/components/sheet-open-change";
import { dockedSheet } from "~/components/docked-sheet";
import { canDeleteTask } from "@newtab-todo/shared/task-access";
import { useCategoriesById } from "~/lib/hooks/use-categories-by-id";
import { holders } from "~/lib/task-holders";
import { isReadyToTick } from "~/lib/ready-to-tick";
import { useTasks } from "~/lib/db/hooks";
import { useTaskActions } from "~/components/task/use-actions";
import { DetailRow, type DetailPiece } from "~/components/task/detail-row";
import { Notes, Subtasks } from "~/components/task/detail-items";
import {
  AssigneeField,
  ListField,
  SharingField,
  useListFiling,
  useSharing,
} from "~/components/task/detail-people";

const TITLE_SLOT = "task-title";

// Device locale; time and year only when they carry information
const formatDueDateTime = (due: string) => {
  const dt = Temporal.PlainDateTime.from(due);
  const sameYear = dt.year === Temporal.Now.plainDateISO().year;
  return dt.toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(!sameYear && { year: "numeric" }),
    ...(due.length > 10 && { hour: "numeric", minute: "2-digit" }),
  });
};

// Fallback for engines without `field-sizing: content`
const autoGrow = (el: HTMLTextAreaElement | null) => {
  if (!el || CSS.supports("field-sizing", "content")) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
};

// Underlined only while editing, so the title and description read as text, not a form
const quietField = "border-transparent focus-visible:border-hint";

function TaskDetail({
  taskId,
  open,
  onClose,
}: {
  taskId: string | null;
  open: boolean;
  onClose: () => void;
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
        <TaskDetailContent
          task={task}
          parent={allTasks?.find((t) => t.id === task.parentId)}
          // From the live collection, not task.subtasks: that embedded copy only refreshes
          // on a server refetch, so ticking or deleting a subtask here looked like a no-op
          subtasks={(allTasks ?? []).filter((t) => t.parentId === task.id)}
          onClose={onClose}
        />
      </DrawerContent>
    </Drawer>
  );
}

type Offer = { key: DetailPiece | "date"; label: string; icon: LucideIcon };

const TaskDetailContent = ({
  task,
  parent,
  subtasks,
  onClose,
}: {
  task: Task;
  parent?: Task;
  subtasks: Task[];
  onClose: () => void;
}) => {
  const userId = useOptimisticUserId();
  const { handleToggle, handleDelete } = useTaskActions();
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [revealed, setRevealed] = useState<ReadonlySet<DetailPiece>>(new Set());
  const [offering, setOffering] = useState(false);
  // Rows shown when the sheet opened stay until it closes: unassigning would otherwise remove
  // the row under the pointer, as hiding an added field on blur did
  const [openedAssigned] = useState(() => !!task.assigneeId);
  const isDone = task.status === "done";
  const isTopLevel = !task.parentId;
  const dateRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const subtaskRef = useRef<HTMLInputElement>(null);
  const noteRef = useRef<HTMLInputElement>(null);
  const focusOnReveal: Partial<Record<DetailPiece, RefObject<HTMLElement | null>>> = {
    description: descriptionRef,
    subtask: subtaskRef,
    note: noteRef,
  };

  // Sync local state when task changes externally (but not mid-edit)
  if (title !== task.title && document.activeElement?.getAttribute("data-slot") !== TITLE_SLOT) {
    setTitle(task.title);
  }

  const { data: allNotes = [] } = useNotes();
  const notes = allNotes.filter((n) => n.taskId === task.id);
  const filing = useListFiling(task);
  const sharing = useSharing(task);
  const lists = useCategoriesById();

  // Synchronous, so the field is focused inside the tap and a phone raises its keyboard.
  // A revealed field stays until the sheet closes: hiding it on blur shifted the sheet
  // under the pointer, so the press that blurred it landed on something else.
  const reveal = (piece: DetailPiece) => {
    flushSync(() => {
      setRevealed((current) => new Set(current).add(piece));
      setOffering(false);
    });
    focusOnReveal[piece]?.current?.focus();
  };

  // From the saved value too: clearing the draft must not unmount the field mid-edit, before
  // its blur saves the empty description
  const showDescription = !!task.description || description !== "" || revealed.has("description");
  const canAssign = sharing.isOwner && isTopLevel && !task.assigneeId && sharing.others.length > 0;

  const offers = [
    !task.dueDate && { key: "date", label: "Date", icon: CalendarDays },
    !showDescription && { key: "description", label: "Description", icon: AlignLeft },
    isTopLevel && { key: "subtask", label: "Subtask", icon: ListChecks },
    { key: "note", label: "Note", icon: StickyNote },
    // Subtasks follow their parent's list
    isTopLevel &&
      !filing.category &&
      filing.choices.length > 0 &&
      !revealed.has("list") && { key: "list", label: "List", icon: ListPlus },
    sharing.isOwner &&
      isTopLevel &&
      !sharing.sharedList &&
      (!sharing.hasContacts || sharing.addableContacts.length > 0) &&
      !revealed.has("share") && { key: "share", label: "Share", icon: UserPlus },
    canAssign &&
      !revealed.has("assignee") && { key: "assignee", label: "Assignee", icon: UserRound },
  ].filter((offer): offer is Offer => !!offer);

  const choose = (key: Offer["key"]) => {
    if (key !== "date") return reveal(key);
    setOffering(false);
    dateRef.current?.showPicker();
  };

  return (
    <div className="relative mx-auto flex w-full max-w-2xl flex-col gap-5 px-6 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] touch:px-5">
      {/* A textarea so long titles wrap; Enter commits like a single-line field */}
      <div className="flex items-start gap-3">
        <Checkbox
          checked={isDone}
          onCheckedChange={() => handleToggle(task)}
          aria-label="Mark done"
          className={cn(
            "mt-3 touch:mt-2.75 touch:size-4.5 touch:after:-inset-3.5",
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
            rows={1}
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
          {!sharing.isOwner && task.user && (
            <p className="text-sm text-hint">
              <span dir="auto">{task.user.name}</span>’s task
            </p>
          )}
        </div>
      </div>

      {showDescription && (
        <DetailRow className="-mt-3">
          <Textarea
            ref={(el) => {
              descriptionRef.current = el;
              autoGrow(el);
            }}
            aria-label="Description"
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              autoGrow(e.target);
            }}
            onBlur={() => {
              const val = description.trim() || null;
              if (val !== (task.description ?? null)) updateTask(task.id, { description: val });
            }}
            placeholder="Description"
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
        {task.dueDate && (
          <DueDateRow
            dueDate={task.dueDate}
            onPick={() => dateRef.current?.showPicker()}
            onClear={() => updateTask(task.id, { dueDate: null })}
          />
        )}
        {isTopLevel && <ListField filing={filing} choosing={revealed.has("list")} />}
        {isTopLevel && (
          <SharingField task={task} sharing={sharing} adding={revealed.has("share")} />
        )}
        <AssigneeField
          task={task}
          sharing={sharing}
          choosing={revealed.has("assignee") || openedAssigned}
        />
      </div>

      {isTopLevel && (
        <Subtasks
          task={task}
          subtasks={subtasks}
          adding={revealed.has("subtask")}
          inputRef={subtaskRef}
          onToggle={handleToggle}
        />
      )}

      <Notes taskId={task.id} notes={notes} adding={revealed.has("note")} inputRef={noteRef} />

      <div className="flex flex-col gap-1">
        {offering && (
          <fieldset
            aria-label="Add to task"
            className="-ml-3 flex min-w-0 flex-wrap gap-x-1 touch:-ml-3.5"
          >
            {offers.map(({ key, label, icon: Icon }) => (
              <Button key={key} variant="subtle" size="sm" onClick={() => choose(key)}>
                <Icon />
                {label}
              </Button>
            ))}
          </fieldset>
        )}
        <div className="flex items-center justify-between">
          <Button
            variant="subtle"
            size="sm"
            aria-expanded={offering}
            onClick={() => setOffering((o) => !o)}
            bleed="start"
          >
            <Plus className={cn("transition-transform", offering && "rotate-45")} />
            Add
          </Button>
          {canDeleteTask(holders(task, lists, parent), userId) && (
            <Button
              variant="subtle"
              intent="destructive"
              size="sm"
              aria-label="Delete task"
              bleed="end"
              onClick={() => {
                handleDelete(task);
                onClose();
              }}
            >
              <Trash2 />
              Delete
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

const DueDateRow = ({
  dueDate,
  onPick,
  onClear,
}: {
  dueDate: string;
  onPick: () => void;
  onClear: () => void;
}) => {
  const label = formatDueDateTime(dueDate);
  return (
    <DetailRow icon={<CalendarDays />}>
      <div className="flex items-center">
        <button
          type="button"
          onClick={onPick}
          aria-label={`Due date: ${label}`}
          className="flex h-9 flex-1 cursor-pointer items-center rounded-md text-left text-sm text-date outline-none focus-visible:ring-3 focus-visible:ring-ring/50 touch:h-11 touch:text-base"
        >
          {label}
        </button>
        <Button variant="subtle" size="sm" bleed="end" onClick={onClear}>
          Clear
        </Button>
      </div>
    </DetailRow>
  );
};

export default TaskDetail;
