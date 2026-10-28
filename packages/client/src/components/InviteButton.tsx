import { UserPlus } from "lucide-react";
import { useInvite } from "~/lib/hooks/use-invite";
import { Button } from "~/components/ui/button";

// A frame later: when the focused control it replaces leaves, the sheet (Base UI's focus manager,
// restoreFocus "popup") focuses itself again on the next frame, which would take focus back
const focusIt = (el: HTMLButtonElement | null) => {
  if (el) requestAnimationFrame(() => el.focus());
};

/**
 * People's invite, wherever someone runs out of people to add. `takeFocus` is for when it replaces
 * the control that had focus, which would otherwise drop it to the page.
 */
export function InviteButton({
  label = "Invite someone",
  takeFocus = false,
}: {
  label?: string;
  takeFocus?: boolean;
}) {
  const { invite, inviting } = useInvite();
  return (
    <Button
      ref={takeFocus ? focusIt : undefined}
      variant="outline"
      size="sm"
      onClick={invite}
      disabled={inviting}
      className="self-start"
    >
      <UserPlus />
      {inviting ? "Generating link…" : label}
    </Button>
  );
}
