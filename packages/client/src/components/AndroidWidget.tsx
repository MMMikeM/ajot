import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { makeMcpToken } from "~/lib/actions";
import { handTokenToWidget } from "~/lib/android-app";
import { Button } from "~/components/ui/button";
import { SectionLabel } from "~/components/ui/section-label";

/** Signs the Android app's home screen widget in, with a token of its own. */
export function AndroidWidget({ appPackage }: { appPackage: string }) {
  const queryClient = useQueryClient();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async () => {
    setSending(true);
    setError(null);
    try {
      const { token } = await makeMcpToken({
        name: "Android widget",
        canWrite: true,
        days: 365,
        kind: "widget",
      });
      await queryClient.invalidateQueries({ queryKey: ["mcp-tokens"] });
      handTokenToWidget(appPackage, token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't connect it. Try again.");
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="flex flex-col gap-2">
      <SectionLabel>Home screen widget</SectionLabel>
      <p className="text-sm text-pretty text-hint">
        Shows your Inbox on your home screen, where you can tick tasks off. Connect it once on this
        phone.
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button
        variant="subtle"
        size="xs"
        bleed="start"
        className="self-start"
        disabled={sending}
        onClick={() => void connect()}
      >
        Connect the widget
      </Button>
    </section>
  );
}
