import { useEffect, useRef, useState } from "react";
import { nanoid } from "nanoid";
import { ChevronDown } from "lucide-react";
import { AddTaskInput } from "./add-input";
import { useCategories } from "~/lib/db/hooks";
import { CollabBadge } from "~/components/category-nav/CollabBadge";
import { addTask } from "~/lib/db/add-task";
import { useOptimisticUserId } from "~/lib/auth/current-user";
import { useActiveCategoryId } from "~/lib/state/active-category";
import { useNavContext } from "~/lib/state/nav-context";
import { INBOX_COLOR } from "~/lib/constants";
import { ColorDot } from "~/components/ui/color-dot";
import { revealWhenShown } from "./reveal-added";

// Fixed overlays (toasts) read the height to sit above the bar on touch
const useInputBarHeightVar = () => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    const observer = new ResizeObserver(() =>
      root.style.setProperty("--input-bar-h", `${el.offsetHeight}px`),
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--input-bar-h");
    };
  }, []);
  return ref;
};

export function TaskInputBar() {
  const activeCategoryId = useActiveCategoryId();
  const currentUserId = useOptimisticUserId();
  const { data: rawCategories } = useCategories();
  const { setNavOpen } = useNavContext();
  const barRef = useInputBarHeightVar();

  const activeCategory = activeCategoryId
    ? ((rawCategories ?? []).find((c) => c.id === activeCategoryId) ?? null)
    : null;

  const listName = activeCategory?.name ?? "Inbox";
  // Keyed per add, so a second "Added to Inbox" is a new node and is announced again
  const [added, setAdded] = useState({ count: 0, listName: "" });

  const handleAdd = (title: string) => {
    const id = nanoid();
    revealWhenShown(id, () => setAdded((prev) => ({ count: prev.count + 1, listName })));
    void addTask(title, activeCategoryId ?? null, null, id);
  };

  return (
    // The keyboard covers the home indicator while typing
    <div
      ref={barRef}
      className="touch:order-2 touch:-mx-(--gutter) touch:shrink-0 touch:border-t touch:border-ghost touch:px-(--gutter) touch:pt-2 touch:pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] touch:focus-within:pb-3"
    >
      <button
        data-testid="category-input-chip"
        onClick={() => setNavOpen(true)}
        aria-label={`Adding to ${listName}. Change list`}
        className="relative -ml-2 hidden h-9 max-w-full items-center gap-2 rounded-full px-2 text-sm transition-colors after:absolute after:inset-x-0 after:-inset-y-1 active:bg-muted touch:flex"
      >
        <ColorDot color={activeCategory ? (activeCategory.color ?? undefined) : INBOX_COLOR} />
        <span className="truncate font-medium text-foreground">{listName}</span>
        {activeCategory && <CollabBadge category={activeCategory} currentUserId={currentUserId} />}
        <ChevronDown size={14} className="shrink-0 text-hint" />
      </button>
      <AddTaskInput onAdd={handleAdd} />
      <output data-testid="add-status" className="sr-only">
        {added.count > 0 && <span key={added.count}>Added to {added.listName}</span>}
      </output>
    </div>
  );
}
