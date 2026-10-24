import { useState, type Ref } from "react";
import { StickyNote } from "lucide-react";
import type { Task, Note } from "~/lib/types";
import { addNote, updateNote, deleteNote, deleteTask } from "~/lib/db/hooks";
import { addTask } from "~/lib/db/add-task";
import { getCurrentUserId, useOptimisticUserId } from "~/lib/auth/current-user";
import { Checkbox } from "~/components/ui/checkbox";
import { Input, Textarea } from "~/components/ui/field";
import { ListRow } from "~/components/ui/list-row";
import { RevealButton, RevealGroup } from "~/components/ui/reveal-button";
import { cn } from "~/lib/utils";
import { canDeleteTask } from "~/lib/task-permissions";
import { DetailRow, hitArea, useUndoToast } from "~/components/task/detail-row";

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
  const pushUndo = useUndoToast();

  if (rawSubtasks.length === 0 && !adding) return null;

  const subtasks = [...rawSubtasks].sort((a, b) =>
    (a.sortOrder ?? "").localeCompare(b.sortOrder ?? ""),
  );

  return (
    <DetailRow label="Subtasks">
      {subtasks.map((sub) => {
        const done = sub.status === "done";
        return (
          <ListRow key={sub.id} size="sm" className="-mx-2 min-h-9 touch:min-h-11">
            <Checkbox
              checked={done}
              aria-label={sub.title}
              onCheckedChange={() => onToggle(sub)}
              className="size-3.5 touch:size-4 touch:after:-inset-3.5"
            />
            <span className={cn("flex-1 text-sm", done && "text-muted-foreground line-through")}>
              {sub.title}
            </span>
            {canDeleteTask(userId, sub, task) && (
              <RevealGroup>
                <RevealButton
                  className={hitArea}
                  onClick={() => pushUndo("Subtask deleted", deleteTask(sub.id))}
                >
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
  const pushUndo = useUndoToast();

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
      {/* touch:py-2 centres the first line on the h-9 touch buttons */}
      <span className="flex-1 py-1 text-sm whitespace-pre-wrap touch:py-2">
        {note.content || note.title}
      </span>
      <RevealGroup className="items-start pt-0.5 touch:pt-0">
        <RevealButton intent="neutral" className={hitArea} onClick={() => setEditing(true)}>
          Edit
        </RevealButton>
        <RevealButton
          className={hitArea}
          onClick={() => pushUndo("Note deleted", deleteNote(note.id))}
        >
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
