import { useEffect, useId, useState, type ReactNode } from "react";
import { DragDropProvider } from "@dnd-kit/react";
import { Toast } from "@base-ui/react/toast";
import { createLazyFileRoute, useRouter } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { PushTrigger } from "@newtab-todo/shared/push-payload";
import { useAuthToken } from "~/lib/auth/token";
import { getBuildTarget } from "~/lib/build-target";
import { useIsDesk } from "~/lib/hooks/use-is-desk";
import {
  fetchPushPreferences,
  isPushSubscribed,
  pushBlocker,
  registerPushSubscription,
  savePushPreferences,
  unregisterPushSubscription,
  type PushPreferences,
} from "~/lib/sync/push";
import { BuildStamp } from "~/components/BuildStamp";
import { CategorySidebar } from "~/components/category-nav/CategorySidebar";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import { Checkbox, checkboxDoneClass } from "~/components/ui/checkbox";
import { listRowVariants } from "~/components/ui/list-row";
import { SectionLabel } from "~/components/ui/section-label";
import { cn } from "~/lib/utils";
import { loadSnapshotEntry, saveSnapshot } from "~/lib/snapshot-store";
import { GROUPED_KEY } from "~/lib/notification-group";

export const Route = createLazyFileRoute("/settings")({
  component: SettingsPage,
});

const TRIGGER_LABELS: Record<PushTrigger, string> = {
  "own-changes": "You change something on another device",
  "others-changes": "Someone changes a list you share",
  shared: "Someone shares or sends you something",
  assigned: "You're assigned a task",
  updated: "A task you share is updated",
  completed: "A task you share is done",
  "contact-accepted": "Someone accepts your invite",
  reminder: "A task is due",
  overdue: "You have overdue tasks, once a day",
};

const TRIGGER_GROUPS: { label: string; triggers: PushTrigger[] }[] = [
  { label: "Changes", triggers: ["own-changes", "others-changes"] },
  {
    label: "From people",
    triggers: ["shared", "assigned", "updated", "completed", "contact-accepted"],
  },
  { label: "Reminders", triggers: ["reminder", "overdue"] },
];

const ALL_TRIGGERS = TRIGGER_GROUPS.flatMap((group) => group.triggers);

const PREFERENCES_KEY = ["push-preferences"] as const;

const BLOCKER_TEXT = {
  unsupported:
    "This browser can't keep your lists up to date while Ajot is closed. On an iPhone, add Ajot to your Home Screen first.",
  denied:
    "Notifications are blocked for Ajot, so it can't update your lists while it's closed. Allow them in your browser's site settings.",
} as const;

export function SettingsPage() {
  const router = useRouter();
  const isDesk = useIsDesk();
  const signedIn = !!useAuthToken();
  const isPwa = getBuildTarget() === "browser";

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
        <h2 className="font-display text-3xl text-foreground">Settings</h2>
      </div>

      {!isPwa ? (
        <p className="text-sm text-hint">
          Your lists stay up to date while Ajot is closed, with nothing to set up.
        </p>
      ) : !signedIn ? (
        <p className="text-sm text-hint">
          Sign in to keep your lists up to date while Ajot is closed.
        </p>
      ) : (
        <BackgroundUpdates />
      )}
      <BuildStamp />
    </div>
  );
}

