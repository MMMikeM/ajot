import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Ellipsis, Plus, Search, Settings, Users } from "lucide-react";
import { INBOX_COLOR } from "~/lib/constants";
import { Drawer, DrawerClose, DrawerContent, DrawerTitle } from "~/components/ui/drawer";
import { CategoryCollabSheet } from "~/components/CategoryCollabSheet";
import { CollabBadge } from "./CollabBadge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/field";
import { MAX_NAME } from "@newtab-todo/shared/field-limits";
import { ColorDot } from "~/components/ui/color-dot";
import { setActiveCategoryId } from "~/lib/state/active-category";
import { useCurrentUserId } from "~/lib/auth/current-user";
import { getBuildTarget } from "~/lib/build-target";
import { useNavContext } from "~/lib/state/nav-context";
import { cn } from "~/lib/utils";
import { navRow } from "./nav-row";
import type { Category } from "~/lib/types";
import { useCategoryNavState } from "./use-category-nav-state";
import { useCategoryActions } from "./use-category-actions";
import { CategoryOptionsContent } from "./CategoryOptionsContent";
import { DeleteCategoryDialog } from "./DeleteCategoryDialog";
import { SharedWithMeGroup } from "./SharedWithMeGroup";
import { keepOpenOnToastPress } from "~/components/sheet-open-change";
import { holdKeyboard } from "~/lib/keyboard-bridge";
import { useBackToClose } from "~/lib/hooks/use-back-to-close";

const rowClass = (isActive: boolean) =>
  cn(
    "mx-2 flex items-center rounded-lg text-sm transition-colors",
    isActive ? "bg-primary-selected font-medium text-foreground" : "text-hint active:bg-muted",
  );

const OpenCount = ({ count }: { count: number }) =>
  count > 0 ? (
    <span className="text-xs text-hint tabular-nums">
      {count}
      <span className="sr-only"> open</span>
    </span>
  ) : null;

