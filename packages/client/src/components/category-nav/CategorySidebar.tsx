import { useEffect, useState, type ReactNode, type RefCallback } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useSortable } from "@dnd-kit/react/sortable";
import { useDroppable } from "@dnd-kit/react";
import { Ellipsis, Plus, Search, Settings as SettingsIcon, UsersRound } from "lucide-react";
import { INBOX_COLOR, CATEGORY_DROP_PREFIX } from "~/lib/constants";
import { Popover, PopoverTrigger, PopoverContent } from "~/components/ui/popover";
import { CategoryCollabSheet } from "~/components/CategoryCollabSheet";
import { CollabBadge } from "./CollabBadge";
import { Input } from "~/components/ui/field";
import { MAX_NAME } from "@newtab-todo/shared/field-limits";
import { ColorDot } from "~/components/ui/color-dot";
import { setActiveCategoryId } from "~/lib/state/active-category";
import { useCurrentUserId } from "~/lib/auth/current-user";
import { getBuildTarget } from "~/lib/build-target";
import { isListPath } from "~/lib/list-path";
import { cn } from "~/lib/utils";
import { navRow } from "./nav-row";
import type { Category } from "~/lib/types";
import { useCategoryNavState } from "./use-category-nav-state";
import { useCategoryActions } from "./use-category-actions";
import { CategoryOptionsContent } from "./CategoryOptionsContent";
import { DeleteCategoryDialog } from "./DeleteCategoryDialog";
import { SharedWithMeGroup } from "./SharedWithMeGroup";

// Fixed width even when empty, so counts line up down the sidebar
const OpenCount = ({ count, className }: { count: number; className?: string }) => (
  <span className={cn("ml-auto w-5 shrink-0 text-right text-xs text-hint tabular-nums", className)}>
    {count > 0 && (
      <>
        {count}
        <span className="sr-only"> open</span>
      </>
    )}
  </span>
);

const ActiveBar = ({ color }: { color?: string | null }) => (
  <span
    className="absolute top-1/2 left-0 h-3.5 w-0.5 -translate-y-1/2 rounded-full"
    style={{ backgroundColor: color ?? "var(--primary)" }}
  />
);

/** An icon in the colour dots' column, so the labels beside it line up with the list names */
const NavIcon = ({ children }: { children: ReactNode }) => (
  <span className="flex w-1.5 shrink-0 justify-center [&_svg]:shrink-0">{children}</span>
);

function SortablePill({
  id,
  index,
  disabled,
  children,
}: {
  id: string;
  index: number;
  disabled: boolean;
  children: (ref: RefCallback<HTMLElement>) => ReactNode;
}) {
  const { ref } = useSortable({ id, index, type: "category", disabled });
  return <>{children(ref)}</>;
}

function DroppablePill({
  categoryId,
  activeCategoryId,
  disabled,
  children,
}: {
  categoryId: string;
  activeCategoryId: string | null;
  disabled: boolean;
  children: (ref: RefCallback<HTMLElement>, isDropTarget: boolean) => ReactNode;
}) {
  const { ref, isDropTarget } = useDroppable({
    id: `${CATEGORY_DROP_PREFIX}${categoryId}`,
    accept: "task",
    disabled: disabled || categoryId === activeCategoryId,
  });
  return <>{children(ref, isDropTarget)}</>;
}

/**
 * `/` opens search, unless something is being typed: the capture input is focused on every new tab,
 * so it only counts once it holds text. Not over an open sheet, which has fields of its own.
 */
const useSearchShortcut = () => {
  const navigate = useNavigate();
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      const field = target?.closest<HTMLInputElement>("input, textarea, [contenteditable='true']");
      if (field && !(field.id === "add-task-input" && !field.value)) return;
      if (document.querySelector('[data-slot="drawer-content"]')) return;
      e.preventDefault();
      void navigate({ to: "/search" });
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [navigate]);
};

