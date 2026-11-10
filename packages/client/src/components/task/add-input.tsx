import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowUp, CornerDownLeft, X } from "lucide-react";
import { Input } from "~/components/ui/field";
import { InitialsAvatar } from "~/components/ui/initials-avatar";
import { MAX_SHARES_ON_ADD, MAX_TITLE } from "@newtab-todo/shared/field-limits";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import type { Taggable } from "~/lib/types";
import { mentionAt, suggestionsFor, withoutMention } from "./mention";

// No autofocus on touch: opening the keyboard on mount is jarring and stops the layout settling
const IS_TOUCH =
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(pointer: coarse)").matches;

const firstName = (name: string) => name.trim().split(/\s+/)[0];

export function AddTaskInput({
  onAdd,
  contacts = [],
}: {
  onAdd: (title: string, shareWith: Taggable[]) => void;
  /** Who `@` can share the task with; none, and typing `@` is only text. */
  contacts?: readonly Taggable[];
}) {
  const [value, setValue] = useState("");
  const [caret, setCaret] = useState(0);
  const [picked, setPicked] = useState<Taggable[]>([]);
  const [active, setActive] = useState(0);
  // The `@` whose suggestions Escape closed, so they stay closed until another is typed
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const caretAfterPick = useRef<number | null>(null);
  const listId = useId();

  const hasText = value.trim().length > 0;
  const mention = picked.length < MAX_SHARES_ON_ADD ? mentionAt(value, caret) : null;
  const suggestions =
    mention && mention.start !== dismissedAt ? suggestionsFor(contacts, mention.query, picked) : [];
  const open = suggestions.length > 0;
  const activeIndex = Math.min(active, suggestions.length - 1);

  useLayoutEffect(() => {
    const at = caretAfterPick.current;
    if (at === null) return;
    caretAfterPick.current = null;
    inputRef.current?.setSelectionRange(at, at);
  });

  const update = (next: string, at: number) => {
    setValue(next);
    setCaret(at);
    setActive(0);
  };

  const pick = (person: Taggable) => {
    if (!mention) return;
    const rest = withoutMention(value, mention.start, caret);
    setPicked((people) => [...people, person]);
    caretAfterPick.current = rest.caret;
    update(rest.value, rest.caret);
  };

  const unpick = (person: Taggable) => {
    setPicked((people) => people.filter((p) => p.id !== person.id));
    inputRef.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    const input = e.currentTarget;
    if (
      e.key === "Backspace" &&
      input.selectionStart === 0 &&
      input.selectionEnd === 0 &&
      picked.length > 0
    ) {
      e.preventDefault();
      setPicked((people) => people.slice(0, -1));
      return;
    }
    if (!open || !mention) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((activeIndex + step + suggestions.length) % suggestions.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      pick(suggestions[activeIndex]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setDismissedAt(mention.start);
    }
  };

  return (
    <form
      className="relative"
      onSubmit={(e) => {
        e.preventDefault();
        const title = value.trim();
        if (!title) return;
        onAdd(title, picked);
        update("", 0);
        setPicked([]);
        setDismissedAt(null);
      }}
    >
      <label htmlFor="add-task-input" className="sr-only">
        New task
      </label>
      {/* The underline is the row's, so people picked sit on the line the task is typed on */}
      <div className="flex flex-wrap items-center gap-x-1.5 border-b border-ghost has-[input:focus-visible]:border-hint touch:pr-11">
        {picked.map((person) => (
          <span
            key={person.id}
            className="inline-flex h-7 max-w-40 items-center gap-1.5 rounded-full bg-muted pr-1 pl-0.5 text-sm text-foreground"
          >
            <InitialsAvatar name={person.name} userId={person.id} />
            <span dir="auto" className="truncate">
              {firstName(person.name)}
            </span>
            <button
              type="button"
              aria-label={`Don't share with ${person.name}`}
              title={`Don't share with ${person.name}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => unpick(person)}
              className="relative grid size-5 shrink-0 place-items-center rounded-full text-hint transition-colors after:absolute after:-inset-3 hover:text-foreground focus-visible:text-foreground focus-visible:outline-1 focus-visible:outline-hint touch:after:-inset-3"
            >
              <X className="size-3.5" />
            </button>
          </span>
        ))}
        <Input
          ref={inputRef}
          id="add-task-input"
          type="text"
          maxLength={MAX_TITLE}
          value={value}
          onChange={(e) => update(e.target.value, e.target.selectionStart ?? e.target.value.length)}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
          onKeyDown={onKeyDown}
          onBlur={() => setDismissedAt(mention?.start ?? null)}
          onFocus={() => setDismissedAt(null)}
          placeholder={picked.length > 0 ? "What are you sharing?" : "What needs doing?"}
          className="min-w-24 flex-1 border-b-0 text-lg md:text-lg"
          autoComplete="off"
          enterKeyHint="enter"
          role={contacts.length > 0 ? "combobox" : undefined}
          aria-expanded={contacts.length > 0 ? open : undefined}
          aria-controls={open ? listId : undefined}
          aria-autocomplete={contacts.length > 0 ? "list" : undefined}
          aria-activedescendant={open ? `${listId}-${activeIndex}` : undefined}
          // eslint-disable-next-line jsx-a11y/no-autofocus -- new tab page, primary action; suppressed on mobile
          autoFocus={!IS_TOUCH}
        />
      </div>
      {open && (
        // Below the field on desktop, where the list follows it; above it on touch, where the
        // field is at the foot of the screen
        <div className="absolute inset-x-0 top-full z-30 mt-1.5 max-w-xs rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md touch:top-auto touch:bottom-full touch:mt-0 touch:mb-1.5">
          <p id={`${listId}-label`} className="px-2 pt-1 pb-1.5 text-xs text-hint">
            Share with
          </p>
          {/* The field keeps focus and the keys (aria-activedescendant), which no native element
              beside a text field allows */}
          {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a combobox's popup listbox */}
          <div id={listId} role="listbox" aria-labelledby={`${listId}-label`}>
            {suggestions.map((person, index) => (
              // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/interactive-supports-focus -- picked with the field's keys, which keep focus
              <div
                key={person.id}
                id={`${listId}-${index}`}
                // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- an option of the listbox above
                role="option"
                aria-selected={index === activeIndex}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => pick(person)}
                className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm aria-selected:bg-muted touch:min-h-11 touch:text-base"
              >
                <InitialsAvatar name={person.name} userId={person.id} />
                <span dir="auto" className="min-w-0 truncate text-foreground">
                  {person.name}
                </span>
                <span className="ml-auto shrink-0 text-xs text-hint touch:text-sm">
                  @{person.username}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      {/* Only while there's text: teaches Enter without being permanent noise */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute right-0 bottom-3 text-ghost transition-opacity duration-150 touch:hidden"
        style={{ opacity: hasText && !open ? 1 : 0 }}
      >
        <CornerDownLeft className="size-3.5" />
      </span>
      {/* Touch: an explicit add button, since the keyboard's return key isn't an obvious "save" */}
      <Button
        type="submit"
        size="sm"
        icon
        aria-label="Add task"
        tabIndex={hasText ? 0 : -1}
        // Keep focus in the input so the keyboard stays up for the next task
        onMouseDown={(e) => e.preventDefault()}
        className={cn(
          // bottom-1.5 rather than centred: people picked can wrap the field to a second line
          // after: 44px touch target
          "absolute right-0 bottom-1.5 hidden rounded-full transition-[opacity,scale] duration-150 after:absolute after:-inset-1.5 touch:inline-flex touch:size-8",
          !hasText && "pointer-events-none scale-75 opacity-0",
        )}
      >
        <ArrowUp className="size-4" strokeWidth={2.5} />
      </Button>
    </form>
  );
}
