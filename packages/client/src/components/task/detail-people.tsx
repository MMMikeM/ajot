import { useState } from "react";
import { CornerLeftUp, UserPlus, UserRound, Users } from "lucide-react";
import { grants } from "@newtab-todo/shared/task-access";
import type { Task } from "~/lib/types";
import { useContacts, moveToList, updateTask } from "~/lib/db/hooks";
import { listChoices } from "~/lib/effective-category";
import { useCategoriesById } from "~/lib/hooks/use-categories-by-id";
import { holders, ownerNameOf, type CategoriesById } from "~/lib/task-holders";
import { shareTask, removeTaskShare } from "~/lib/actions";
import { useOptimisticUserId } from "~/lib/auth/current-user";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { ColorDot } from "~/components/ui/color-dot";
import { cn, listNames } from "~/lib/utils";
import { InitialsAvatar } from "~/components/ui/initials-avatar";
import { ListRow } from "~/components/ui/list-row";
import { RevealButton, RevealGroup } from "~/components/ui/reveal-button";
import { TogglePill } from "~/components/ui/toggle-pill";
import { AddRow, DetailRow, HintRow, lineButton, quietText } from "~/components/task/detail-row";
import { InviteButton } from "~/components/InviteButton";
import { INBOX_COLOR } from "~/lib/constants";

const INBOX_VALUE = "__inbox__";

const rowTrigger =
  "h-9 w-full min-w-0 justify-between border-0 py-0 text-sm hover:text-foreground touch:h-11 touch:text-base";

// The sheet's header line: where the task sits, quieter than anything in it
const crumb = "flex h-9 min-w-0 items-center gap-2 text-sm text-muted-foreground touch:h-11";

type Person = { id: string; name: string };

/** The list this task is in for the viewer, and the lists they can move it to. */
export const useListFiling = (task: Task) => {
  const userId = useOptimisticUserId();
  const lists = useCategoriesById();
  const { mode, categoryId, choices } = listChoices(task, userId, lists);
  return {
    mode,
    categoryId,
    category: categoryId ? lists.get(categoryId) : undefined,
    choices,
    move: (id: string | null) => moveToList(task, mode, id),
  };
};

type Filing = ReturnType<typeof useListFiling>;

