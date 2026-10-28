import { DragDropProvider } from "@dnd-kit/react";
import { Toast } from "@base-ui/react/toast";
import { createLazyFileRoute, useRouter } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { removeContact, useContacts } from "~/lib/db/hooks";
import { pushUndoToast } from "~/lib/undo-toast";
import type { Contact } from "~/lib/types";
import { useIsDesk } from "~/lib/hooks/use-is-desk";
import { CategorySidebar } from "~/components/category-nav/CategorySidebar";
import { InviteButton } from "~/components/InviteButton";
import { Button } from "~/components/ui/button";
import { InitialsAvatar } from "~/components/ui/initials-avatar";
import { ListRow } from "~/components/ui/list-row";
import { RevealButton, RevealGroup } from "~/components/ui/reveal-button";
import { TextStack } from "~/components/ui/text-stack";

export const Route = createLazyFileRoute("/people")({
  component: PeoplePage,
});

export function PeoplePage() {
  const router = useRouter();
  const toastManager = Toast.useToastManager();
  const isDesk = useIsDesk();

  const { data: contacts = [], isLoading } = useContacts();

  const remove = (contact: Contact) => {
    const name = contact.contactUser?.name ?? "this contact";
    const { transaction, undo } = removeContact(contact.id);
    const undoToastId = pushUndoToast(`Removed ${name}`, () => {
      undo().catch((err) => {
        console.error("[contacts] restore failed:", err);
        toastManager.add({ title: `Couldn't bring back ${name}` });
      });
    });
    transaction.isPersisted.promise.catch((err) => {
      console.error("[contacts] remove failed:", err);
      toastManager.close(undoToastId);
      toastManager.add({ title: `Couldn't remove ${name}. Try again.` });
    });
  };

  return (
    // AppShell already provides the column and gutters; on touch this is the scroll area
    <div className="flex flex-col gap-6 pt-1 touch:-mx-2 touch:min-h-0 touch:flex-1 touch:overflow-x-hidden touch:overflow-y-auto touch:px-2 touch:pb-[max(1.5rem,env(safe-area-inset-bottom,0px))]">
      {isDesk && (
        <DragDropProvider>
          <CategorySidebar reorderable={false} />
        </DragDropProvider>
      )}
      <div className="flex items-center gap-1">
        <Button
          variant="subtle"
          size="sm"
          icon
          onClick={() => router.navigate({ to: "/" })}
          aria-label="Back to tasks"
          bleed="start"
        >
          <ChevronLeft className="size-5" />
        </Button>
        <h2 className="font-display text-3xl text-foreground">People</h2>
      </div>

      <InviteButton />

      {isLoading && <p className="text-sm text-hint">Loading…</p>}
      {!isLoading && contacts.length === 0 && (
        <p className="text-sm text-hint">
          No contacts yet. People who accept your invite show up here, to share tasks and lists
          with.
        </p>
      )}
      <div className="-mx-2 flex flex-col gap-1 empty:hidden">
        {contacts.map((contact) => (
          <ListRow key={contact.id}>
            <InitialsAvatar
              name={contact.contactUser?.name ?? "?"}
              userId={contact.contactUserId}
              size="md"
              className="size-8 text-sm"
            />
            <TextStack
              title={contact.contactUser?.name ?? "Unknown"}
              subtitle={
                contact.contactUser?.username ? `@${contact.contactUser.username}` : undefined
              }
            />
            <RevealGroup>
              <RevealButton onClick={() => remove(contact)}>Remove</RevealButton>
            </RevealGroup>
          </ListRow>
        ))}
      </div>
    </div>
  );
}
