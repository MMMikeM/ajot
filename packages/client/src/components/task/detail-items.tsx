import { useState, type Ref } from "react";
import { StickyNote } from "lucide-react";
import { compareSortOrder } from "@newtab-todo/shared/sort-order";
import type { Task, Note } from "~/lib/types";
import { addNote, updateNote, deleteNote, deleteTask } from "~/lib/db/hooks";
import { addTask } from "~/lib/db/add-task";
import { getCurrentUserId, useOptimisticUserId } from "~/lib/auth/current-user";
import { Checkbox, checkboxDoneClass } from "~/components/ui/checkbox";
import { Input, Textarea } from "~/components/ui/field";
import { ListRow } from "~/components/ui/list-row";
import { RevealButton, RevealGroup } from "~/components/ui/reveal-button";
import { cn } from "~/lib/utils";
import { canDeleteTask } from "@newtab-todo/shared/task-access";
import { useCategoriesById } from "~/lib/hooks/use-categories-by-id";
import { holders } from "~/lib/task-holders";
import { DetailRow } from "~/components/task/detail-row";
import { pushUndoToast } from "~/lib/undo-toast";

const AddLine = ({
  inputRef,
  placeholder,
  onAdd,
}: {
  inputRef: Ref<HTMLInputElement>;
  placeholder: string;
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
        placeholder={placeholder}
        enterKeyHint="enter"
        className="md:h-8 touch:h-11"
      />
    </form>
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
            <span
              dir="auto"
              className={cn(
                "min-w-0 flex-1 py-1 text-sm wrap-anywhere touch:py-1.5 touch:text-base",
                done && "text-muted-foreground line-through",
              )}
            >
              {sub.title}
            </span>
            {canDeleteTask(holders(sub, lists, task), userId) && (
              <RevealGroup className="items-start pt-1.5 touch:pt-0">
                <RevealButton onClick={() => pushUndoToast("Subtask deleted", deleteTask(sub.id))}>
                  Delete
                </RevealButton>
              </RevealGroup>
            )}
          </ListRow>
        );
      })}
      {adding && (
        <AddLine
          inputRef={inputRef}
          placeholder="New subtask"
          onAdd={(title) => void addTask(title, null, task.id)}
        />
      )}
    </DetailRow>
  );
};

const NoteItem = ({ note }: { note: Note }) => {
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState(note.content ?? "");

  if (editing) {
    return (
      <Textarea
        aria-label="Note"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onBlur={() => {
          const val = content.trim();
          if (val) updateNote(note.id, { content: val });
          setEditing(false);
        }}
        // eslint-disable-next-line jsx-a11y/no-autofocus -- inline edit, user just clicked
        autoFocus
        rows={2}
        className="py-2"
      />
    );
  }

  return (
    <ListRow size="sm" className="-mx-2 min-h-9 items-start touch:min-h-11">
      {/* touch:py-1.5 centres the first line on the h-9 touch buttons */}
      <span
        dir="auto"
        className="min-w-0 flex-1 py-1 text-sm wrap-anywhere whitespace-pre-wrap touch:py-1.5 touch:text-base"
      >
        {note.content || note.title}
      </span>
      <RevealGroup className="items-start pt-0.5 touch:pt-0">
        <RevealButton intent="default" onClick={() => setEditing(true)}>
          Edit
        </RevealButton>
        <RevealButton onClick={() => pushUndoToast("Note deleted", deleteNote(note.id))}>
          Delete
        </RevealButton>
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
          onAdd={(content) =>
            addNote({ userId: getCurrentUserId(), taskId, title: content, content })
          }
        />
      )}
    </DetailRow>
  );
};
