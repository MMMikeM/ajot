import { useState } from "react";
import { useAttachmentRows } from "~/lib/db/hooks";
import { useDeviceOnline } from "~/lib/hooks/use-device-online";
import { useUploads } from "~/lib/attachments/files";
import { TASK_MISSING_HINT_MS } from "~/lib/files/upload-steps";
import type { Upload } from "~/lib/files/store";
import type { Attachment } from "~/lib/types";

export type AttachmentState =
  | { kind: "uploaded"; row: Attachment }
  /** On this device and on its way: `line` says what it's waiting for. */
  | { kind: "pending"; line: string }
  | { kind: "failed"; reason: string }
  /** Its uploader's row, with the bytes still on another of their devices. */
  | { kind: "elsewhere"; row: Attachment };

export type AttachmentItem = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  hasThumb: boolean;
  uploaderId: string;
  createdAt: string;
  state: AttachmentState;
};

const pendingLine = (upload: Upload, now: number, online: boolean) => {
  if (upload.taskMissingSince !== undefined && now - upload.taskMissingSince > TASK_MISSING_HINT_MS)
    return "Waiting for its task to sync";
  return online ? "Uploading" : "Saved here · uploads when online";
};

const fromUpload = (upload: Upload, now: number, online: boolean): AttachmentItem => ({
  ...upload.row,
  uploaderId: upload.uploaderId,
  state:
    upload.failed === undefined
      ? { kind: "pending", line: pendingLine(upload, now, online) }
      : { kind: "failed", reason: upload.failed },
});

const fromRow = (row: Attachment): AttachmentItem => ({
  ...row,
  state: row.uploadedAt ? { kind: "uploaded", row } : { kind: "elsewhere", row },
});

/** The task's attachments, oldest first: the server's, and this device's still on their way. */
export const useAttachments = (taskId: string): AttachmentItem[] => {
  const { data: rows = [] } = useAttachmentRows();
  const uploads = useUploads();
  const online = useDeviceOnline();
  // Only for the day-long "waiting for its task" hint, so the time the sheet opened will do
  const [now] = useState(Date.now);
  const forTask = uploads.filter((u) => u.row.taskId === taskId);
  // This device's entry knows more than the server's row until it's uploaded
  const queuedIds = new Set(forTask.map((u) => u.row.id));
  return [
    ...rows.filter((row) => row.taskId === taskId && !queuedIds.has(row.id)).map(fromRow),
    ...forTask
      .filter((u) => u.deletedAt === undefined)
      .map((upload) => fromUpload(upload, now, online)),
  ].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
};
