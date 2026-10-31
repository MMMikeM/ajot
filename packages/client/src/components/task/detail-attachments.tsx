import { useRef, useState, type PointerEvent } from "react";
import { Dialog } from "@base-ui/react/dialog";
import {
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Download,
  FileText,
  Paperclip,
  Trash2,
  X,
} from "lucide-react";
import { opensInTab } from "@newtab-todo/shared/attachments";
import { canDeleteAttachment, type Grant } from "@newtab-todo/shared/task-access";
import { useAttachmentsConfig } from "~/lib/attachments/config";
import { attachFiles, type Refused } from "~/lib/attachments/queue";
import {
  downloadFile,
  removeAttachment,
  retryAttachment,
  handoffUrl,
} from "~/lib/attachments/actions";
import { loadBlob, useAttachmentFile } from "~/lib/attachments/files";
import { useAttachments, type AttachmentItem } from "~/lib/attachments/use-attachments";
import { pushUndoToast, quoted, toastManager } from "~/lib/undo-toast";
import { Button } from "~/components/ui/button";
import { RevealGroup } from "~/components/ui/reveal-button";
import { AddRow, DetailRow, ItemRow, lineButton } from "~/components/task/detail-row";
import { DeleteItemButton, SectionHeading } from "~/components/task/detail-items";
import { cn } from "~/lib/utils";

const sizeFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });

const formatSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${sizeFormat.format(bytes / 1024)} KB`;
  return `${sizeFormat.format(bytes / (1024 * 1024))} MB`;
};

const kindOf = ({ name, mimeType }: AttachmentItem) =>
  (name.includes(".") ? name.split(".") : mimeType.split("/")).pop()!.toUpperCase();

/** What a tile or row says about where it is, when it isn't simply uploaded. */
const statusOf = ({ state }: AttachmentItem) => {
  switch (state.kind) {
    case "pending":
      return state.line;
    case "failed":
      return `Couldn’t upload: ${state.reason}`;
    case "elsewhere":
      return "Uploading from another device";
    case "uploaded":
      return undefined;
  }
};

const isUploaded = (item: AttachmentItem) => item.state.kind === "uploaded";

const isWaiting = ({ state }: AttachmentItem) =>
  state.kind === "pending" || state.kind === "elsewhere";

const deleteWithUndo = async (item: AttachmentItem) =>
  pushUndoToast(quoted(item.name, " deleted"), await removeAttachment(item));

const notSaved = () =>
  toastManager.add({ title: "That file isn’t saved on this device. Open it once you’re online." });

/** A file opens in a tab when its type is safe there, and downloads otherwise. */
const openFile = async (item: AttachmentItem) => {
  // Opened inside the tap, so the browser doesn't take it for a popup
  const tab = opensInTab(item.mimeType) ? window.open("", "_blank") : null;
  const blob = await loadBlob(item.id, "file").catch(() => undefined);
  if (!blob) {
    tab?.close();
    return notSaved();
  }
  if (tab) tab.location.href = handoffUrl(blob, item.mimeType);
  else downloadFile(blob, item);
};

const imageButton =
  "relative overflow-hidden rounded-lg bg-muted outline-none focus-visible:ring-3 focus-visible:ring-ring/50";

const labelOf = (item: AttachmentItem) => {
  const status = statusOf(item);
  return status ? `${item.name}, ${status}` : item.name;
};

const Tile = ({ item, onOpen }: { item: AttachmentItem; onOpen: () => void }) => {
  const thumb = useAttachmentFile(item.id, "thumb", isUploaded(item));
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={labelOf(item)}
      className={cn(imageButton, "aspect-square")}
    >
      {typeof thumb === "object" && (
        <img src={thumb.url} alt="" draggable={false} className="size-full object-cover" />
      )}
      <ImageStatus item={item} />
    </button>
  );
};

/**
 * A task's only attachment, when it's a picture: at its own shape, a set height that leaves the
 * task room. The thumbnail shows at once and the full picture replaces it, at the same shape, once
 * this device has it.
 */
const SoleImage = ({ item, onOpen }: { item: AttachmentItem; onOpen: () => void }) => {
  const uploaded = isUploaded(item);
  const thumb = useAttachmentFile(item.id, "thumb", uploaded);
  const full = useAttachmentFile(item.id, "file", uploaded);
  const shown = typeof full === "object" ? full : typeof thumb === "object" ? thumb : undefined;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={labelOf(item)}
      className={cn(imageButton, "block w-fit max-w-full")}
    >
      {shown ? (
        <img
          src={shown.url}
          alt=""
          draggable={false}
          className="block h-52 w-auto max-w-full object-cover"
        />
      ) : (
        <span className="block h-52 w-72 max-w-full" />
      )}
      <ImageStatus item={item} />
    </button>
  );
};

const ImageStatus = ({ item }: { item: AttachmentItem }) => (
  <>
    {item.state.kind === "failed" && (
      <span className="absolute inset-0 grid place-items-center bg-destructive-subtle/75 text-destructive">
        <CircleAlert className="size-5" />
      </span>
    )}
    {isWaiting(item) && (
      <span
        aria-hidden
        className="absolute top-1.5 right-1.5 size-2 rounded-full bg-pending ring-2 ring-popover"
      />
    )}
  </>
);

const FileItem = ({ item, canDelete }: { item: AttachmentItem; canDelete: boolean }) => {
  const status = statusOf(item);
  return (
    <DetailRow icon={<FileText />}>
      <ItemRow className="items-start">
        <button
          type="button"
          onClick={() => void openFile(item)}
          aria-label={`${opensInTab(item.mimeType) ? "Open" : "Download"} ${item.name}`}
          className={cn(lineButton, "min-w-0 flex-1 flex-col items-start pb-1")}
        >
          <span dir="auto" className="w-full truncate leading-7 touch:leading-8">
            {item.name}
          </span>
          <span
            className={cn("text-xs text-hint", item.state.kind === "failed" && "text-destructive")}
          >
            {status ?? `${formatSize(item.size)} · ${kindOf(item)}`}
          </span>
        </button>
        {item.state.kind === "failed" && (
          <Button variant="subtle" size="xs" onClick={() => void retryAttachment(item.id)}>
            Retry
          </Button>
        )}
        {canDelete && (
          <RevealGroup
            className={cn(
              "items-start pt-1.5 touch:pt-0",
              // Laid over the row's end on hover, it would cover Retry and take its click
              item.state.kind === "failed" && "static bg-transparent mask-none px-0",
            )}
          >
            <DeleteItemButton label="Delete attachment" onClick={() => void deleteWithUndo(item)} />
          </RevealGroup>
        )}
      </ItemRow>
    </DetailRow>
  );
};

const SWIPE_PX = 50;

// By id, so a photo added or deleted elsewhere while it's open never swaps the one shown
const Viewer = ({
  items,
  viewing,
  grant,
  onView,
  onClose,
}: {
  items: AttachmentItem[];
  viewing: string | null;
  grant: Grant | undefined;
  onView: (id: string) => void;
  onClose: () => void;
}) => {
  const index = items.findIndex((item) => item.id === viewing);
  const item = items[index];
  const step = (by: number) => {
    if (index < 0 || items.length < 2) return;
    onView(items[(index + by + items.length) % items.length]!.id);
  };
  return (
    <Dialog.Root open={!!item} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        {/* Nested in the task's sheet, whose backdrop Base UI would otherwise let stand in */}
        <Dialog.Backdrop
          forceRender
          className="fixed inset-0 z-50 bg-[oklch(0.1_0.012_262)] transition-opacity duration-200 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0"
        />
        <Dialog.Popup
          className="fixed inset-0 z-50 flex flex-col pt-[max(env(safe-area-inset-top,0px),var(--banner-h,0px))] pb-[max(0.75rem,env(safe-area-inset-bottom))] text-foreground transition-opacity duration-200 outline-none data-[ending-style]:opacity-0 data-[starting-style]:opacity-0"
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") step(-1);
            if (e.key === "ArrowRight") step(1);
          }}
        >
          {item && (
            <ViewerContent
              key={item.id}
              item={item}
              position={items.length > 1 ? `${index + 1} of ${items.length}` : undefined}
              canDelete={canDeleteAttachment(item, grant)}
              onStep={items.length > 1 ? step : undefined}
              onDelete={() => {
                onClose();
                void deleteWithUndo(item);
              }}
            />
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

const ViewerContent = ({
  item,
  position,
  canDelete,
  onStep,
  onDelete,
}: {
  item: AttachmentItem;
  position?: string;
  canDelete: boolean;
  onStep?: (by: number) => void;
  onDelete: () => void;
}) => {
  const swipeFrom = useRef<number | null>(null);
  const endSwipe = (e: PointerEvent) => {
    if (swipeFrom.current === null) return;
    const dx = e.clientX - swipeFrom.current;
    swipeFrom.current = null;
    if (Math.abs(dx) > SWIPE_PX) onStep?.(dx < 0 ? 1 : -1);
  };
  const full = useAttachmentFile(item.id, "file", isUploaded(item));
  const thumb = useAttachmentFile(item.id, "thumb", isUploaded(item));
  const shown = typeof full === "object" ? full : typeof thumb === "object" ? thumb : undefined;
  const status = full === "missing" ? "Not saved on this device" : statusOf(item);
  return (
    <>
      <div className="flex items-center gap-3 px-4 py-2 touch:px-5">
        <div className="flex min-w-0 flex-1 flex-col">
          <Dialog.Title dir="auto" className="truncate text-sm font-medium">
            {item.name}
          </Dialog.Title>
          <Dialog.Description className="text-xs text-hint">
            {[position, formatSize(item.size)].filter(Boolean).join(" · ")}
          </Dialog.Description>
        </div>
        <Dialog.Close
          render={<Button variant="subtle" size="default" icon bleed="end" aria-label="Close" />}
        >
          <X />
        </Dialog.Close>
      </div>
      <div
        className="relative flex min-h-0 flex-1 touch-pan-y items-center justify-center px-2"
        onPointerDown={(e) => (swipeFrom.current = e.clientX)}
        onPointerUp={endSwipe}
      >
        {shown && (
          <img
            src={shown.url}
            alt={item.name}
            draggable={false}
            className="max-h-full max-w-full rounded-md object-contain select-none"
          />
        )}
        {onStep && (
          <>
            <Button
              variant="ghost"
              size="default"
              icon
              aria-label="Previous"
              onClick={() => onStep(-1)}
              className="absolute left-3 touch:hidden"
            >
              <ChevronLeft />
            </Button>
            <Button
              variant="ghost"
              size="default"
              icon
              aria-label="Next"
              onClick={() => onStep(1)}
              className="absolute right-3 touch:hidden"
            >
              <ChevronRight />
            </Button>
          </>
        )}
      </div>
      {/* The reason wraps above the buttons on a phone, where beside them it would be cut short */}
      <div className="flex flex-wrap items-center justify-end gap-x-2 px-4 pt-2 touch:px-5">
        <p
          className={cn(
            "min-w-0 flex-1 basis-60 text-sm text-hint",
            item.state.kind === "failed" && "text-destructive",
          )}
        >
          {status}
        </p>
        {item.state.kind === "failed" && (
          <Button variant="subtle" size="sm" onClick={() => void retryAttachment(item.id)}>
            Retry
          </Button>
        )}
        {typeof full === "object" && (
          <Button variant="subtle" size="sm" onClick={() => downloadFile(full.blob, item)}>
            <Download data-icon="inline-start" />
            Download
          </Button>
        )}
        {canDelete && (
          <Button
            variant="subtle"
            intent="destructive"
            size="sm"
            icon
            bleed="end"
            aria-label="Delete attachment"
            title="Delete attachment"
            onClick={onDelete}
          >
            <Trash2 />
          </Button>
        )}
      </div>
    </>
  );
};

/** A summary under the tiles of those still on their way, which a tile has no room to say. */
const pendingLine = (images: AttachmentItem[]) => {
  const failed = images.filter((i) => i.state.kind === "failed").length;
  if (failed > 0)
    return {
      failed: true,
      text: `${failed === 1 ? "One" : failed} couldn’t upload. Open it to retry.`,
    };
  const waiting = images.find(isWaiting);
  return waiting ? { failed: false, text: statusOf(waiting)! } : undefined;
};

export const Attachments = ({
  taskId,
  canAttach,
  grant,
}: {
  taskId: string;
  canAttach: boolean;
  grant: Grant | undefined;
}) => {
  const config = useAttachmentsConfig();
  const items = useAttachments(taskId);
  const [viewing, setViewing] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  if (!config && items.length === 0) return null;
  const images = items.filter((item) => item.hasThumb);
  const files = items.filter((item) => !item.hasThumb);
  const summary = pendingLine(images);
  const [sole] = images.length === 1 && files.length === 0 ? images : [];

  return (
    <fieldset aria-label="Attachments" className="flex min-w-0 flex-col">
      {items.length > 0 && <SectionHeading>Attachments</SectionHeading>}
      {images.length > 0 && (
        <DetailRow>
          {sole ? (
            <div className="py-1">
              <SoleImage item={sole} onOpen={() => setViewing(sole.id)} />
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-1.5 py-1 desk:grid-cols-6">
              {images.map((item) => (
                <Tile key={item.id} item={item} onOpen={() => setViewing(item.id)} />
              ))}
            </div>
          )}
          {summary && (
            <p className={cn("pb-1 text-xs text-hint", summary.failed && "text-destructive")}>
              {summary.text}
            </p>
          )}
        </DetailRow>
      )}
      {files.map((item) => (
        <FileItem key={item.id} item={item} canDelete={canDeleteAttachment(item, grant)} />
      ))}
      {config && canAttach && (
        <>
          <AddRow icon={<Paperclip />} onClick={() => inputRef.current?.click()}>
            Attach a file
          </AddRow>
          {/* No accept or capture, so a phone offers its library, camera and files */}
          <input
            ref={inputRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              const chosen = [...(e.target.files ?? [])];
              e.target.value = "";
              void attachFiles(taskId, chosen, config.maxBytes).then((refused) => {
                for (const { name, reason } of refused)
                  toastManager.add({ title: refusedTitle(name, reason, config.maxBytes) });
              });
            }}
          />
        </>
      )}
      <Viewer
        items={images}
        viewing={viewing}
        grant={grant}
        onView={setViewing}
        onClose={() => setViewing(null)}
      />
    </fieldset>
  );
};

const refusedTitle = (name: string, reason: Refused["reason"], maxBytes: number) => {
  switch (reason) {
    case "empty":
      return `“${name}” is empty, so it wasn’t added.`;
    case "too-big":
      return `“${name}” is over ${formatSize(maxBytes)}, so it wasn’t added.`;
    case "not-saved":
      return `“${name}” couldn’t be saved on this device. It may be out of space.`;
  }
};
