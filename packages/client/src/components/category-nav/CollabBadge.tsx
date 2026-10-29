import { Users } from "lucide-react";
import { InitialsAvatar } from "~/components/ui/initials-avatar";
import type { Category } from "~/lib/types";
import { listNames } from "~/lib/utils";

/** A face always means whose list it is, so your own shared list never shows a collaborator's. */
export function CollabBadge({
  category,
  currentUserId,
}: {
  category: Category;
  currentUserId: string;
}) {
  if (category.userId !== currentUserId) {
    const owner = category.user?.name ?? "?";
    return (
      <>
        <span aria-hidden="true" className="shrink-0">
          <InitialsAvatar name={owner} userId={category.userId} className="-my-px" />
        </span>
        <span className="sr-only">{owner}'s list</span>
      </>
    );
  }

  const sharedWith = (category.collaborators ?? [])
    .filter((c) => c.user.id !== currentUserId)
    .map((c) => c.user.name);
  if (sharedWith.length === 0) return null;

  const label = `Shared with ${listNames.format(sharedWith)}`;
  return (
    <span title={label} className="flex size-4 shrink-0 items-center justify-center text-hint">
      <Users size={12} aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
}
