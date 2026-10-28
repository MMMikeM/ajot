import {
  type CSSProperties,
  type RefObject,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Toast } from "@base-ui/react/toast";
import { X } from "lucide-react";
import { Button } from "~/components/ui/button";
import { UNDO_KEYS, pressUndo, type ToastData } from "~/lib/undo-toast";
import { cn } from "~/lib/utils";

const DURATION = 5000;

type ToastObject = Toast.Root.ToastObject<ToastData>;

const subscribeVisibility = (onChange: () => void) => {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
};
const usePageHidden = () => useSyncExternalStore(subscribeVisibility, () => document.hidden);

/** Whether the window has lost focus: Base UI pauses toast timers for exactly as long. */
const useWindowBlurred = () => {
  const [blurred, setBlurred] = useState(false);
  useEffect(() => {
    const onBlur = (e: FocusEvent) => {
      if (e.target === window) setBlurred(true);
    };
    const onFocus = (e: FocusEvent) => {
      if (e.target === window) setBlurred(false);
    };
    window.addEventListener("blur", onBlur, true);
    window.addEventListener("focus", onFocus, true);
    return () => {
      window.removeEventListener("blur", onBlur, true);
      window.removeEventListener("focus", onFocus, true);
    };
  }, []);
  return blurred;
};

/** How long the countdown bar has run: it pauses whenever the toast's timer does. */
const countdownElapsed = (bar: HTMLElement | null) => {
  const time = bar?.getAnimations()[0]?.currentTime;
  return typeof time === "number" ? time : 0;
};

/**
 * A phone switching apps may only hide the page, without the window blur that pauses Base UI's
 * timers, and Base UI has no way to pause them from outside. So hiding the page takes the toast's
 * timeout away, which stops its timer, and showing it again gives back what the bar has left.
 */
const usePauseWhileHidden = (
  toast: ToastObject,
  duration: number,
  bar: RefObject<HTMLDivElement | null>,
) => {
  const { update, close } = Toast.useToastManager<ToastData>();
  const hidden = usePageHidden();
  const remaining = useRef<number | null>(null);
  useEffect(() => {
    if (duration <= 0) return;
    if (hidden) {
      remaining.current ??= duration - countdownElapsed(bar.current);
      update(toast.id, { timeout: 0 });
      return;
    }
    const left = remaining.current;
    if (left === null) return;
    // After Base UI handles the window focus that can come with showing the page: a timer
    // started before it knows the window is focused starts paused, and nothing would resume it
    const resume = window.setTimeout(() => {
      remaining.current = null;
      if (left > 0) update(toast.id, { timeout: left });
      else close(toast.id);
    });
    return () => window.clearTimeout(resume);
  }, [hidden, duration, toast.id, update, close, bar]);
  return hidden;
};