const BackgroundUpdates = () => {
  const toastManager = Toast.useToastManager();
  const queryClient = useQueryClient();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [switching, setSwitching] = useState(false);
  const [blocker, setBlocker] = useState(pushBlocker);
  const [blockedOpen, setBlockedOpen] = useState(false);
  const preferences = useQuery({ queryKey: PREFERENCES_KEY, queryFn: fetchPushPreferences });

  useEffect(() => {
    isPushSubscribed().then(setEnabled).catch(console.error);
  }, []);

  const togglePush = async () => {
    // A blocked site can't ask again, so say how to unblock it instead
    if (!enabled && pushBlocker() === "denied") {
      setBlockedOpen(true);
      return;
    }
    setSwitching(true);
    try {
      if (enabled) {
        await unregisterPushSubscription();
        setEnabled(false);
      } else {
        const subscribed = await registerPushSubscription();
        setEnabled(subscribed);
        setBlocker(pushBlocker());
        if (!subscribed && pushBlocker() === "denied") setBlockedOpen(true);
      }
    } finally {
      setSwitching(false);
    }
  };

  const update = async (change: (before: PushPreferences) => PushPreferences) => {
    const before = queryClient.getQueryData<PushPreferences>(PREFERENCES_KEY);
    if (!before) return;
    const after = change(before);
    queryClient.setQueryData(PREFERENCES_KEY, after);
    try {
      await savePushPreferences(after);
    } catch {
      queryClient.setQueryData(PREFERENCES_KEY, before);
      toastManager.add({
        title: "Couldn't save that. Check your connection and try again.",
        timeout: 5000,
        data: {},
      });
    }
  };

  const toggleTrigger = (trigger: PushTrigger, on: boolean) =>
    update(({ muted, urgent }) => ({
      muted: on ? muted.filter((t) => t !== trigger) : [...muted, trigger],
      urgent,
    }));

  const muted = preferences.data?.muted;
  const preferencesDisabled = !preferences.data;

  return (
    <>
      <section className="flex flex-col gap-2">
        <div className="-mx-2 flex flex-col">
          <CheckRow
            label="Keep lists up to date while Ajot is closed"
            detail="Open Ajot offline and your lists include changes made while it was closed. Your browser shows a notification when they update."
            checked={!!enabled}
            disabled={enabled === null || switching || (!enabled && blocker === "unsupported")}
            onCheckedChange={togglePush}
          />
          {enabled && (
            <div className="flex flex-col pl-7">
              <CheckRow
                label="Update even while this device sleeps"
                detail="So your lists are current if you lose signal before you next pick it up. Turning this off saves battery, but changes may wait until you use the device again."
                checked={!!preferences.data?.urgent}
                disabled={preferencesDisabled}
                onCheckedChange={(urgent) => void update((before) => ({ ...before, urgent }))}
              />
              <NotificationChoices
                muted={muted}
                failed={preferences.isError}
                onToggle={(trigger, on) => void toggleTrigger(trigger, on)}
              />
              <GroupNotifications />
            </div>
          )}
        </div>
        {blocker && !enabled && <p className="text-sm text-hint">{BLOCKER_TEXT[blocker]}</p>}
      </section>

      <AlertDialog open={blockedOpen} onOpenChange={setBlockedOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Notifications are blocked</AlertDialogTitle>
            <AlertDialogDescription>
              Your browser only lets Ajot update your lists while it's closed if it can show a
              notification. Allow notifications in your browser's site settings, then turn this on
              again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>OK</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

// Read by this device's worker on each push, so it's saved here rather than with the server
const GroupNotifications = () => {
  const [grouped, setGrouped] = useState<boolean | null>(null);

  useEffect(() => {
    loadSnapshotEntry(GROUPED_KEY)
      .then((saved) => setGrouped(saved === true))
      .catch(() => setGrouped(false));
  }, []);

  const change = (next: boolean) => {
    setGrouped(next);
    saveSnapshot([[GROUPED_KEY, next]]).catch((err) => {
      console.error("[settings] couldn't save grouping:", err);
      setGrouped(!next);
    });
  };

  return (
    <CheckRow
      label="Group notifications into one"
      detail="Everything you haven't looked at shows in a single notification, newest first, instead of one for each task."
      checked={!!grouped}
      disabled={grouped === null}
      onCheckedChange={change}
    />
  );
};

const NotificationChoices = ({
  muted,
  failed,
  onToggle,
}: {
  muted: PushTrigger[] | undefined;
  failed: boolean;
  onToggle: (trigger: PushTrigger, on: boolean) => void;
}) => {
  const [open, setOpen] = useState(false);
  const choicesId = useId();
  const total = ALL_TRIGGERS.length;
  const on = ALL_TRIGGERS.filter((trigger) => !muted?.includes(trigger)).length;
  const summary = failed
    ? "Can't load these right now. They load again once you're online."
    : !muted
      ? undefined
      : on === total
        ? "All on"
        : on === 0
          ? "All off"
          : `${on} of ${total} on`;

  return (
    <div className="flex flex-col">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={choicesId}
        disabled={!muted}
        onClick={() => setOpen(!open)}
        className={cn(
          listRowVariants(),
          "cursor-pointer items-start text-left focus-visible:bg-muted disabled:cursor-not-allowed disabled:hover:bg-transparent touch:py-3",
        )}
      >
        <ChevronRight
          aria-hidden="true"
          className={cn(
            "mt-0.5 size-4 shrink-0 text-hint transition-transform",
            open && "rotate-90",
          )}
        />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className={cn("text-sm font-medium", muted ? "text-foreground" : "text-hint")}>
            Notifications
          </span>
          {summary && <span className="text-xs text-hint">{summary}</span>}
        </span>
      </button>
      {open && muted && (
        <div id={choicesId} className="flex flex-col gap-3 pt-1 pb-2 pl-9">
          {TRIGGER_GROUPS.map((group) => (
            <TriggerGroup key={group.label} label={group.label}>
              {group.triggers.map((trigger) => (
                <CheckRow
                  key={trigger}
                  label={TRIGGER_LABELS[trigger]}
                  checked={!muted.includes(trigger)}
                  disabled={false}
                  onCheckedChange={(next) => onToggle(trigger, next)}
                />
              ))}
            </TriggerGroup>
          ))}
          <p className="text-sm text-hint">
            You won't be notified about the ones you turn off, and this device may not get those
            changes until you next open Ajot.
          </p>
        </div>
      )}
    </div>
  );
};

const TriggerGroup = ({ label, children }: { label: string; children: ReactNode }) => (
  <fieldset className="flex min-w-0 flex-col gap-1">
    <legend className="contents">
      <SectionLabel>{label}</SectionLabel>
    </legend>
    <div className="-mx-2 flex flex-col">{children}</div>
  </fieldset>
);

type CheckRowProps = {
  label: string;
  detail?: string;
  checked: boolean;
  disabled: boolean;
  onCheckedChange: (checked: boolean) => void;
};

const CheckRow = ({ label, detail, checked, disabled, onCheckedChange }: CheckRowProps) => (
  <label
    className={cn(
      listRowVariants(),
      "cursor-pointer items-start touch:py-3",
      disabled && "cursor-not-allowed hover:bg-transparent",
    )}
  >
    <Checkbox
      checked={checked}
      disabled={disabled}
      onCheckedChange={onCheckedChange}
      // A page of settings that are all on shouldn't be a wall of solid green
      className={cn("mt-0.5", checkboxDoneClass)}
    />
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className={cn("text-sm font-medium", disabled ? "text-hint" : "text-foreground")}>
        {label}
      </span>
      {detail && <span className="text-xs text-hint">{detail}</span>}
    </span>
  </label>
);
