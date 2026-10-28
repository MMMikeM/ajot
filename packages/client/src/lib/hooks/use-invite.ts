import { useState } from "react";
import { createInvite } from "~/lib/actions";
import { getBuildTarget } from "~/lib/build-target";
import { getServerUrl } from "~/lib/server-url";
import { toastManager } from "~/lib/undo-toast";

const say = (title: string, timeout = 5000) => toastManager.add({ title, timeout, data: {} });

/** Makes an invite link and offers it to the device's share menu, or else copies it. */
export const useInvite = () => {
  const [inviting, setInviting] = useState(false);

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
        say("Invite link copied");
      } catch {
        say(`Copy this invite link: ${url}`, 0);
      }
    } catch (err) {
      say(err instanceof Error ? err.message : "Couldn't make an invite link. Try again.");
    } finally {
      setInviting(false);
    }
  };

  return { invite, inviting };
};
