import { Component, type ReactNode, type RefObject } from "react";

const MOVE_MS = 260;
const ARRIVE_MS = 200;
const EASE_OUT = "cubic-bezier(0.16, 1, 0.3, 1)";
// More at once is a list loading or syncing in, which appears without a fade
const MAX_ARRIVALS = 3;

type Tops = Map<string, number>;

const glides = new WeakMap<Element, Animation>();

const keyedChildren = (list: HTMLElement) =>
  [...list.children].filter(
    (el): el is HTMLElement => el instanceof HTMLElement && !!el.dataset.flipKey,
  );

// Relative to the list, so a list that moves as a whole (Done, under a shrinking list) doesn't
// also move each of its rows. Includes a glide still running, so a new one starts from where it is.
const topsWithin = (list: HTMLElement): Tops => {
  const listTop = list.getBoundingClientRect().top;
  return new Map(
    keyedChildren(list).map((el) => [
      el.dataset.flipKey ?? "",
      el.getBoundingClientRect().top - listTop,
    ]),
  );
};

/**
 * Glides the children of `list` that carry a `data-flip-key` to their new places when others come,
 * go or change height above them, and with `arrivals` fades in one that comes back, as Undo does.
 * A class for getSnapshotBeforeUpdate: the old places must be read
 * just before React changes the DOM. A row that grows or shrinks on its own (its subtask field
 * opening or closing) renders without this, so a ResizeObserver catches that.
 */
export class FlipList extends Component<{
  list: RefObject<HTMLElement | null>;
  /** A new value (switching lists) shows the next render at once */
  resetKey?: string | null;
  arrivals?: boolean;
  children: ReactNode;
}> {
  private tops: Tops | null = null;
  private width = 0;
  private observer: ResizeObserver | null = null;
  private observed = new Set<Element>();

  componentDidMount() {
    const list = this.props.list.current;
    if (!list) return;
    this.observer = new ResizeObserver(() => this.onResize());
    this.settle(list, new Map(), topsWithin(list), false);
  }

  componentWillUnmount() {
    this.observer?.disconnect();
  }

  getSnapshotBeforeUpdate(prev: Readonly<FlipList["props"]>): Tops | null {
    const list = this.props.list.current;
    if (!list || prev.resetKey !== this.props.resetKey) return null;
    return topsWithin(list);
  }

  componentDidUpdate(_prev: unknown, _state: unknown, before: Tops | null) {
    const list = this.props.list.current;
    if (!list) return;
    for (const el of keyedChildren(list)) glides.get(el)?.cancel();
    const after = topsWithin(list);
    this.settle(list, before ?? after, after, !!before && !!this.props.arrivals);
  }

  private onResize() {
    const list = this.props.list.current;
    const tops = this.tops;
    if (!list || !tops) return;
    // A wider or narrower window reflows every row; they take their places without a glide
    if (list.offsetWidth !== this.width) {
      this.settle(list, new Map(), topsWithin(list), false);
      return;
    }
    const visual = topsWithin(list);
    const gliding = new Set<string>();
    for (const el of keyedChildren(list)) {
      const glide = glides.get(el);
      if (glide?.playState === "running") gliding.add(el.dataset.flipKey ?? "");
      glide?.cancel();
    }
    const after = topsWithin(list);
    const before: Tops = new Map();
    for (const [key, top] of after) {
      const was = tops.get(key);
      const glideOffset = gliding.has(key) ? (visual.get(key) ?? top) - top : 0;
      if (was !== undefined) before.set(key, was + glideOffset);
    }
    this.settle(list, before, after, false);
  }

  private settle(list: HTMLElement, before: Tops, after: Tops, arrivals: boolean) {
    this.tops = after;
    this.width = list.offsetWidth;
    const children = keyedChildren(list);
    for (const el of this.observed)
      if (!children.includes(el as HTMLElement)) {
        this.observer?.unobserve(el);
        this.observed.delete(el);
      }
    for (const el of children) {
      this.observer?.observe(el);
      this.observed.add(el);
    }
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const arrived: HTMLElement[] = [];
    for (const el of children) {
      const key = el.dataset.flipKey ?? "";
      const was = before.get(key);
      if (was === undefined) {
        arrived.push(el);
        continue;
      }
      const dy = was - (after.get(key) ?? was);
      if (reduced || Math.abs(dy) < 0.5) continue;
      glides.set(
        el,
        el.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], {
          duration: MOVE_MS,
          easing: EASE_OUT,
        }),
      );
    }

    if (!arrivals || arrived.length > MAX_ARRIVALS) return;
    for (const el of arrived) {
      // A task created just now already slides in on its own (task-enter)
      if (el.querySelector("[data-entering]")) continue;
      el.animate(
        reduced
          ? [{ opacity: 0 }, { opacity: 1 }]
          : [
              { opacity: 0, transform: "translateY(4px)" },
              { opacity: 1, transform: "none" },
            ],
        { duration: ARRIVE_MS, easing: "ease-out" },
      );
    }
  }

  render() {
    return this.props.children;
  }
}
