import {
  useRef,
  useState,
  type ChangeEvent,
  type ComponentProps,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import { Plus, StickyNote, Trash2 } from "lucide-react";
import { compareSortOrder } from "@newtab-todo/shared/sort-order";
import type { Task, Note } from "~/lib/types";
import { addNote, updateNote, deleteNote, deleteTask, updateTask } from "~/lib/db/hooks";
import { addTask } from "~/lib/db/add-task";
import { getCurrentUserId, useOptimisticUserId } from "~/lib/auth/current-user";
import { Checkbox, checkboxDoneClass } from "~/components/ui/checkbox";
import { Input, Textarea } from "~/components/ui/field";
import { MAX_TEXT, MAX_TITLE } from "@newtab-todo/shared/field-limits";
import { ListRow } from "~/components/ui/list-row";
import { RevealButton, RevealGroup } from "~/components/ui/reveal-button";
import { cn } from "~/lib/utils";
import { canDeleteTask, canEditTask } from "@newtab-todo/shared/task-access";
import { useCategoriesById } from "~/lib/hooks/use-categories-by-id";
import { holders } from "~/lib/task-holders";
import { SectionLabel } from "~/components/ui/section-label";
import { formatDay } from "~/lib/due-date";
import { AddRow, DetailRow } from "~/components/task/detail-row";
import { pushUndoToast, quoted } from "~/lib/undo-toast";

/**
 * "Add a subtask" and its kin: a quiet line that becomes its field when pressed, the plus staying
 * in the gutter so nothing moves. Once opened the field stays until the sheet closes: hiding it on
 * blur shifted the sheet under the pointer, so the press that blurred it landed on something else.
 */
const AddLine = ({
  label,
  placeholder,
  maxLength,
  onAdd,
}: {
  label: string;
  placeholder: string;
  maxLength: number;
  onAdd: (value: string) => void;
}) => {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  // Synchronous, so the field is focused inside the tap and a phone raises its keyboard
  const openField = () => {
    flushSync(() => setOpen(true));
    inputRef.current?.focus();
  };
  if (!open)
    return (
      <AddRow icon={<Plus />} onClick={openField}>
        {label}
      </AddRow>
    );
  return (
    <DetailRow icon={<Plus />}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const trimmed = value.trim();
          if (!trimmed) return;
          onAdd(trimmed);
          setValue("");
        }}
      >
        <Input
          ref={inputRef}
          type="text"
          aria-label={placeholder}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={maxLength}
          placeholder={placeholder}
          enterKeyHint="enter"
          className="md:h-9 touch:h-11"
        />
      </form>
    </DetailRow>
  );
};

/**
 * Text edited in place: `start` swaps it for its field, a blur saves a changed value, and Escape
 * cancels only the edit, leaving the sheet open.
 */
const useInlineEdit = (value: string, save: (value: string) => void) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const cancelled = useRef(false);
  return {
    editing,
    start: () => {
      cancelled.current = false;
      setDraft(value);
      setEditing(true);
    },
    field: {
      value: draft,
      onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        setDraft(e.target.value),
      onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
        if (e.key !== "Escape") return;
        e.stopPropagation();
        cancelled.current = true;
        e.currentTarget.blur();
      },
      onBlur: () => {
        const trimmed = draft.trim();
        if (!cancelled.current && trimmed && trimmed !== value) save(trimmed);
        setEditing(false);
      },
    },
  };
};

// touch:py-1.5 centres the first line on the h-9 touch buttons
const itemTextClass = "min-w-0 flex-1 py-1 text-sm touch:py-1.5 touch:text-base";

const EditTrigger = ({ className, ...props }: Omit<ComponentProps<"button">, "type">) => (
  <button
    type="button"
    dir="auto"
    className={cn(
      itemTextClass,
      "cursor-text rounded-sm text-left wrap-anywhere outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
      className,
    )}
    {...props}
  />
);

/**
 * A subtask's title, edited in place by a tap or click on it. Being a control of its own also keeps
 * a touch on its first letters from being moved to the checkbox beside it.
 */
const SubtaskTitle = ({ sub, done, canEdit }: { sub: Task; done: boolean; canEdit: boolean }) => {
  const { editing, start, field } = useInlineEdit(sub.title, (title) =>
    updateTask(sub.id, { title }),
  );
  const doneClass = done && "text-muted-foreground line-through";

  if (editing) {
    return (
      <Input
        aria-label="Subtask"
        {...field}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          field.onKeyDown(e);
        }}
        maxLength={MAX_TITLE}
        // eslint-disable-next-line jsx-a11y/no-autofocus -- inline edit, user just tapped the title
        autoFocus
        enterKeyHint="done"
        // The same size and padding while editing, so the row doesn't move
        className={cn(itemTextClass, "border-hint")}
      />
    );
  }

  if (!canEdit)
    return (
      <span dir="auto" className={cn(itemTextClass, "wrap-anywhere", doneClass)}>
        {sub.title}
      </span>
    );

  return (
    <EditTrigger aria-label={`Edit ${sub.title}`} onClick={start} className={cn(doneClass)}>
      {sub.title}
    </EditTrigger>
  );
};

