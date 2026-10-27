import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { UserRound, Users } from "lucide-react";
import { grants } from "@newtab-todo/shared/task-access";
import type { Task } from "~/lib/types";
import { useContacts, moveToList, updateTask } from "~/lib/db/hooks";
import { listChoices } from "~/lib/effective-category";
import { useCategoriesById } from "~/lib/hooks/use-categories-by-id";
import { holders, type CategoriesById } from "~/lib/task-holders";
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
import { InitialsAvatar } from "~/components/ui/initials-avatar";
import { ListRow } from "~/components/ui/list-row";
import { RevealButton, RevealGroup } from "~/components/ui/reveal-button";
import { TogglePill } from "~/components/ui/toggle-pill";
import { DetailRow } from "~/components/task/detail-row";
import { hitArea } from "~/components/hit-area";

const INBOX_VALUE = "__inbox__";

const rowTrigger =
  "h-9 w-full min-w-0 justify-between border-0 py-0 text-sm hover:text-foreground touch:h-11 touch:text-base";

type Person = { id: string; name: string };

/** The list this task is in for the viewer, and the lists they can move it to. */
export const useListFiling = (task: Task) => {
  const userId = useOptimisticUserId();
  const lists = useCategoriesById();
  const { mode, categoryId, choices } = listChoices(task, userId, lists);
  return {
    mode,
    category: categoryId ? lists.get(categoryId) : undefined,
    choices,
    move: (id: string | null) => moveToList(task, mode, id),
  };
};

type Filing = ReturnType<typeof useListFiling>;

export const ListField = ({ filing, choosing }: { filing: Filing; choosing: boolean }) => {
  const { category, choices, move } = filing;
  if (!category && !choosing) return null;

  const icon = category && <ColorDot color={category.color ?? undefined} />;

  if (choices.length === 0)
    return (
      <DetailRow icon={icon} label="List">
        <span className="truncate text-sm leading-9 touch:text-base touch:leading-11">
          {category?.name}
        </span>
      </DetailRow>
    );

  const items = [
    { value: INBOX_VALUE, label: "Inbox" },
    ...choices.map((c) => ({ value: c.id, label: c.name })),
  ];

  return (
    <DetailRow icon={icon} label="List">
      <Select
        value={category?.id ?? INBOX_VALUE}
        defaultOpen={choosing && !category}
        onValueChange={(v) => {
          const id = v as string;
          move(id === INBOX_VALUE ? null : id);
        }}
        items={items}
      >
        <SelectTrigger variant="underline" aria-label="List" className={rowTrigger}>
          <SelectValue className="truncate" />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </DetailRow>
  );
};

/** Everyone who can see the task besides its owner: its shares, then its list's people. */
const peopleOnTask = (task: Task, lists: CategoriesById): Person[] => {
  const category = task.categoryId ? lists.get(task.categoryId) : undefined;
  const names = new Map<string, string | undefined>(
    task.shares.map((s) => [s.sharedWithUserId, s.sharedWithUser?.name]),
  );
  if (category) {
    names.set(category.userId, category.user?.name);
    for (const c of category.collaborators ?? []) names.set(c.userId, c.user?.name);
  }
  return grants(holders(task, lists)).flatMap(({ userId: id }) => {
    const name = names.get(id);
    return id !== task.userId && name ? [{ id, name }] : [];
  });
};

export const useSharing = (task: Task) => {
  const userId = useOptimisticUserId();
  const lists = useCategoriesById();
  const { data: contacts = [] } = useContacts();
  const category = task.categoryId ? lists.get(task.categoryId) : undefined;
  const isOwner = task.userId === userId;
  const sharedList = category?.collaborators?.length ? category : undefined;
  const sharedWithIds = new Set(task.shares.map((s) => s.sharedWithUserId));
  const others = peopleOnTask(task, lists);
  return {
    userId,
    isOwner,
    sharedList,
    hasContacts: contacts.length > 0,
    addableContacts: contacts.filter((c) => c.contactUser && !sharedWithIds.has(c.contactUserId)),
    others,
  };
};

type Sharing = ReturnType<typeof useSharing>;

export const SharingField = ({
  task,
  sharing,
  adding,
}: {
  task: Task;
  sharing: Sharing;
  adding: boolean;
}) => {
  const { isOwner, sharedList, userId } = sharing;
  // Someone it was shared with sees who else has it, never themselves
  const shares = task.shares.filter((s) => s.sharedWithUserId !== userId);

  if (sharedList)
    return (
      <DetailRow icon={<Users />} label="Sharing">
        <p className="py-2 text-sm text-hint touch:py-3">
          Everyone in {sharedList.name} can see this
        </p>
      </DetailRow>
    );

  if (shares.length === 0 && !adding) return null;

  return (
    <DetailRow icon={<Users />} label="Shared with">
      {shares.map((share) => (
        <ListRow key={share.id} size="sm" className="-mx-2 min-h-9 touch:min-h-11">
          <InitialsAvatar name={share.sharedWithUser?.name ?? "?"} size="sm" />
          <span className="min-w-0 flex-1 truncate text-sm">
            {share.sharedWithUser?.name ?? share.sharedWithUserId}
          </span>
          {isOwner && (
            <RevealGroup>
              <RevealButton className={hitArea} onClick={() => removeTaskShare(share.id)}>
                Remove
              </RevealButton>
            </RevealGroup>
          )}
        </ListRow>
      ))}
      {isOwner && adding && <AddShare taskId={task.id} sharing={sharing} />}
    </DetailRow>
  );
};

const AddShare = ({ taskId, sharing }: { taskId: string; sharing: Sharing }) => {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!sharing.hasContacts)
    return (
      <p className="py-2 text-sm text-hint">
        No contacts yet.{" "}
        <Link to="/people" className="text-foreground underline underline-offset-4">
          Invite someone
        </Link>{" "}
        to share this task.
      </p>
    );

  const share = async (username: string) => {
    setPending(true);
    setError(null);
    try {
      await shareTask(taskId, username, "edit");
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
            <SelectItem key={c.contactUserId} value={c.contactUser!.username}>
              {c.contactUser!.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error && <span className="py-1 text-xs text-destructive">{error}</span>}
    </>
  );
};

export const AssigneeField = ({
  task,
  sharing,
  choosing,
}: {
  task: Task;
  sharing: Sharing;
  choosing: boolean;
}) => {
  if (task.parentId || (!task.assigneeId && !choosing)) return null;

  if (!sharing.isOwner) {
    const name = task.assigneeId === sharing.userId ? "you" : task.assignee?.name;
    if (!name) return null;
    return (
      <DetailRow icon={<UserRound />} label="Assignee">
        <span className="flex h-9 items-center text-sm touch:h-11 touch:text-base">
          Assigned to {name}
        </span>
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
            className={hitArea}
          >
            {c.name}
          </TogglePill>
        ))}
      </div>
    </DetailRow>
  );
};
