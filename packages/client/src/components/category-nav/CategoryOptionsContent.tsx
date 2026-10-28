import type { ComponentType, ReactElement, ReactNode } from "react";
import { Check, LogOut, Pencil, Trash2, UserPlus } from "lucide-react";
import { tv } from "tailwind-variants";
import { MenuItem } from "~/components/ui/menu-item";
import { PopoverClose } from "~/components/ui/popover";
import { CATEGORY_COLORS } from "~/lib/constants";
import type { Category } from "~/lib/types";

interface CategoryOptionsContentProps {
  cat: Category;
  isOwned: boolean;
  onRenameStart: (id: string, name: string) => void;
  onSetColor: (id: string, color: string | null) => void;
  onShare: (id: string) => void;
  onDelete: (id: string) => void;
  onLeave: (id: string) => void;
  /** Wraps the items that hand off to another surface, closing the menu first: the popover's
   * close, or the phone's sheet's */
  Close?: ComponentType<{ render: ReactElement; onClick: () => void; children: ReactNode }>;
}

const swatch = tv({
  base: "relative flex size-6 items-center justify-center rounded-full ring-1 ring-foreground/10 transition-transform after:absolute after:-inset-1 hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:scale-95 motion-reduce:transition-none touch:size-9",
  variants: {
    // Hollow and struck through, so it reads as no colour rather than as a grey one
    none: { true: "bg-transparent ring-hint" },
    selected: { true: "ring-2 ring-foreground/80 ring-offset-2 ring-offset-popover" },
  },
});

export function CategoryOptionsContent({
  cat,
  isOwned,
  onRenameStart,
  onSetColor,
  onShare,
  onDelete,
  onLeave,
  Close = PopoverClose,
}: CategoryOptionsContentProps) {
  if (!isOwned) {
    return (
      <MenuItem intent="destructive" onClick={() => onLeave(cat.id)}>
        <LogOut />
        Leave
      </MenuItem>
    );
  }

  return (
    <>
      <MenuItem onClick={() => onRenameStart(cat.id, cat.name)}>
        <Pencil />
        Rename
      </MenuItem>
      <fieldset className="px-3 pt-1.5 pb-2">
        <legend className="float-left text-xs text-hint">Colour</legend>
        <div className="clear-left grid w-fit grid-cols-5 gap-1.5 pt-1.5 touch:gap-2">
          <button
            onClick={() => onSetColor(cat.id, null)}
            aria-label="No colour"
            aria-pressed={!cat.color}
            title="No colour"
            className={swatch({ none: true, selected: !cat.color })}
          >
            {cat.color ? (
              <span aria-hidden="true" className="absolute inset-x-0.5 h-px -rotate-45 bg-hint" />
            ) : (
              <Check className="size-3.5 text-foreground touch:size-4" strokeWidth={3} />
            )}
          </button>
          {CATEGORY_COLORS.map((c) => {
            const selected = cat.color === c.value;
            return (
              <button
                key={c.name}
                onClick={() => onSetColor(cat.id, c.value)}
                aria-label={`Colour ${c.name}`}
                aria-pressed={selected}
                title={c.name}
                className={swatch({ selected })}
                style={{ backgroundColor: c.value }}
              >
                {selected && (
                  <Check className="size-3.5 text-background touch:size-4" strokeWidth={3} />
                )}
              </button>
            );
          })}
        </div>
      </fieldset>
      <div className="my-1 h-px bg-border" />
      {/* Close explicitly: unlike Rename, sharing leaves the row mounted, and so does
          deleting a category that still has tasks, which asks first. The menu would
          otherwise stay open behind the share sheet or the prompt */}
      <Close render={<MenuItem data-testid="category-share-btn" />} onClick={() => onShare(cat.id)}>
        <UserPlus />
        Share
      </Close>
      <Close render={<MenuItem intent="destructive" />} onClick={() => onDelete(cat.id)}>
        <Trash2 />
        Delete
      </Close>
    </>
  );
}
