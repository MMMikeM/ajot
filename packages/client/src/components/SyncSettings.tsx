import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { useRouter, useRouterState } from "@tanstack/react-router";
import { Toast } from "@base-ui/react/toast";
import { useAuthToken } from "~/lib/auth/token";
import { useCurrentUser } from "~/lib/auth/current-user";
import { clearSession, onSessionExpired } from "~/lib/auth/session";
import {
  registerPushSubscription,
  unregisterPushSubscription,
  isPushSubscribed,
} from "~/lib/sync/push";
import { logout } from "~/lib/actions";
import { getBuildTarget } from "~/lib/build-target";
import { useSyncState, usePendingMutations } from "~/lib/sync/sse";
import { useInstallPrompt } from "~/lib/hooks/use-install-prompt";
import { Button } from "~/components/ui/button";
import { MenuItem } from "~/components/ui/menu-item";
import { Popover, PopoverTrigger, PopoverContent } from "~/components/ui/popover";
import { cn } from "~/lib/utils";

const SYNC_LABELS = {
  connecting: "Syncing…",
  disconnected: "Offline · saved here",
  connected: "Sync",
} as const;

export const SyncSettings = () => {
  const token = useAuthToken();
  const currentUser = useCurrentUser();
  const syncState = useSyncState();
  const hasPending = usePendingMutations();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const { canInstall, install } = useInstallPrompt();
  const toastManager = Toast.useToastManager();

  useEffect(() => {
    isPushSubscribed().then(setPushEnabled).catch(console.error);
  }, []);

  useEffect(
    () =>
      onSessionExpired(() => {
        setOpen(false);
        toastManager.add({
          title: "Your session expired. Sign in again to sync your changes.",
          timeout: 8000,
          data: {},
        });
      }),
    [],
  );

  const handleTogglePush = async () => {
    if (pushEnabled) {
      await unregisterPushSubscription();
      setPushEnabled(false);
    } else {
      const ok = await registerPushSubscription();
      setPushEnabled(ok);
    }
  };

  const handleLogout = async () => {
    // The server only drops the subscription while the session is still valid.
    await unregisterPushSubscription();
    await logout();
    clearSession();
    setPushEnabled(false);
    setOpen(false);
  };

  const isAuthPage = useRouterState({ select: (s) => s.location.pathname === "/auth" });

  if (!token) {
    if (isAuthPage) return null;
    return (
      <Button
        variant="ghost"
        size="xs"
        className="relative touch:h-9 touch:px-3 touch:text-sm touch:after:absolute touch:after:inset-x-0 touch:after:-inset-y-1"
        onClick={() => router.navigate({ to: "/auth" })}
      >
        Sign in
      </Button>
    );
  }

  const isOffline = syncState === "disconnected";
  const syncLabel = hasPending && !isOffline ? "Syncing…" : SYNC_LABELS[syncState];

  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="xs"
            // after: 44px touch target without growing the header
            className="relative gap-1.5 text-hint hover:text-muted-foreground touch:h-9 touch:px-3 touch:after:absolute touch:after:inset-x-0 touch:after:-inset-y-1"
            aria-label={`Sync settings: ${isOffline ? "offline, changes saved on this device" : syncLabel}`}
          />
        }
      >
        <span
          className={cn(
            "size-1.5 shrink-0 rounded-full transition-colors",
            // Hollow rather than red: offline loses nothing, so it shouldn't read as an error
            isOffline
              ? "border border-hint"
              : hasPending || syncState === "connecting"
                ? "animate-pulse bg-pending"
                : "bg-primary",
          )}
        />
        <span>{syncLabel}</span>
      </PopoverTrigger>

      {currentUser && (
        // backdrop: the tap that dismisses the menu shouldn't also open the task underneath
        <PopoverContent
          align="end"
          sideOffset={8}
          backdrop
          aria-label="Account"
          className="flex min-w-[200px] flex-col p-2"
        >
          <div className="flex flex-col gap-0.5 px-2.5 pt-1 pb-2">
            <span className="text-sm font-medium text-foreground">{currentUser.name}</span>
            <span className="text-xs text-hint">@{currentUser.username}</span>
          </div>
          {isOffline && (
            <p className="max-w-52 px-2.5 pb-2 text-xs text-hint">
              You're offline. Changes stay on this device and sync once you're back.
            </p>
          )}
          <div className="mb-1 h-px bg-border" />
          {getBuildTarget() === "browser" && canInstall && (
            <MenuItem onClick={install}>Add to Home Screen</MenuItem>
          )}
          {getBuildTarget() === "browser" && (
            <MenuItem onClick={handleTogglePush}>
              {pushEnabled ? (
                <>
                  Background sync on
                  <Check data-icon="inline-end" className="ml-auto text-primary" />
                </>
              ) : (
                "Enable background sync"
              )}
            </MenuItem>
          )}
          <MenuItem
            onClick={() => {
              void router.navigate({ to: "/people" });
              setOpen(false);
            }}
          >
            People
          </MenuItem>
          <MenuItem intent="destructive" onClick={handleLogout}>
            Sign out
          </MenuItem>
          <div className="my-1 h-px bg-border" />
          <span className="px-2.5 pb-0.5 text-[10px] text-hint">{__BUILD_VERSION__}</span>
        </PopoverContent>
      )}
    </Popover>
  );
};
