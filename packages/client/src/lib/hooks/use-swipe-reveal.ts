import { useEffect, useRef, useState } from "react";

const OPEN_THRESHOLD = 60;
const SNAP_MS = 200;
const HINT_SEEN_KEY = "newtab-todo-swipe-hint-seen";

// Module-level so opening one row can close all the others
const closeRegistry = new Set<() => void>();

/**
 * Attaches non-passive touchmove (required for preventDefault) via useEffect
 * rather than React synthetic events so we can actually stop scroll during
 * a horizontal swipe. Transform is applied directly to the DOM to avoid
 * per-pixel re-renders during drag — state only changes on snap.
 *
 * The tray slides in over the row's end rather than pushing the row aside, so the start of the
 * title stays in view and says which task the actions are for.
 *
 * `data-swiping` marks a row that is dragged, open or settling, so it's opaque only then.
 * `hint` peeks the tray once per device.
 *
 * Usage:
 *   const swipe = useSwipeReveal(disabled, hint);
 *   <div ref={swipe.containerRef} className="relative overflow-hidden"> // touch events + outside-tap guard
 *     <div>…</div>                                  // the row, which stays put
 *     <div ref={swipe.trayRef} className="absolute right-0 z-1 translate-x-full ..."> // sized by its actions
 *
 * `translate-x-full` parks the tray past the row's end; the hook's inline transform (0 down to
 * minus the tray's width) composes with it to pull the tray in.
 */
export const useSwipeReveal = (disabled = false, hint = false) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const trayRef = useRef<HTMLDivElement>(null);
  // Read at gesture time: the tray holds one to three actions, and it's invisible but laid out
  // Unrounded, unlike offsetWidth, so pulling it in by this undoes translate-x-full exactly
  const trayWidth = () => trayRef.current?.getBoundingClientRect().width ?? 0;
  // Measured once per gesture: reading it on each move would force a layout every frame
  const gestureWidth = useRef(0);

  const [isOpen, setIsOpen] = useState(false);

  const isOpenRef = useRef(false);
  const isDraggingRef = useRef(false);
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const currentPx = useRef(0);
  const settleTimer = useRef<number | undefined>(undefined);

  const markSwiping = () => {
    window.clearTimeout(settleTimer.current);
    const container = containerRef.current;
    if (container) container.dataset.swiping = "";
  };

  // After the snap back, or the row turns transparent mid-slide
  const clearSwipingAfter = (ms: number) => {
    window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => {
      const container = containerRef.current;
      if (container && currentPx.current === 0 && !isDraggingRef.current)
        delete container.dataset.swiping;
    }, ms);
  };

  const close = () => {
    const el = trayRef.current;
    if (el) {
      el.style.transition = `transform ${SNAP_MS}ms ease-out`;
      el.style.transform = "translateX(0px)";
    }
    currentPx.current = 0;
    isOpenRef.current = false;
    setIsOpen(false);
    clearSwipingAfter(SNAP_MS);
  };

  useEffect(() => {
    if (disabled) return;
    const container = containerRef.current;
    if (!container) return;

    closeRegistry.add(close);

    const onTouchStart = (e: TouchEvent) => {
      touchStartX.current = e.touches[0].clientX;
      touchStartY.current = e.touches[0].clientY;
      isDraggingRef.current = false;
      gestureWidth.current = trayWidth();
    };

    const onTouchMove = (e: TouchEvent) => {
      if (touchStartX.current === null || touchStartY.current === null) return;

      const dx = e.touches[0].clientX - touchStartX.current;
      const dy = e.touches[0].clientY - touchStartY.current;

      if (!isDraggingRef.current) {
        // Yield vertical gestures to the list's scroll, and a touch already claimed: a long-press
        // drag cancels the moves it takes before they bubble up here
        if (Math.abs(dy) > Math.abs(dx) || e.defaultPrevented) {
          touchStartX.current = null;
          return;
        }
        if (Math.abs(dx) > 6) {
          isDraggingRef.current = true;
          markSwiping();
          const el = trayRef.current;
          if (el) el.style.transition = "none";
        }
      }

      if (!isDraggingRef.current) return;
      e.preventDefault(); // stop scroll — requires non-passive listener

      const width = gestureWidth.current;
      const base = isOpenRef.current ? -width : 0;
      const next = Math.min(0, Math.max(-width, base + dx));
      currentPx.current = next;
      const el = trayRef.current;
      if (el) el.style.transform = `translateX(${next}px)`;
    };

    const onTouchEnd = () => {
      if (!isDraggingRef.current) {
        touchStartX.current = null;
        return;
      }

      const width = gestureWidth.current;
      // A one-action tray is barely wider than the usual threshold
      const threshold = Math.min(OPEN_THRESHOLD, width / 2);
      const pastOpenThreshold = currentPx.current < -threshold;
      const keepsOpen = currentPx.current > -(width - threshold);
      const shouldOpen = isOpenRef.current ? keepsOpen : pastOpenThreshold;

      if (shouldOpen) {
        closeRegistry.forEach((fn) => {
          if (fn !== close) fn();
        });
      }

      const el = trayRef.current;
      if (el) {
        el.style.transition = `transform ${SNAP_MS}ms ease-out`;
        el.style.transform = shouldOpen ? `translateX(${-width}px)` : "translateX(0px)";
      }

      currentPx.current = shouldOpen ? -width : 0;
      isOpenRef.current = shouldOpen;
      setIsOpen(shouldOpen);
      isDraggingRef.current = false;
      touchStartX.current = null;
      if (!shouldOpen) clearSwipingAfter(SNAP_MS);
    };

    container.addEventListener("touchstart", onTouchStart, { passive: true });
    container.addEventListener("touchmove", onTouchMove, { passive: false });
    container.addEventListener("touchend", onTouchEnd, { passive: true });

    return () => {
      container.removeEventListener("touchstart", onTouchStart);
      container.removeEventListener("touchmove", onTouchMove);
      container.removeEventListener("touchend", onTouchEnd);
      closeRegistry.delete(close);
    };
  }, [disabled]);

  useEffect(() => {
    if (!isOpen || disabled) return;
    const onOutside = (e: TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        close();
      }
    };
    document.addEventListener("touchstart", onOutside, { passive: true });
    return () => document.removeEventListener("touchstart", onOutside);
  }, [isOpen, disabled]);

  useEffect(() => {
    if (disabled || !hint) return;
    if (localStorage.getItem(HINT_SEEN_KEY)) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let peeking = false;
    let returnTimer: number | undefined;
    const startTimer = window.setTimeout(() => {
      const el = trayRef.current;
      if (!el || isOpenRef.current || isDraggingRef.current) return;
      localStorage.setItem(HINT_SEEN_KEY, "1");
      peeking = true;
      markSwiping();
      el.style.transition = "transform 420ms cubic-bezier(0.22, 1, 0.36, 1)";
      el.style.transform = `translateX(${-trayWidth()}px)`;
      returnTimer = window.setTimeout(() => {
        peeking = false;
        if (isOpenRef.current || isDraggingRef.current) return;
        el.style.transition = "transform 320ms ease-in-out";
        el.style.transform = "translateX(0px)";
        clearSwipingAfter(320);
      }, 1400);
    }, 1000);

    return () => {
      window.clearTimeout(startTimer);
      window.clearTimeout(returnTimer);
      const el = trayRef.current;
      if (peeking && el && !isOpenRef.current && !isDraggingRef.current) {
        el.style.transform = "translateX(0px)";
        clearSwipingAfter(0);
      }
    };
  }, [disabled, hint]);

  return {
    containerRef,
    trayRef,
    isOpen,
    close,
  };
};