/** Where a top-level task sits, opening the lists it can move to. Plain text when it can't move. */
export const ListChip = ({ filing }: { filing: Filing }) => {
  const { categoryId, category, choices, move } = filing;
  if (categoryId === undefined) return null;

  const name = category?.name ?? "Inbox";
  const dot = <ColorDot color={category ? (category.color ?? undefined) : INBOX_COLOR} />;

  if (choices.length === 0)
    return (
      <fieldset aria-label="List" className={crumb}>
        {dot}
        <span dir="auto" className="truncate">
          {name}
        </span>
      </fieldset>
    );

  const items = [
    { value: INBOX_VALUE, label: "Inbox", color: INBOX_COLOR },
    ...choices.map((c) => ({ value: c.id, label: c.name, color: c.color ?? undefined })),
  ];

  return (
    <Select
      value={category?.id ?? INBOX_VALUE}
      onValueChange={(v) => {
        const id = v as string;
        move(id === INBOX_VALUE ? null : id);
      }}
      items={items}
    >
      <SelectTrigger
        variant="underline"
        aria-label="List"
        className={cn(
          crumb,
          "rounded-md border-0 py-0 font-medium text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 aria-expanded:text-foreground",
        )}
      >
        {dot}
        <SelectValue className="truncate" />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            <span className="flex min-w-0 items-center gap-2.5">
              <ColorDot color={item.color} />
              <span dir="auto" className="truncate">
                {item.label}
              </span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};

/** A subtask's way back up: the task it sits under, whose sheet it opens. */
export const ParentCrumb = ({
  parent,
  onOpen,
}: {
  parent?: Task;
  onOpen: (taskId: string) => void;
}) => {
  if (!parent) return null;
  return (
    <button
      type="button"
      onClick={() => onOpen(parent.id)}
      className={cn(lineButton, quietText, crumb)}
    >
      <CornerLeftUp aria-hidden className="size-4 shrink-0" />
      <span className="truncate">
        Subtask of <bdi className="font-medium text-muted-foreground">{parent.title}</bdi>
      </span>
    </button>
  );
};

/**
 * Everyone who can see the task besides its owner: its shares, then its list's people. A
 * subtask's are its parent's.
 */
const peopleOnTask = (task: Task, lists: CategoriesById, parent?: Task): Person[] => {
  const root = parent ?? task;
  const category = root.categoryId ? lists.get(root.categoryId) : undefined;
  const names = new Map<string, string | undefined>(
    root.shares.map((s) => [s.sharedWithUserId, s.sharedWithUser.name]),
  );
  if (category) {
    names.set(category.userId, category.user?.name);
    for (const c of category.collaborators ?? []) names.set(c.userId, c.user.name);
  }
  return grants(holders(task, lists, parent)).flatMap(({ userId: id }) => {
    const name = names.get(id);
    return id !== root.userId && name ? [{ id, name }] : [];
  });
};

export const useSharing = (task: Task, lists: CategoriesById, parent?: Task) => {
  const userId = useOptimisticUserId();
  const { data: contacts = [] } = useContacts();
  const category = task.categoryId ? lists.get(task.categoryId) : undefined;
  const isOwner = task.userId === userId;
  const sharedList = category?.collaborators?.length ? category : undefined;
  const sharedWithIds = new Set(task.shares.map((s) => s.sharedWithUserId));
  const others = peopleOnTask(task, lists, parent);
  return {
    userId,
    isOwner,
    sharedList,
    hasContacts: contacts.length > 0,
    addableContacts: contacts.filter((c) => !sharedWithIds.has(c.contactUserId)),
    others,
  };
};

type Sharing = ReturnType<typeof useSharing>;

export const SharingField = ({ task, sharing }: { task: Task; sharing: Sharing }) => {
  const [adding, setAdding] = useState(false);
  const { isOwner, sharedList, userId } = sharing;
  // Someone it was shared with sees who else has it, never themselves
  const shares = task.shares.filter((s) => s.sharedWithUserId !== userId);

  if (sharedList)
    return (
      <HintRow icon={<Users />} label="Sharing">
        Everyone in <span dir="auto">{sharedList.name}</span> can see this
      </HintRow>
    );

  const offer = isOwner && !adding && (
    <AddRow icon={<UserPlus />} onClick={() => setAdding(true)}>
      {shares.length > 0 ? "Share with someone else" : "Share"}
    </AddRow>
  );

  if (shares.length === 0 && !adding) return offer;

  return (
    <>
      <DetailRow icon={<Users />} label="Shared with">
        {shares.map((share) => (
          <ListRow key={share.id} size="sm" className="-mx-2 min-h-9 touch:min-h-11">
            <InitialsAvatar
              name={share.sharedWithUser.name}
              userId={share.sharedWithUserId}
              size="sm"
            />
            <span dir="auto" className="min-w-0 flex-1 truncate text-sm touch:text-base">
              {share.sharedWithUser.name}
            </span>
            {isOwner && (
              <RevealGroup>
                <RevealButton onClick={() => removeTaskShare(share.id)}>Remove</RevealButton>
              </RevealGroup>
            )}
          </ListRow>
        ))}
        {isOwner && adding && <AddShare taskId={task.id} sharing={sharing} />}
      </DetailRow>
      {offer}
    </>
  );
};

/** Who else a subtask reaches: everyone who can see the task it sits under, besides the viewer. */
export const SubtaskSharing = ({
  parent,
  sharing,
  lists,
}: {
  parent: Task;
  sharing: Sharing;
  lists: CategoriesById;
}) => {
  const owner = { id: parent.userId, name: ownerNameOf(parent, lists) ?? "" };
  const names = [owner, ...sharing.others]
    .filter((p) => p.id !== sharing.userId)
    .map((p) => p.name.trim())
    .filter(Boolean);
  if (names.length === 0) return null;

  return (
    <HintRow icon={<Users />}>
      With{" "}
      {listNames
        .formatToParts(names)
        .map((part, i) => (part.type === "element" ? <bdi key={i}>{part.value}</bdi> : part.value))}
      , like the task it’s in
    </HintRow>
  );
};

const AddShare = ({ taskId, sharing }: { taskId: string; sharing: Sharing }) => {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sharedWithLastContact, setSharedWithLastContact] = useState(false);

  if (sharing.addableContacts.length === 0)
    return (
      <div className="flex flex-col items-start gap-2 py-2">
        <p className="text-sm text-hint">
          {sharing.hasContacts ? "Shared with all your contacts." : "No contacts yet."}
        </p>
        <InviteButton
          label={sharing.hasContacts ? "Invite someone new" : "Invite someone"}
          takeFocus={sharedWithLastContact}
        />
      </div>
    );

  const share = async (username: string) => {
    setPending(true);
    setError(null);
    try {
      await shareTask(taskId, username, "edit");
      setSharedWithLastContact(sharing.addableContacts.length === 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't share. Try again.");
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <Select
        value=""
        defaultOpen
        disabled={pending}
        onValueChange={(v) => void share(v as string)}
      >
        <SelectTrigger variant="underline" aria-label="Share with" className={rowTrigger}>
          <SelectValue className="truncate" placeholder={pending ? "Sharing…" : "Share with…"} />
        </SelectTrigger>
        <SelectContent>
          {sharing.addableContacts.map((c) => (
            <SelectItem key={c.contactUserId} value={c.contactUser.username}>
              <span dir="auto">{c.contactUser.name}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error && <span className="py-1 text-xs text-destructive">{error}</span>}
    </>
  );
};

export const AssigneeField = ({ task, sharing }: { task: Task; sharing: Sharing }) => {
  // Shown while the sheet is open once there's been an assignee: unassigning would otherwise
  // remove the row under the pointer, as hiding an added field on blur did
  const [choosing, setChoosing] = useState(() => !!task.assigneeId);
  if (task.parentId) return null;

  if (!task.assigneeId && !choosing) {
    const canAssign = sharing.isOwner && sharing.others.length > 0;
    return canAssign ? (
      <AddRow icon={<UserRound />} onClick={() => setChoosing(true)}>
        Assign
      </AddRow>
    ) : null;
  }

  if (!sharing.isOwner) {
    const name = task.assigneeId === sharing.userId ? "you" : task.assignee?.name;
    if (!name) return null;
    return (
      <DetailRow icon={<UserRound />} label="Assignee">
        <p className="text-sm leading-9 touch:text-base touch:leading-11">
          Assigned to <span dir="auto">{name}</span>
        </p>
      </DetailRow>
    );
  }

  // The owner can hand the task to themselves or anyone who can see it
  const candidates = [{ id: task.userId, name: "You" }, ...sharing.others];
  if (task.assignee && !candidates.some((c) => c.id === task.assigneeId))
    candidates.push({ id: task.assignee.id, name: task.assignee.name });

  return (
    <DetailRow icon={<UserRound />}>
      <div
        className="flex flex-wrap gap-1.5 py-1.5 touch:gap-2 touch:py-1"
        role="radiogroup"
        aria-label="Assignee"
      >
        {[{ id: null, name: "Unassigned" }, ...candidates].map((c) => (
          <TogglePill
            key={c.id ?? "unassigned"}
            // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- styled pills in an ARIA radiogroup
            role="radio"
            aria-checked={task.assigneeId === c.id}
            selected={task.assigneeId === c.id}
            onClick={() => updateTask(task.id, { assigneeId: c.id })}
          >
            <span dir="auto">{c.name}</span>
          </TogglePill>
        ))}
      </div>
    </DetailRow>
  );
};
