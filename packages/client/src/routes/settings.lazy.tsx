import { useEffect, useState, type ReactNode } from "react";
import { DragDropProvider } from "@dnd-kit/react";
import { Toast } from "@base-ui/react/toast";
import { createLazyFileRoute, useRouter } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";
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

const PREFERENCES_KEY = ["push-preferences"] as const;

const BLOCKER_TEXT = {
  unsupported:
    "This browser can't update Ajot in the background. On an iPhone, add Ajot to your Home Screen first.",
  denied: "Notifications are blocked for Ajot. Allow them in your browser's site settings.",
} as const;

export function SettingsPage() {
  const router = useRouter();
  const isDesk = useIsDesk();
  const signedIn = !!useAuthToken();
  const isPwa = getBuildTarget() === "browser";

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
        <h2 className="font-display text-[1.75rem] leading-tight text-foreground">Settings</h2>
      </div>

      {!isPwa ? (
        <p className="text-sm text-hint">
          The extension keeps your lists up to date in the background on its own.
        </p>
      ) : !signedIn ? (
        <p className="text-sm text-hint">Sign in to update this device in the background.</p>
      ) : (
        <BackgroundUpdates />
      )}
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
  const preferencesDisabled = !enabled || !preferences.data;

  return (
    <>
      <section className="flex flex-col gap-2">
        <div className="-mx-2 flex flex-col">
          <CheckRow
            label="Update in the background"
            detail="Keeps this device's lists current while Ajot is closed, so they're there offline. Browsers show a notification for each update."
            checked={!!enabled}
            disabled={enabled === null || switching || (!enabled && blocker === "unsupported")}
            onCheckedChange={togglePush}
          />
        </div>
        {blocker && !enabled && <p className="text-sm text-hint">{BLOCKER_TEXT[blocker]}</p>}
      </section>

      <AlertDialog open={blockedOpen} onOpenChange={setBlockedOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Notifications are blocked</AlertDialogTitle>
            <AlertDialogDescription>
              Browsers only let Ajot update in the background by showing a notification, and they're
              blocked for Ajot. Allow notifications in your browser's site settings, then turn this
              on again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>OK</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <TriggerGroup label="Delivery">
        <CheckRow
          label="Deliver right away"
          detail="Wakes this device for each update, so its lists are current before you go offline. Turn off to save battery: an idle phone may hold updates until it next wakes."
          checked={!!preferences.data?.urgent}
          disabled={preferencesDisabled}
          onCheckedChange={(urgent) => void update((before) => ({ ...before, urgent }))}
        />
      </TriggerGroup>

      {TRIGGER_GROUPS.map((group) => (
        <TriggerGroup key={group.label} label={group.label}>
          {group.triggers.map((trigger) => (
            <CheckRow
              key={trigger}
              label={TRIGGER_LABELS[trigger]}
              checked={!!muted && !muted.includes(trigger)}
              disabled={preferencesDisabled}
              onCheckedChange={(on) => void toggleTrigger(trigger, on)}
            />
          ))}
        </TriggerGroup>
      ))}

      <p className="text-sm text-hint">
        {preferences.isError
          ? "Can't load these right now. They load again once you're online."
          : "Turn one off and this device catches up when you next open Ajot instead."}
      </p>
    </>
  );
};

const TriggerGroup = ({ label, children }: { label: string; children: ReactNode }) => (
  <fieldset className="flex flex-col gap-1">
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
