import { servedType } from "@newtab-todo/shared/attachments";
import { deleteAttachment } from "~/lib/db/hooks";
import { deleteUpload, retryUpload, undoDeleteUpload } from "~/lib/files/uploads";
import { sendUploads } from "~/lib/attachments/queue";
import type { AttachmentItem } from "~/lib/attachments/use-attachments";

/** Deletes it however far it got; resolves with its Undo. */
export const removeAttachment = async (item: AttachmentItem) => {
  const { state } = item;
  if (state.kind === "uploaded" || state.kind === "elsewhere") return deleteAttachment(state.row);
  await deleteUpload(item.id);
  void sendUploads();
  return () => {
    void undoDeleteUpload(item.id).then(sendUploads);
  };
};

export const retryAttachment = async (id: string) => {
  await retryUpload(id);
  void sendUploads();
};

// Long enough for a new tab to load it or a download to start
const HANDOFF_MS = 60_000;

/**
 * A URL to hand to a tab or a download, revoked once they have it. A blob URL runs on the app's
 * origin, so only a type on the open-in-tab list keeps its own: the rest is octet-stream, which a
 * browser downloads rather than renders.
 */
export const handoffUrl = (blob: Blob, mimeType: string) => {
  const url = URL.createObjectURL(new Blob([blob], { type: servedType(mimeType) }));
  setTimeout(() => URL.revokeObjectURL(url), HANDOFF_MS);
  return url;
};

export const downloadFile = (blob: Blob, item: Pick<AttachmentItem, "name" | "mimeType">) => {
  const link = document.createElement("a");
  link.href = handoffUrl(blob, item.mimeType);
  link.download = item.name;
  link.click();
};
