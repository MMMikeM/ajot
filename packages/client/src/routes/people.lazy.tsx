import { useState } from "react";
import { DragDropProvider } from "@dnd-kit/react";
import { Toast } from "@base-ui/react/toast";
import { createLazyFileRoute, useRouter } from "@tanstack/react-router";
import { ChevronLeft, UserPlus } from "lucide-react";
import { useContacts } from "~/lib/db/hooks";
import { createInvite, removeContact, restoreContact } from "~/lib/actions";
import { pushUndoToast } from "~/lib/undo-toast";
import type { Contact } from "~/lib/types";
import { getBuildTarget } from "~/lib/build-target";
import { getServerUrl } from "~/lib/server-url";
import { useIsDesk } from "~/lib/hooks/use-is-desk";
import { CategorySidebar } from "~/components/category-nav/CategorySidebar";
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
  const [inviting, setInviting] = useState(false);
  const isDesk = useIsDesk();

  const { data: contacts = [], isLoading } = useContacts();

  const invite = async () => {
    setInviting(true);
    try {
      const { token } = await createInvite();
      // The extension's own origin only opens in that browser, so its links go to the
      // server's PWA too
      const origin = getBuildTarget() === "extension" ? getServerUrl() : window.location.origin;
      const url = `${origin}/invite/${token}`;
      if (navigator.share) {
        try {
          await navigator.share({ title: "Join me on Ajot", url });
          return;
        } catch (err) {
          if (err instanceof DOMException && err.name === "AbortError") return;
        }
      }
      try {
        await navigator.clipboard.writeText(url);
        toastManager.add({ title: "Invite link copied", timeout: 5000, data: {} });
      } catch {
        toastManager.add({ title: `Copy this invite link: ${url}`, timeout: 0, data: {} });
      }
    } catch (err) {
      const title = err instanceof Error ? err.message : "Couldn't make an invite link. Try again.";
      toastManager.add({ title, timeout: 5000, data: {} });
    } finally {
      setInviting(false);
    }
  };

  const remove = async (contact: Contact) => {
    const name = contact.contactUser?.name ?? "this contact";
    try {
      await removeContact(contact.id);
    } catch (err) {
      console.error("[contacts] remove failed:", err);
      toastManager.add({ title: `Couldn't remove ${name}. Check your connection and try again.` });
      return;
    }
    pushUndoToast(`Removed ${name}`, () => {
      restoreContact(contact.id).catch((err) => {
        console.error("[contacts] restore failed:", err);
        toastManager.add({ title: `Couldn't bring back ${name}` });
      });
    });
  };

  return (
    // AppShell already provides the column and gutters; on touch this is the scroll area
    <div className="flex flex-col gap-6 pt-1 touch:min-h-0 touch:flex-1 touch:overflow-y-auto touch:pb-[max(1.5rem,env(safe-area-inset-bottom,0px))]">
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
          className="-ml-2 touch:size-10"
        >
          <ChevronLeft className="size-5" />
        </Button>
        <h2 className="font-display text-[1.75rem] leading-tight text-foreground">People</h2>
      </div>

      <Button
        variant="outline"
        size="sm"
        onClick={invite}
        disabled={inviting}
        className="self-start touch:h-10 touch:px-4"
      >
        <UserPlus />
        {inviting ? "Generating link…" : "Invite someone"}
      </Button>

      <div className="-mx-2 flex flex-col gap-1">
        {isLoading && <p className="text-sm text-hint">Loading…</p>}
        {!isLoading && contacts.length === 0 && (
          <p className="text-sm text-hint">
            No contacts yet. Invite someone to share tasks and lists with them.
          </p>
        )}
        {contacts.map((contact) => (
          <ListRow key={contact.id}>
            <InitialsAvatar
              name={contact.contactUser?.name ?? "?"}
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
