import { nanoid } from "nanoid";
import { now } from "@newtab-todo/shared/iso";
import { addUpload } from "~/lib/files/store";
import { prepareFile } from "~/lib/files/prepare";

export type Refusal = "empty" | "too-big" | "not-saved";

/**
 * Prepares a file, then saves it on this device with its queue entry, so it shows at once and
 * survives the page closing. Resolves with why it wasn't added, or nothing once it's queued.
 */
export const queueFile = async (
  file: File,
  { taskId, uploaderId, maxBytes }: { taskId: string; uploaderId: string; maxBytes: number },
): Promise<Refusal | undefined> => {
  if (file.size === 0) return "empty";
  const prepared = await prepareFile(file);
  if (prepared.file.size > maxBytes) return "too-big";
  const at = now();
  try {
    await addUpload(
      {
        row: {
          id: nanoid(),
          taskId,
          name: prepared.name,
          mimeType: prepared.mimeType,
          size: prepared.file.size,
          thumbhash: null,
          hasThumb: !!prepared.thumb,
          createdAt: at,
          updatedAt: at,
        },
        uploaderId,
        posted: false,
        serverDeleted: false,
        attempts: 0,
        retryAt: 0,
        sizeMismatches: 0,
      },
      { file: prepared.file, ...(prepared.thumb && { thumb: prepared.thumb }) },
    );
    return undefined;
  } catch (err) {
    console.error("[uploads] couldn't save", err);
    return "not-saved";
  }
};
