import { useState } from "react";
import { Toast } from "@base-ui/react/toast";
import { Link } from "@tanstack/react-router";
import { UserRound, Users } from "lucide-react";
import type { Task, Category } from "~/lib/types";
import { useCategories, useContacts, updateTask } from "~/lib/db/hooks";
import { shareTask, removeTaskShare, updateShareCategory } from "~/lib/actions";
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
  "h-9 w-full justify-between border-0 py-0 text-sm hover:text-foreground touch:h-11 touch:text-base";

type Person = { id: string; name: string };

/**
 * Where this task is filed for the viewer: the owner files the task itself, someone it
 * was shared with files their share, and a collaborator in a shared list only sees it.
 */
export const useListFiling = (task: Task) => {
  const userId = useOptimisticUserId();
  const { data: categories = [] } = useCategories();
  const myShare = task.shares.find((s) => s.sharedWithUserId === userId);
  const mode = task.userId === userId ? "owner" : myShare ? "share" : "view";
  const categoryId = mode === "share" ? (myShare?.categoryId ?? null) : task.categoryId;
  const category = categories.find((c) => c.id === categoryId);
  const choices = categories.filter((c) => c.userId === userId || c.id === task.categoryId);
  const toastManager = Toast.useToastManager();
  const fileShare = (id: string | null) =>
    updateShareCategory(task.id, id).catch((err) => {
      console.error("[share] filing failed:", err);
      toastManager.add({ title: "Couldn't move it to that list" });
    });
  return {
    mode,
    category,
    choices: mode === "view" ? [] : choices.filter((c) => mode === "owner" || c.userId === userId),
    move: (id: string | null) =>
      mode === "share" ? void fileShare(id) : updateTask(task.id, { categoryId: id }),
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
        <span className="flex h-9 items-center text-sm touch:h-11 touch:text-base">
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
          <SelectValue />
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
const peopleOnTask = (task: Task, category: Category | undefined): Person[] => {
  const seen = new Set<string>([task.userId]);
  const people: Person[] = [];
  const add = (id: string, name: string | undefined) => {
    if (!name || seen.has(id)) return;
    seen.add(id);
    people.push({ id, name });
  };
  for (const s of task.shares) add(s.sharedWithUserId, s.sharedWithUser?.name);
  if (category && category.collaborators.length > 0) {
    add(category.userId, category.user?.name);
    for (const c of category.collaborators) if (c.user) add(c.user.id, c.user.name);
  }
  return people;
};

export const useSharing = (task: Task) => {
  const userId = useOptimisticUserId();
  const { data: categories = [] } = useCategories();
  const { data: contacts = [] } = useContacts();
  const category = categories.find((c) => c.id === task.categoryId);
  const isOwner = task.userId === userId;
  const sharedList = category && category.collaborators.length > 0 ? category : undefined;
  const sharedWithIds = new Set(task.shares.map((s) => s.sharedWithUserId));
  const others = peopleOnTask(task, category);
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
          <SelectValue placeholder={pending ? "Sharing…" : "Share with…"} />
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