function ToastItem({ toast, windowBlurred }: { toast: ToastObject; windowBlurred: boolean }) {
  // The timeout it was added with: hiding the page sets it to 0 to stop the timer
  const [duration] = useState(() => toast.timeout ?? DURATION);
  const bar = useRef<HTMLDivElement>(null);
  const hidden = usePauseWhileHidden(toast, duration, bar);
  const away = hidden || windowBlurred;
  const named = toast.data?.named;
  const onUndo = toast.data?.onUndo;
  return (
    <Toast.Root
      toast={toast}
      // Presence-only attribute — queried by handleDelete's view transition callback
      // to assign viewTransitionName after flushSync renders the portal.
      data-toast-undo=""
      className={cn(
        "group/toast",
        // Base UI sets --toast-index, --toast-height, etc.
        "[--gap:0.75rem] [--peek:0.625rem]",
        "[--scale:calc(max(0,1-(var(--toast-index)*0.075)))]",
        "[--height:var(--toast-frontmost-height,var(--toast-height))]",
        "absolute right-0 bottom-0 left-0 w-full origin-bottom select-none",
        "z-[calc(1000-var(--toast-index))]",
        // A toast behind keeps its own height and sits so its top peeks above the front one's,
        // then is clipped to the front one's height, so stacking never changes a toast's size
        "[--stacked:translateX(var(--toast-swipe-movement-x))_translateY(calc(var(--toast-swipe-movement-y)-(var(--toast-index)*var(--peek))-var(--height)+(var(--scale)*var(--toast-height))))_scale(var(--scale))]",
        "[transform:var(--stacked)]",
        "[--behind:min(1,var(--toast-index))]",
        "[clip-path:inset(-2rem_-2rem_calc((var(--toast-height)-var(--height))*var(--behind)-2rem*(1-var(--behind)))_-2rem)]",
        // Hover-gap bridge so pointer can reach lower toasts
        "after:absolute after:top-full after:left-0 after:h-[calc(var(--gap)+1px)] after:w-full after:content-['']",
        "overflow-hidden rounded-lg border border-border bg-card shadow-lg",
        "data-[starting-style]:[transform:translateY(150%)]",
        "data-[ending-style]:opacity-0",
        "data-[limited]:opacity-0",
        "[&[data-ending-style]:not([data-limited]):not([data-swipe-direction])]:[transform:translateY(150%)]",
        "data-[ending-style]:data-[swipe-direction=right]:[transform:translateX(calc(var(--toast-swipe-movement-x)+150%))_translateY(0)]",
        "data-[ending-style]:data-[swipe-direction=left]:[transform:translateX(calc(var(--toast-swipe-movement-x)-150%))_translateY(0)]",
        "data-[ending-style]:data-[swipe-direction=up]:[transform:translateY(calc(var(--toast-swipe-movement-y)-150%))]",
        "data-[ending-style]:data-[swipe-direction=down]:[transform:translateY(calc(var(--toast-swipe-movement-y)+150%))]",
        "[transition:transform_0.5s_cubic-bezier(0.22,1,0.36,1),opacity_0.5s,clip-path_0.5s_cubic-bezier(0.22,1,0.36,1)]",
        "motion-reduce:data-[starting-style]:[transform:var(--stacked)] motion-reduce:data-[starting-style]:opacity-0",
        "motion-reduce:[&[data-ending-style]:not([data-limited]):not([data-swipe-direction])]:[transform:var(--stacked)]",
      )}
    >
      <Toast.Content className="py-2.5 pr-2.5 pl-4">
        <div className="flex items-center gap-2 text-sm">
          {/* select-text: the invite fallback toast holds a link to copy */}
          <Toast.Title
            className={cn(
              "min-w-0 flex-1 [overflow-wrap:anywhere] text-hint select-text",
              named && "flex whitespace-pre",
            )}
          >
            {named && (
              <>
                {named.before}
                <bdi className="min-w-0 truncate">{named.name}</bdi>
                {/* Shrinks too, in proportion: a long ending can't squeeze the name out or run
                    under Undo on a narrow phone */}
                <span className="min-w-0 truncate">{named.after}</span>
              </>
            )}
          </Toast.Title>
          {onUndo && (
            <Toast.Action
              render={<Button variant="link" className="h-8 px-2 touch:h-9" />}
              aria-keyshortcuts={UNDO_KEYS}
              onClick={() => pressUndo(toast.id, onUndo)}
            >
              Undo
            </Toast.Action>
          )}
          <Toast.Close render={<Button variant="subtle" size="xs" icon aria-label="Dismiss" />}>
            <X className="size-3.5" />
          </Toast.Close>
        </div>
        {/* Pauses with the toast (data-expanded, or the window away); persistent toasts get no bar.
            Invisible rather than gone under reduced motion: it still measures the time left. */}
        {duration > 0 && (
          <div
            ref={bar}
            data-away={away || undefined}
            className="absolute bottom-0 left-0 h-0.5 w-full origin-left animate-[toast-progress_var(--toast-duration)_linear_forwards] bg-primary/40 group-data-[expanded]/toast:[animation-play-state:paused] data-[away]:[animation-play-state:paused] motion-reduce:invisible"
            style={{ "--toast-duration": `${duration}ms` } as CSSProperties}
          />
        )}
      </Toast.Content>
    </Toast.Root>
  );
}

export const Toasts = () => {
  const { toasts } = Toast.useToastManager<ToastData>();
  const windowBlurred = useWindowBlurred();
  return toasts.map((toast) => (
    <ToastItem key={toast.id} toast={toast} windowBlurred={windowBlurred} />
  ));
};

export { Toast };