// Outside the task list (People), lists can't be reordered: the drop handling lives with the list
export function CategorySidebar({ reorderable = true }: { reorderable?: boolean }) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const {
    categories,
    activeCategoryId,
    currentUserId,
    inboxCount,
    openCounts,
    handleAdd,
    handleRename,
    handleSetColor,
    handleDelete,
    handleLeave,
    deleteDialog,
  } = useCategoryActions();
  const {
    renamingId,
    renameValue,
    setRenameValue,
    sharingCategoryId,
    setSharingCategoryId,
    submitRename,
    startRename,
    renameRef,
  } = useCategoryNavState(handleRename);

  const signedIn = useCurrentUserId() !== null;
  useSearchShortcut();

  const navigate = useNavigate();
  const onListPage = useRouterState({ select: (s) => isListPath(s.location.pathname) });
  const openList = (categoryId: string | null) => {
    setActiveCategoryId(categoryId);
    if (!onListPage) void navigate({ to: "/" });
  };

  const ownedCategories = categories.filter((c) => c.userId === currentUserId);
  const sharedCategories = categories.filter((c) => c.userId !== currentUserId);

  const renderPill = (cat: Category, index: number) => {
    const isOwned = cat.userId === currentUserId;
    const isActive = onListPage && activeCategoryId === cat.id;

    if (renamingId === cat.id) {
      return (
        <form
          key={cat.id}
          className="px-3 py-1"
          onSubmit={(e) => {
            e.preventDefault();
            submitRename();
          }}
        >
          <Input
            ref={renameRef}
            type="text"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            maxLength={MAX_NAME}
            className="h-7 text-xs"
            onBlur={submitRename}
          />
        </form>
      );
    }

    return (
      <SortablePill key={cat.id} id={cat.id} index={index} disabled={!reorderable}>
        {(sortableRef) => (
          <DroppablePill
            categoryId={cat.id}
            activeCategoryId={activeCategoryId}
            disabled={!reorderable}
          >
            {(droppableRef, isDropTarget) => (
              <div className="group/pill relative flex items-center">
                <button
                  ref={(el) => {
                    sortableRef(el);
                    droppableRef(el);
                  }}
                  onClick={() => openList(cat.id)}
                  className={navRow({
                    active: isActive,
                    class: cn("min-w-0 flex-1 text-left", isDropTarget && "ring-1 ring-primary/30"),
                  })}
                >
                  {isActive && <ActiveBar color={cat.color} />}
                  <ColorDot size="sm" color={cat.color ?? undefined} />
                  <span dir="auto" className="min-w-0 truncate" title={cat.name}>
                    {cat.name}
                  </span>
                  <CollabBadge category={cat} currentUserId={currentUserId} />
                  <OpenCount
                    count={openCounts.get(cat.id) ?? 0}
                    className="transition-opacity group-hover/pill:opacity-0 pill-popup-open:opacity-0 pill-options-focus-visible:opacity-0"
                  />
                </button>

                <Popover>
                  {/* Takes the count's place on hover, so the row doesn't reflow */}
                  <PopoverTrigger
                    render={
                      <button
                        data-slot="category-options"
                        className="pointer-events-none absolute top-1/2 right-3 flex size-5 -translate-y-1/2 items-center justify-center rounded-sm text-hint opacity-0 transition-opacity group-hover/pill:pointer-events-auto group-hover/pill:opacity-100 hover:text-foreground focus-visible:pointer-events-auto focus-visible:opacity-100 data-[popup-open]:pointer-events-auto data-[popup-open]:text-foreground data-[popup-open]:opacity-100"
                        aria-label="List options"
                      />
                    }
                  >
                    <Ellipsis size={13} />
                  </PopoverTrigger>
                  <PopoverContent aria-label={`${cat.name} options`}>
                    <CategoryOptionsContent
                      cat={cat}
                      isOwned={isOwned}
                      onRenameStart={startRename}
                      onSetColor={handleSetColor}
                      onShare={setSharingCategoryId}
                      onDelete={handleDelete}
                      onLeave={handleLeave}
                    />
                  </PopoverContent>
                </Popover>
              </div>
            )}
          </DroppablePill>
        )}
      </SortablePill>
    );
  };

  return (
    <>
      <nav
        aria-label="Lists"
        data-testid="category-sidebar"
        className="fixed top-[calc(var(--sheet-inset)+var(--banner-h,0px))] left-(--panel-left) z-10 hidden h-[calc(100dvh-2*var(--sheet-inset)-var(--banner-h,0px))] w-(--sidebar-w) flex-col overflow-y-auto px-2 py-8 desk:flex"
      >
        <Link
          to="/search"
          className={navRow({
            class:
              "group/search mb-3 data-[status=active]:bg-muted data-[status=active]:text-foreground",
          })}
        >
          <NavIcon>
            <Search className="size-3.5" aria-hidden="true" />
          </NavIcon>
          <span>Search</span>
          <kbd className="ml-auto flex h-4.5 min-w-4.5 items-center justify-center rounded-sm border border-ghost px-1 font-sans text-xs text-hint group-data-[status=active]/search:hidden">
            <span className="sr-only">Shortcut: </span>/
          </kbd>
        </Link>

        <button
          onClick={() => openList(null)}
          className={navRow({ active: onListPage && activeCategoryId === null })}
        >
          {onListPage && activeCategoryId === null && <ActiveBar />}
          <ColorDot size="sm" color={INBOX_COLOR} />
          <span className="text-left">Inbox</span>
          <OpenCount count={inboxCount} />
        </button>

        {ownedCategories.map((cat, index) => renderPill(cat, index))}

        {adding ? (
          <form
            className="px-3 py-1"
            onSubmit={(e) => {
              e.preventDefault();
              const name = newName.trim();
              if (!name) return;
              handleAdd(name);
              setNewName("");
              setAdding(false);
            }}
          >
            <Input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              maxLength={MAX_NAME}
              placeholder="Name..."
              className="h-7 text-xs"
              // eslint-disable-next-line jsx-a11y/no-autofocus -- inline add form, user just clicked Add
              autoFocus
              onBlur={() => {
                if (!newName.trim()) setAdding(false);
              }}
            />
          </form>
        ) : (
          <button
            onClick={() => setAdding(true)}
            className={navRow({ class: "py-2 text-xs font-medium" })}
            aria-label="Add list"
          >
            <NavIcon>
              <Plus className="size-2.5" aria-hidden="true" />
            </NavIcon>
            <span>Add</span>
          </button>
        )}

        {sharedCategories.length > 0 && (
          <SharedWithMeGroup headingClassName="mt-5 mb-1 px-3">
            {sharedCategories.map((cat, index) => renderPill(cat, ownedCategories.length + index))}
          </SharedWithMeGroup>
        )}

        <div className="flex-1" />
        {signedIn && (
          <div className="mt-2 border-t border-ghost/15 pt-2">
            <Link
              to="/people"
              className={navRow({ class: "data-[status=active]:text-foreground" })}
            >
              {({ isActive }) => (
                <>
                  {isActive && <ActiveBar />}
                  <NavIcon>
                    <UsersRound className="size-3.5" aria-hidden="true" />
                  </NavIcon>
                  People
                </>
              )}
            </Link>
            {getBuildTarget() === "browser" && (
              <Link
                to="/settings"
                className={navRow({ class: "data-[status=active]:text-foreground" })}
              >
                {({ isActive }) => (
                  <>
                    {isActive && <ActiveBar />}
                    <NavIcon>
                      <SettingsIcon className="size-3.5" aria-hidden="true" />
                    </NavIcon>
                    Settings
                  </>
                )}
              </Link>
            )}
          </div>
        )}
      </nav>

      {sharingCategoryId && (
        <CategoryCollabSheet
          categoryId={sharingCategoryId}
          open={!!sharingCategoryId}
          onClose={() => setSharingCategoryId(null)}
        />
      )}
      <DeleteCategoryDialog {...deleteDialog} />
    </>
  );
}
