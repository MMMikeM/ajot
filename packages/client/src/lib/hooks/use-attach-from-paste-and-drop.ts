import { useEffect, useState } from "react";
import { attachAndTell } from "~/lib/attachments/attach-and-tell";
import { filesToAttachFromPaste } from "~/lib/attachments/from-clipboard";

// Files dragged in from outside the page end with no dragleave or dragend in some browsers (or
// one per element crossed, in Safari), so the hint stays only while dragover keeps firing
const DRAG_GONE_MS = 600;

const isTextField = (target: EventTarget | null) =>
  target instanceof HTMLTextAreaElement ||
  target instanceof HTMLInputElement ||
  (target instanceof HTMLElement && target.isContentEditable);

const carriesFiles = (event: DragEvent) => event.dataTransfer?.types.includes("Files") ?? false;

/**
 * While a task's sheet is open, a picture pasted anywhere in it or files dropped anywhere on the
 * page are attached to the task. Off when `maxBytes` is undefined. True while files are dragged
 * over the page.
 */
export const useAttachFromPasteAndDrop = (taskId: string, maxBytes: number | undefined) => {
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (maxBytes === undefined) return;
    let dragGone: ReturnType<typeof setTimeout> | undefined;
    const attach = (files: File[]) => void attachAndTell(taskId, files, maxBytes);

    const onPaste = (event: ClipboardEvent) => {
      if (!event.clipboardData) return;
      const files = filesToAttachFromPaste(event.clipboardData, {
        intoTextField: isTextField(event.target),
      });
      if (files.length === 0) return;
      event.preventDefault();
      attach(files);
    };
    // Cancelled so the browser takes the drop, instead of navigating away to the file
    const onDragOver = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      event.dataTransfer!.dropEffect = "copy";
      setDragging(true);
      clearTimeout(dragGone);
      dragGone = setTimeout(() => setDragging(false), DRAG_GONE_MS);
    };
    const onDrop = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      clearTimeout(dragGone);
      setDragging(false);
      attach([...event.dataTransfer!.files]);
    };

    document.addEventListener("paste", onPaste);
    document.addEventListener("dragenter", onDragOver);
    document.addEventListener("dragover", onDragOver);
    document.addEventListener("drop", onDrop);
    return () => {
      clearTimeout(dragGone);
      setDragging(false);
      document.removeEventListener("paste", onPaste);
      document.removeEventListener("dragenter", onDragOver);
      document.removeEventListener("dragover", onDragOver);
      document.removeEventListener("drop", onDrop);
    };
  }, [taskId, maxBytes]);

  return dragging;
};
