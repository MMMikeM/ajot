import type { QueryClient } from "@tanstack/react-query";
import { markStartup } from "~/lib/startup-timing";
import { openSnapshotDb, readSnapshot, writeSnapshot } from "~/lib/snapshot-store";

const SAVE_DELAY_MS = 200;

/** Seeds the cache from the saved lists, then saves each list again whenever its query changes. */
export const restoreSnapshot = async (queryClient: QueryClient, keys: readonly string[]) => {
  const db = await openSnapshotDb();
  markStartup("snapshot-opened");
  // A tab still running an older deploy would otherwise block a newer one's upgrade; the newer
  // tab saves from then on
  let closed = false;
  db.onversionchange = () => {
    closed = true;
    db.close();
  };
  for (const [key, data] of await readSnapshot(db, keys)) queryClient.setQueryData([key], data);

  const pending = new Map<string, { timer: ReturnType<typeof setTimeout>; data: unknown }>();
  const save = (key: string) => {
    const entry = pending.get(key);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(key);
    if (closed) return;
    writeSnapshot(db, [[key, entry.data]]).catch(console.error);
  };

  queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== "updated" || event.action.type !== "success") return;
    const [key, ...rest] = event.query.queryKey;
    if (rest.length > 0 || typeof key !== "string" || !keys.includes(key)) return;
    // Live sync can update a list several times in a row; save the last of them
    clearTimeout(pending.get(key)?.timer);
    pending.set(key, {
      timer: setTimeout(() => save(key), SAVE_DELAY_MS),
      data: event.query.state.data,
    });
  });

  // A page hidden or closed within the delay would otherwise never save its last change
  const saveAll = () => [...pending.keys()].forEach(save);
  addEventListener("pagehide", saveAll);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") saveAll();
  });
};