export const Subtasks = ({
  task,
  subtasks: rawSubtasks,
  canAdd,
  onToggle,
}: {
  task: Task;
  subtasks: Task[];
  canAdd: boolean;
  onToggle: (task: Task) => void;
}) => {
  const userId = useOptimisticUserId();
  const lists = useCategoriesById();

  if (rawSubtasks.length === 0 && !canAdd) return null;

  const subtasks = [...rawSubtasks].sort((a, b) => compareSortOrder(a.sortOrder, b.sortOrder));
  const done = subtasks.filter((s) => s.status === "done").length;

  return (
    <fieldset aria-label="Subtasks" className="flex min-w-0 flex-col">
      {subtasks.length > 0 && (
        <>
          <SectionHeading>
            Subtasks
            <span className="tabular-nums">
              {done} of {subtasks.length}
            </span>
          </SectionHeading>
          <DetailRow>
            {subtasks.map((sub) => {
              const isDone = sub.status === "done";
              const held = holders(sub, lists, task);
              return (
                <ListRow
                  key={sub.id}
                  size="sm"
                  className="-mx-2 min-h-9 items-start touch:min-h-11"
                >
                  {/* Checkbox, title and Delete centre on the title's first line. The target ends
                    where the gap does and reaches left into the gutter, off the title. */}
                  <Checkbox
                    checked={isDone}
                    aria-label={sub.title}
                    onCheckedChange={() => onToggle(sub)}
                    className={cn(
                      "mt-1.75 size-3.5 after:-right-2 after:-left-4 touch:mt-2.5 touch:size-4 touch:after:-inset-y-3.75 touch:after:-right-2 touch:after:-left-6",
                      isDone && checkboxDoneClass,
                    )}
                  />
                  <SubtaskTitle sub={sub} done={isDone} canEdit={canEditTask(held, userId)} />
                  {canDeleteTask(held, userId) && (
                    <RevealGroup className="items-start pt-1.5 touch:pt-0">
                      <DeleteItemButton
                        label="Delete subtask"
                        onClick={() =>
                          pushUndoToast(quoted(sub.title, " deleted"), deleteTask(sub.id))
                        }
                      />
                    </RevealGroup>
                  )}
                </ListRow>
              );
            })}
          </DetailRow>
        </>
      )}
      {canAdd && (
        <AddLine
          label="Add a subtask"
          placeholder="New subtask"
          maxLength={MAX_TITLE}
          onAdd={(title) => void addTask(title, null, task.id)}
        />
      )}
    </fieldset>
  );
};

const SectionHeading = ({ children }: { children: ReactNode }) => (
  <SectionLabel className="flex h-8 items-center justify-between">{children}</SectionLabel>
);

const DeleteItemButton = ({ label, onClick }: { label: string; onClick: () => void }) => (
  <RevealButton icon aria-label={label} title={label} onClick={onClick}>
    <Trash2 className="size-3.5 touch:size-4" />
  </RevealButton>
);

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const writtenOn = (at: Date) => {
  const day = Temporal.PlainDate.from({
    year: at.getFullYear(),
    month: at.getMonth() + 1,
    day: at.getDate(),
  });
  const daysAgo = Temporal.Now.plainDateISO().since(day, { largestUnit: "day" }).days;
  if (daysAgo === 0) return "Today";
  if (daysAgo === 1) return "Yesterday";
  return formatDay(day);
};

/** When a note was written, in the device's zone: "Today, 18:02", "Yesterday, 21:40", "Oct 25, 09:14". */
const formatWritten = (createdAt: string) => {
  const at = new Date(createdAt);
  return `${writtenOn(at)}, ${timeFormat.format(at)}`;
};

const NoteItem = ({ note }: { note: Note }) => {
  const text = note.content || note.title || "";
  const { editing, start, field } = useInlineEdit(text, (content) =>
    updateNote(note.id, { content }),
  );

  if (editing) {
    return (
      <DetailRow icon={<StickyNote />}>
        <Textarea
          aria-label="Note"
          {...field}
          maxLength={MAX_TEXT}
          // eslint-disable-next-line jsx-a11y/no-autofocus -- inline edit, user just clicked
          autoFocus
          rows={2}
          className="py-2"
        />
      </DetailRow>
    );
  }

  return (
    <DetailRow icon={<StickyNote />}>
      <ListRow size="sm" className="-mx-2 min-h-9 items-start touch:min-h-11">
        <div className="flex min-w-0 flex-1 flex-col pb-1">
          <EditTrigger
            aria-label={`Edit note: ${text}`}
            onClick={start}
            className="pb-0 whitespace-pre-wrap touch:pb-0"
          >
            {text}
          </EditTrigger>
          <time dateTime={note.createdAt} className="text-xs text-hint">
            {formatWritten(note.createdAt)}
          </time>
        </div>
        <RevealGroup className="items-start pt-1.5 touch:pt-0">
          <DeleteItemButton
            label="Delete note"
            onClick={() => pushUndoToast(quoted(text, " deleted", "Note "), deleteNote(note.id))}
          />
        </RevealGroup>
      </ListRow>
    </DetailRow>
  );
};

export const Notes = ({ taskId, notes }: { taskId: string; notes: Note[] }) => (
  <fieldset aria-label="Notes" className="flex min-w-0 flex-col">
    {notes.length > 0 && <SectionHeading>Notes</SectionHeading>}
    {notes.map((note) => (
      <NoteItem key={note.id} note={note} />
    ))}
    <AddLine
      label="Add a note"
      placeholder="New note"
      maxLength={MAX_TEXT}
      onAdd={(content) => addNote({ userId: getCurrentUserId(), taskId, content })}
    />
  </fieldset>
);
