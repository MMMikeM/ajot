import { PointerActivationConstraints, PointerSensor } from "@dnd-kit/dom";

// The swipe tray's actions are taps, not the start of a drag
const isOnSwipeTray = (event: PointerEvent) =>
  event.target instanceof Element && event.target.closest("[data-swipe-tray]") !== null;

/**
 * The whole row is the handle. Touch: a long press picks it up, so a tap still opens the task and
 * a flick still scrolls. Mouse: moving it a few pixels does, so a click still opens the task.
 */
export const rowDragSensors = [
  PointerSensor.configure({
    activationConstraints: (event) =>
      event.pointerType === "touch"
        ? [new PointerActivationConstraints.Delay({ value: 250, tolerance: 5 })]
        : [new PointerActivationConstraints.Distance({ value: 5 })],
    preventActivation: isOnSwipeTray,
  }),
];
