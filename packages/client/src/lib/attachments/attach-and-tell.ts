import { attachFiles, type Refused } from "~/lib/attachments/queue";
import { formatSize } from "~/lib/attachments/format";
import { toastManager } from "~/lib/undo-toast";

const refusedTitle = ({ name, reason }: Refused, maxBytes: number) => {
  switch (reason) {
    case "empty":
      return `“${name}” is empty, so it wasn’t added.`;
    case "too-big":
      return `“${name}” is over ${formatSize(maxBytes)}, so it wasn’t added.`;
    case "not-saved":
      return `“${name}” couldn’t be saved on this device. It may be out of space.`;
    case "signed-out":
      return `Sign in to Ajot to attach “${name}”.`;
  }
};

export const tellRefused = (refused: Refused, maxBytes: number) =>
  toastManager.add({ title: refusedTitle(refused, maxBytes) });

/** Queues the files on the task, with a toast for each one that couldn't be. */
export const attachAndTell = async (taskId: string, files: File[], maxBytes: number) => {
  for (const refused of await attachFiles(taskId, files, maxBytes)) tellRefused(refused, maxBytes);
};
