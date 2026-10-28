import { useState } from "react";
import { useCategories, useContacts } from "~/lib/db/hooks";
import { addCollaborator, removeCollaborator, restoreCollaborator } from "~/lib/actions";
import { useAuthToken } from "~/lib/auth/token";
import { pushUndoToast, toastManager } from "~/lib/undo-toast";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "~/components/ui/drawer";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { ColorDot } from "~/components/ui/color-dot";
import { InitialsAvatar } from "~/components/ui/initials-avatar";
import { SectionLabel } from "~/components/ui/section-label";
import { ListRow } from "~/components/ui/list-row";
import { RevealButton, RevealGroup } from "~/components/ui/reveal-button";
import { TextStack } from "~/components/ui/text-stack";
import { keepOpenOnToastPress } from "~/components/sheet-open-change";
import { dockedSheet } from "~/components/docked-sheet";
import { useBackToClose } from "~/lib/hooks/use-back-to-close";
import { InviteButton } from "~/components/InviteButton";

export function CategoryCollabSheet({
  categoryId,
  open,
  onClose,
}: {
  categoryId: string;
  open: boolean;
  onClose: () => void;
}) {
  useBackToClose(open, onClose);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [addedLastContact, setAddedLastContact] = useState(false);

  const { data: allCategories = [] } = useCategories();
  const { data: allContacts = [] } = useContacts();

  const category = allCategories.find((c) => c.id === categoryId);
  const collabs = (category?.collaborators ?? []).flatMap((c) => (c.user ? [c.user] : []));

  const isAuthed = !!useAuthToken();
  const collabIds = new Set(collabs.map((c) => c.id));
  const addableContacts = isAuthed
    ? allContacts.filter((c) => c.contactUser && !collabIds.has(c.contactUserId))
    : [];

  const handleAdd = async (username: string) => {
    const contact = addableContacts.find((c) => c.contactUser?.username === username)?.contactUser;
    setAdding(true);
    setError(null);
    try {
      await addCollaborator(categoryId, username);
      setAddedLastContact(addableContacts.length === 1);
      if (contact)
        pushUndoToast(`Shared with ${contact.name}`, () => void handleRemove(contact.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add them. Try again.");
    } finally {
      setAdding(false);
    }
  };

  /** Whether it worked; the reason is shown in the sheet. */
  const handleRemove = async (userId: string) => {
    setError(null);
    try {
      await removeCollaborator(categoryId, userId);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't remove them. Try again.");
      return false;
    }
  };

  const removeWithUndo = async ({ id, name }: { id: string; name: string }) => {
    if (!(await handleRemove(id))) return;
    pushUndoToast(`Removed ${name}`, () => {
      restoreCollaborator(categoryId, id).catch((err) => {
        console.error("[collaborators] restore failed:", err);
        toastManager.add({
          title: err instanceof Error ? err.message : `Couldn't bring back ${name}`,
        });
      });
    });
  };

  return (
    <Drawer
      open={open}
      onOpenChange={keepOpenOnToastPress((next) => {
        if (next) return;
        setAddedLastContact(false);
        onClose();
      })}
    >
      <DrawerContent className={dockedSheet}>
        <DrawerHeader className="gap-1 px-6 pt-4 pb-2 touch:px-5">
          <DrawerTitle className="font-display text-2xl leading-tight font-normal">
            Share list
          </DrawerTitle>
          {category && (
            <DrawerDescription className="flex items-center gap-2">
              <ColorDot size="sm" color={category.color ?? undefined} />
              <span dir="auto">{category.name}</span>
            </DrawerDescription>
          )}
        </DrawerHeader>
        <div className="flex flex-col gap-6 px-6 pt-2 pb-8 touch:px-5">
          {collabs.length > 0 && (
            <div className="flex flex-col gap-2">
              <SectionLabel>Shared with</SectionLabel>
              {collabs.map((collab) => (
                <ListRow key={collab.id} className="-mx-2">
                  <InitialsAvatar name={collab.name} userId={collab.id} size="md" />
                  <TextStack title={collab.name} subtitle={`@${collab.username}`} />
                  <RevealGroup>
                    <RevealButton onClick={() => void removeWithUndo(collab)}>Remove</RevealButton>
                  </RevealGroup>
                </ListRow>
              ))}
            </div>
          )}

          {(addableContacts.length > 0 || error) && (
            <div className="flex flex-col gap-2">
              {addableContacts.length > 0 && (
                <Select
                  value=""
                  disabled={adding}
                  onValueChange={(v) => void handleAdd(v as string)}
                >
                  <SelectTrigger
                    className="self-start touch:h-10 touch:px-4"
                    aria-label="Add someone"
                  >
                    <SelectValue placeholder={adding ? "Adding…" : "Add someone…"} />
                  </SelectTrigger>
                  <SelectContent>
                    {addableContacts.map((c) => (
                      <SelectItem key={c.contactUserId} value={c.contactUser!.username}>
                        {c.contactUser!.name} (@{c.contactUser!.username})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {error && <p className="text-xs text-destructive">{error}</p>}
            </div>
          )}

          {addableContacts.length === 0 && (
            <div className="flex flex-col items-start gap-3">
              <p className="text-sm text-hint">
                {collabs.length === 0
                  ? "No contacts yet."
                  : "Everyone in your contacts is on this list."}
              </p>
              <InviteButton
                label={collabs.length === 0 ? "Invite someone" : "Invite someone new"}
                takeFocus={addedLastContact}
              />
            </div>
          )}
        </div>
        <div className="h-[env(safe-area-inset-bottom,12px)] min-h-3" />
      </DrawerContent>
    </Drawer>
  );
}
