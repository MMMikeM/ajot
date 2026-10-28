import {
  useRef,
  useState,
  type ChangeEvent,
  type ComponentProps,
  type KeyboardEvent,
  type Ref,
} from "react";
import { StickyNote, Trash2 } from "lucide-react";
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
import { DetailRow } from "~/components/task/detail-row";
import { pushUndoToast, quoted } from "~/lib/undo-toast";

const AddLine = ({
  inputRef,
  placeholder,
  maxLength,
  onAdd,
}: {
  inputRef: Ref<HTMLInputElement>;
  placeholder: string;
  maxLength: number;
  onAdd: (value: string) => void;
}) => {
  const [value, setValue] = useState("");
  return (
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
        className="md:h-8 touch:h-11"
      />
    </form>
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
  adding,
  inputRef,
  onToggle,
}: {
  task: Task;
  subtasks: Task[];
  adding: boolean;
  inputRef: Ref<HTMLInputElement>;
  onToggle: (task: Task) => void;
}) => {
  const userId = useOptimisticUserId();
  const lists = useCategoriesById();

  if (rawSubtasks.length === 0 && !adding) return null;

  const subtasks = [...rawSubtasks].sort((a, b) => compareSortOrder(a.sortOrder, b.sortOrder));

  return (
    <DetailRow label="Subtasks">
      {subtasks.map((sub) => {
        const done = sub.status === "done";
        return (
          <ListRow key={sub.id} size="sm" className="-mx-2 min-h-9 items-start touch:min-h-11">
            {/* Checkbox, title and Delete centre on the title's first line. The target ends
                where the gap does and reaches left into the gutter, off the title. */}
            <Checkbox
              checked={done}
              aria-label={sub.title}
              onCheckedChange={() => onToggle(sub)}
              className={cn(
                "mt-1.75 size-3.5 after:-right-2 after:-left-4 touch:mt-2.5 touch:size-4 touch:after:-inset-y-3.75 touch:after:-right-2 touch:after:-left-6",
                done && checkboxDoneClass,
              )}
            />
            <SubtaskTitle
              sub={sub}
              done={done}
              canEdit={canEditTask(holders(sub, lists, task), userId)}
            />
            {canDeleteTask(holders(sub, lists, task), userId) && (
              <RevealGroup className="items-start pt-1.5 touch:pt-0">
                <DeleteItemButton
                  label="Delete subtask"
                  onClick={() => pushUndoToast(quoted(sub.title, " deleted"), deleteTask(sub.id))}
                />
              </RevealGroup>
            )}
          </ListRow>
        );
      })}
      {adding && (
        <AddLine
          inputRef={inputRef}
          placeholder="New subtask"
          maxLength={MAX_TITLE}
          onAdd={(title) => void addTask(title, null, task.id)}
        />
      )}
    </DetailRow>
  );
};

const DeleteItemButton = ({ label, onClick }: { label: string; onClick: () => void }) => (
  <RevealButton icon aria-label={label} title={label} onClick={onClick}>
    <Trash2 className="size-3.5 touch:size-4" />
  </RevealButton>
);

const NoteItem = ({ note }: { note: Note }) => {
  const text = note.content || note.title || "";
  const { editing, start, field } = useInlineEdit(text, (content) =>
    updateNote(note.id, { content }),
  );

  if (editing) {
    return (
      <Textarea
        aria-label="Note"
        {...field}
        maxLength={MAX_TEXT}
        // eslint-disable-next-line jsx-a11y/no-autofocus -- inline edit, user just clicked
        autoFocus
        rows={2}
        className="py-2"
      />
    );
  }

  return (
    <ListRow size="sm" className="-mx-2 min-h-9 items-start touch:min-h-11">
      <EditTrigger
        aria-label={`Edit note: ${text}`}
        onClick={start}
        className="whitespace-pre-wrap"
      >
        {text}
      </EditTrigger>
      <RevealGroup className="items-start pt-1.5 touch:pt-0">
        <DeleteItemButton
          label="Delete note"
          onClick={() => pushUndoToast(quoted(text, " deleted", "Note "), deleteNote(note.id))}
        />
      </RevealGroup>
    </ListRow>
  );
};

export const Notes = ({
  taskId,
  notes,
  adding,
  inputRef,
}: {
  taskId: string;
  notes: Note[];
  adding: boolean;
  inputRef: Ref<HTMLInputElement>;
}) => {
  if (notes.length === 0 && !adding) return null;
  return (
    <DetailRow icon={<StickyNote />} label="Notes">
      {notes.map((note) => (
        <NoteItem key={note.id} note={note} />
      ))}
      {adding && (
        <AddLine
          inputRef={inputRef}
          placeholder="New note"
          maxLength={MAX_TEXT}
          onAdd={(content) => addNote({ userId: getCurrentUserId(), taskId, content })}
        />
      )}
    </DetailRow>
  );
};
