import { useEffect, useState, type ReactNode } from "react";
import { BellRing, Download, X } from "lucide-react";
import { useAuthToken } from "~/lib/auth/token";
import { getBuildTarget } from "~/lib/build-target";
import { useInstallPrompt } from "~/lib/hooks/use-install-prompt";
import { isPushSubscribed, pushBlocker, registerPushSubscription } from "~/lib/sync/push";
import { useTasks } from "~/lib/db/hooks";
import { Button } from "~/components/ui/button";

const DISMISSED_KEY = "newtab-todo-setup-hint-dismissed";

type Step = "install" | "background";

const readDismissed = (): Step[] => {
  try {
    return JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "[]") as Step[];
  } catch {
    return [];
  }
};

const isInstalled = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

// iPadOS reports itself as a Mac, so a touch screen gives it away
const isAppleTouch = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

/** Whether this device would still show the notification permission prompt, kept current. */
const useNotificationsAskable = () => {
  const [askable, setAskable] = useState(false);

  useEffect(() => {
    if (pushBlocker() !== null || Notification.permission !== "default") return;
    let cancelled = false;
    let status: PermissionStatus | null = null;
    const onChange = () => setAskable(Notification.permission === "default");
    void isPushSubscribed().then((subscribed) => {
      if (!cancelled) setAskable(!subscribed && Notification.permission === "default");
    });
    // Signing in asks for permission itself; once answered there, the offer goes away
    navigator.permissions
      ?.query({ name: "notifications" })
      .then((s) => {
        if (cancelled) return;
        status = s;
        s.addEventListener("change", onChange);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      status?.removeEventListener("change", onChange);
    };
  }, []);

  return askable;
};

/**
 * Offers a signed-in PWA its two setup steps once there's something worth keeping: installing it,
 * then updating it in the background. One at a time, inline, each dismissed for good on this device.
 */
export function SetupHint() {
  const isPwa = getBuildTarget() === "browser";
  const signedIn = !!useAuthToken();
  const { data: tasks = [] } = useTasks();
  const { canInstall, install } = useInstallPrompt();
  const notificationsAskable = useNotificationsAskable();
  const [dismissed, setDismissed] = useState(readDismissed);
  const [turningOn, setTurningOn] = useState(false);

  if (!isPwa || !signedIn || tasks.length === 0) return null;

  const dismiss = (step: Step) => {
    const next = [...dismissed, step];
    setDismissed(next);
    try {
      localStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
    } catch {
      // Storage blocked: the hint stays gone until the page reloads
    }
  };

  const installable = !isInstalled() && (canInstall || isAppleTouch());
  if (installable && !dismissed.includes("install")) {
    return (
      <HintRow
        icon={<Download />}
        onDismiss={() => dismiss("install")}
        action={
          canInstall && (
            <Button variant="subtle" size="xs" onClick={install}>
              Install
            </Button>
          )
        }
      >
        {canInstall
          ? "Install Ajot so it opens like an app, even offline."
          : "To open Ajot offline, tap Share, then Add to Home Screen."}
      </HintRow>
    );
  }

  if (notificationsAskable && !dismissed.includes("background")) {
    const turnOn = async () => {
      setTurningOn(true);
      const subscribed = await registerPushSubscription();
      setTurningOn(false);
      if (subscribed || Notification.permission !== "default") dismiss("background");
    };
    return (
      <HintRow
        icon={<BellRing />}
        onDismiss={() => dismiss("background")}
        action={
          <Button variant="subtle" size="xs" onClick={turnOn} disabled={turningOn}>
            Turn on
          </Button>
        }
      >
        Keep these lists current while Ajot is closed. Each update shows a notification.
      </HintRow>
    );
  }

  return null;
}

const HintRow = ({
  icon,
  action,
  onDismiss,
  children,
}: {
  icon: ReactNode;
  action: ReactNode;
  onDismiss: () => void;
  children: ReactNode;
}) => (
  <div className="mt-1.5 flex items-center gap-2 border-b border-border pb-2 text-xs text-hint [&>svg]:size-3.5 [&>svg]:shrink-0">
    {icon}
    <p className="min-w-0 flex-1 text-pretty">{children}</p>
    {action}
    <Button
      variant="subtle"
      size="xs"
      icon
      onClick={onDismiss}
      bleed="end"
      className="shrink-0"
      aria-label="Dismiss"
    >
      <X />
    </Button>
  </div>
);
