import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useRouter, useRouterState } from "@tanstack/react-router";
import { Toast } from "@base-ui/react/toast";
import { useAuthToken } from "~/lib/auth/token";
import { useCurrentUser } from "~/lib/auth/current-user";
import { onSessionExpired } from "~/lib/auth/session";
import { signOut } from "~/lib/actions";
import { getBuildTarget } from "~/lib/build-target";
import { useSyncState, usePendingMutations } from "~/lib/sync/sse";
import { useInstallPrompt } from "~/lib/hooks/use-install-prompt";
import { Button } from "~/components/ui/button";
import { MenuItem } from "~/components/ui/menu-item";
import { Popover, PopoverTrigger, PopoverContent } from "~/components/ui/popover";
import { cn } from "~/lib/utils";

// The device's own connection, as distinct from whether the sync server answers
const subscribeOnline = (onChange: () => void) => {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
};
const useDeviceOnline = () =>
  useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );

const SYNC_LABELS = {
  connecting: "Syncing…",
  disconnected: "Offline · saved here",
  connected: "Sync",
} as const;

/**
 * What a screen reader hears when sync goes offline or comes back. Silent for the state the page
 * opens in, and while a reconnect is still being tried. "Back online" only once the device itself
 * was offline: a server that answers again after refusing is "Syncing again".
 */
const useSyncAnnouncement = (syncState: keyof typeof SYNC_LABELS, deviceOnline: boolean) => {
  const [announcement, setAnnouncement] = useState("");
  const wasOffline = useRef<boolean | null>(null);
  const deviceWentOffline = useRef(!deviceOnline);
  useEffect(() => {
    if (!deviceOnline) deviceWentOffline.current = true;
    if (syncState === "connecting") return;
    const offline = syncState === "disconnected";
    if (wasOffline.current !== null && wasOffline.current !== offline) {
      setAnnouncement(
        offline
          ? `${deviceOnline ? "Not syncing" : "Offline"}, changes saved on this device`
          : deviceWentOffline.current
            ? "Back online"
            : "Syncing again",
      );
    }
    wasOffline.current = offline;
    if (!offline) deviceWentOffline.current = false;
  }, [syncState, deviceOnline]);
  return announcement;
};

export const SyncSettings = () => {
  const token = useAuthToken();
  const currentUser = useCurrentUser();
  const syncState = useSyncState();
  const deviceOnline = useDeviceOnline();
  const hasPending = usePendingMutations();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { canInstall, install } = useInstallPrompt();
  const toastManager = Toast.useToastManager();
  const syncAnnouncement = useSyncAnnouncement(syncState, deviceOnline);

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

  const handleLogout = () => {
    void signOut();
    setOpen(false);
  };

  const isAuthPage = useRouterState({ select: (s) => s.location.pathname === "/auth" });

  if (!token) {
    if (isAuthPage) return null;
    return (
      <Button
        variant="ghost"
        size="xs"
        className="touch:text-sm desk:-mr-2.5"
        onClick={() => router.navigate({ to: "/auth" })}
      >
        Sign in
      </Button>
    );
  }

  const isOffline = syncState === "disconnected";
  // Online but not syncing is the server or the sign-in, not something waiting will fix
  const unreachable = isOffline && deviceOnline;
  const syncLabel = unreachable
    ? "Not syncing · saved here"
    : hasPending && !isOffline
      ? "Syncing…"
      : SYNC_LABELS[syncState];

  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="xs"
            className="gap-1.5 text-hint hover:text-muted-foreground desk:-mr-2.5"
            aria-label={`Sync settings: ${syncLabel}${isOffline ? ", changes saved on this device" : ""}`}
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
          className="flex min-w-50 flex-col p-2"
        >
          <div className="flex flex-col gap-0.5 px-2.5 pt-1 pb-2">
            <span dir="auto" className="text-sm font-medium text-foreground">
              {currentUser.name}
            </span>
            <span className="text-xs text-hint">@{currentUser.username}</span>
          </div>
          {isOffline && (
            <p className="max-w-52 px-2.5 pb-2 text-xs text-hint">
              {unreachable
                ? "Can't reach Ajot's server. Your changes are saved on this device and will sync once it's back."
                : "You're offline. Your changes are saved on this device and will sync once you're back online."}
            </p>
          )}
          <div className="mb-1 h-px bg-border" />
          {getBuildTarget() === "browser" && canInstall && (
            <MenuItem onClick={install}>Add to Home Screen</MenuItem>
          )}
          <MenuItem
            onClick={() => {
              void router.navigate({ to: "/people" });
              setOpen(false);
            }}
          >
            People
          </MenuItem>
          {getBuildTarget() === "browser" && (
            <MenuItem
              onClick={() => {
                void router.navigate({ to: "/settings" });
                setOpen(false);
              }}
            >
              Settings
            </MenuItem>
          )}
          <MenuItem intent="destructive" onClick={handleLogout}>
            Sign out
          </MenuItem>
          <div className="my-1 h-px bg-border" />
          <span className="px-2.5 pb-0.5 text-xs text-hint tabular-nums">{__BUILD_VERSION__}</span>
        </PopoverContent>
      )}
      {/* On body, so it stays audible while a sheet hides the page */}
      {createPortal(
        <output aria-live="polite" data-testid="sync-status" className="sr-only">
          {syncAnnouncement}
        </output>,
        document.body,
      )}
    </Popover>
  );
};