function CategoryMobileSheet() {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const addRef = useRef<HTMLInputElement>(null);
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
  const { navOpen, setNavOpen } = useNavContext();
  useBackToClose(navOpen, () => setNavOpen(false));
  const [optionsOpened, setOptionsOpened] = useState<Category>();
  const [optionsOpen, setOptionsOpen] = useState(false);
  const liveOptionsFor = categories.find((c) => c.id === optionsOpened?.id);
  // Back closes the lists sheet and the options inside it; a list gone from another device (deleted,
  // or you were removed) closes its options before they act on it
  if (optionsOpen && (!navOpen || !liveOptionsFor)) setOptionsOpen(false);
  // The list as opened stays shown while the sheet slides away after Delete or Leave takes it
  const optionsFor = liveOptionsFor ?? optionsOpened;
  const signedIn = useCurrentUserId() !== null;

  useEffect(() => {
    if (adding) addRef.current?.focus();
  }, [adding]);

  const selectAndClose = (id: string | null) => {
    setActiveCategoryId(id);
    setNavOpen(false);
  };

  const navigate = useNavigate();
  const openSearch = () => {
    holdKeyboard();
    setNavOpen(false);
    void navigate({ to: "/search", replace: true });
  };

  const ownedCategories = categories.filter((c) => c.userId === currentUserId);
  const sharedCategories = categories.filter((c) => c.userId !== currentUserId);

  const renderRow = (cat: Category) => {
    const isOwned = cat.userId === currentUserId;
    const isActive = activeCategoryId === cat.id;

    if (renamingId === cat.id) {
      return (
        <form
          key={cat.id}
          className="px-5 py-1"
          onSubmit={(e) => {
            e.preventDefault();
            submitRename();
          }}
        >
          <Input
            ref={renameRef}
            type="text"
            aria-label="List name"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            maxLength={MAX_NAME}
            onBlur={submitRename}
          />
        </form>
      );
    }

    return (
      <div key={cat.id} className={rowClass(isActive)}>
        <button
          onClick={() => selectAndClose(cat.id)}
          aria-current={isActive ? "true" : undefined}
          className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-3 text-left"
        >
          {/* Long names wrap: touch has no hover to reveal a truncated one */}
          <ColorDot color={cat.color ?? undefined} className="mt-1.5 self-start" />
          <span className="min-w-0 flex-1 wrap-anywhere">
            <span dir="auto">{cat.name}</span>
            {!isOwned && cat.user?.name && (
              <span className="ml-1 text-xs font-normal text-hint">
                · <span dir="auto">{cat.user.name}</span>
              </span>
            )}
          </span>
          {/* For someone else's list the suffix already names the owner */}
          {isOwned && <CollabBadge category={cat} currentUserId={currentUserId} />}
          <OpenCount count={openCounts.get(cat.id) ?? 0} />
        </button>

        <Button
          variant="subtle"
          size="sm"
          icon
          className="size-11 rounded-lg"
          aria-label="List options"
          aria-haspopup="dialog"
          onClick={() => {
            setOptionsOpened(cat);
            setOptionsOpen(true);
          }}
        >
          <Ellipsis size={16} />
        </Button>
      </div>
    );
  };

  return (
    <>
      <Drawer open={navOpen} onOpenChange={keepOpenOnToastPress(setNavOpen)}>
        <DrawerContent>
          {/* Looks like the field, which is on the search page: this tap is what raises the keyboard */}
          <button
            type="button"
            onClick={openSearch}
            className="mx-5 mt-2 mb-2 flex h-12 w-[calc(100%-2.5rem)] items-center gap-3 border-b border-ghost text-left text-base text-hint transition-colors active:text-foreground"
          >
            <Search size={18} aria-hidden="true" />
            Search all lists
          </button>
          <DrawerTitle className="px-5 pt-3 pb-2 text-xs font-medium tracking-wider text-hint uppercase">
            Lists
          </DrawerTitle>

          <div className={rowClass(activeCategoryId === null)}>
            <button
              onClick={() => selectAndClose(null)}
              aria-current={activeCategoryId === null ? "true" : undefined}
              className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-3 text-left"
            >
              <ColorDot color={INBOX_COLOR} />
              <span className="flex-1">Inbox</span>
              <OpenCount count={inboxCount} />
            </button>
            {/* Spacer matching the options button so counts line up */}
            <span className="w-11 shrink-0" aria-hidden="true" />
          </div>

          {ownedCategories.map(renderRow)}

          {sharedCategories.length > 0 && (
            <SharedWithMeGroup headingClassName="px-5 pt-5 pb-2">
              {sharedCategories.map(renderRow)}
            </SharedWithMeGroup>
          )}

          <div className="mx-5 my-2 h-px bg-border" />

          {adding ? (
            <form
              className="px-5 py-1"
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
                ref={addRef}
                type="text"
                aria-label="New list name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                maxLength={MAX_NAME}
                placeholder="List name..."
                enterKeyHint="done"
                onBlur={() => {
                  if (!newName.trim()) setAdding(false);
                }}
              />
            </form>
          ) : (
            <button
              onClick={() => setAdding(true)}
              className={navRow({ place: "sheet", class: "w-[calc(100%-1rem)]" })}
            >
              <Plus size={16} />
              Add list
            </button>
          )}

          {signedIn && (
            <Link
              to="/people"
              replace
              onClick={() => setNavOpen(false)}
              className={navRow({ place: "sheet" })}
            >
              <Users size={16} />
              People
            </Link>
          )}
          {signedIn && getBuildTarget() === "browser" && (
            <Link
              to="/settings"
              replace
              onClick={() => setNavOpen(false)}
              className={navRow({ place: "sheet" })}
            >
              <Settings size={16} />
              Settings
            </Link>
          )}

          <div className="h-[max(0.75rem,env(safe-area-inset-bottom,0px))]" />

          {/* Inside the lists sheet, so Base UI nests it: a tap on it isn't a press outside that one */}
          <Drawer open={optionsOpen} onOpenChange={keepOpenOnToastPress(setOptionsOpen)}>
            <DrawerContent
              // Rename swaps the row that opened it for a field, which keeps the focus
              finalFocus={renamingId === null}
            >
              {optionsFor && (
                <>
                  <DrawerTitle className="flex items-start gap-2.5 px-5 pt-3 pb-3 font-display text-2xl font-normal">
                    {/* Centred on the first line, since a long name wraps */}
                    <ColorDot color={optionsFor.color ?? undefined} className="mt-3" />
                    <span className="min-w-0 wrap-anywhere">
                      <span dir="auto">{optionsFor.name}</span>
                      <span className="sr-only"> options</span>
                    </span>
                  </DrawerTitle>
                  <div className="flex flex-col px-2">
                    <CategoryOptionsContent
                      cat={optionsFor}
                      isOwned={optionsFor.userId === currentUserId}
                      onRenameStart={(id, name) => {
                        setOptionsOpen(false);
                        startRename(id, name);
                      }}
                      onSetColor={handleSetColor}
                      onShare={setSharingCategoryId}
                      onDelete={handleDelete}
                      onLeave={(id) => {
                        setOptionsOpen(false);
                        void handleLeave(id);
                      }}
                      Close={DrawerClose}
                    />
                  </div>
                  <div className="h-[max(0.75rem,env(safe-area-inset-bottom,0px))]" />
                </>
              )}
            </DrawerContent>
          </Drawer>
        </DrawerContent>
      </Drawer>

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

export default CategoryMobileSheet;
