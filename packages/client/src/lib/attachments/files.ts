import { useEffect, useState, useSyncExternalStore } from "react";
import { client } from "~/lib/api";
import { getFromBucket } from "~/lib/files/bucket";
import { getSignedInUserId } from "~/lib/auth/current-user";
import {
  blobKey,
  readBlob,
  readUploads,
  saveBlob,
  subscribeUploads as watchUploads,
  type Upload,
  type Variant,
} from "~/lib/files/store";

// Asked for together, since a sheet's tiles all mount at once
const BATCH_MS = 30;
const pending = new Map<Variant, Map<string, ((url: string | undefined) => void)[]>>();

const requestUrls = async (variant: Variant) => {
  const waiting = pending.get(variant);
  pending.delete(variant);
  if (!waiting) return;
  const ids = [...waiting.keys()];
  let urls = new Map<string, string>();
  try {
    const res = await client.api.attachments.urls.$post({ json: { ids, variant } });
    if (res.ok) urls = new Map((await res.json()).map(({ id, url }) => [id, url]));
  } catch (err) {
    console.error("[attachments] urls", err);
  }
  for (const [id, resolvers] of waiting) for (const resolve of resolvers) resolve(urls.get(id));
};

const urlFor = (id: string, variant: Variant) =>
  new Promise<string | undefined>((resolve) => {
    let waiting = pending.get(variant);
    if (!waiting) {
      waiting = new Map();
      pending.set(variant, waiting);
      setTimeout(() => void requestUrls(variant), BATCH_MS);
    }
    waiting.set(id, [...(waiting.get(id) ?? []), resolve]);
  });

const loading = new Map<string, Promise<Blob | undefined>>();

/** This device's copy, else the bucket's, saved for the next time this device is offline. */
export const loadBlob = (id: string, variant: Variant) => {
  const key = blobKey(id, variant);
  // A tile and the viewer asking at once share one download
  let load = loading.get(key);
  if (!load) {
    load = fetchBlob(id, variant).finally(() => loading.delete(key));
    loading.set(key, load);
  }
  return load;
};

const fetchBlob = async (id: string, variant: Variant) => {
  const saved = await readBlob(id, variant);
  if (saved) return saved.blob;
  const userId = getSignedInUserId();
  if (!navigator.onLine || !userId) return undefined;
  const url = await urlFor(id, variant);
  if (!url) return undefined;
  const res = await getFromBucket(url);
  if (!res.ok) return undefined;
  const blob = await res.blob();
  // Shown all the same when it can't be kept, such as with storage full
  await saveBlob(id, variant, blob, userId).catch(console.error);
  return blob;
};

export type LoadedFile = { blob: Blob; url: string } | "missing" | undefined;

/** Undefined while loading; "missing" when neither this device nor the bucket has it now. */
export const useAttachmentFile = (id: string, variant: Variant, uploaded: boolean): LoadedFile => {
  const [loaded, setLoaded] = useState<{ key: string; file: LoadedFile }>();
  const key = `${id}:${variant}:${uploaded}`;
  useEffect(() => {
    let url: string | undefined;
    let cancelled = false;
    (uploaded ? loadBlob(id, variant) : readBlob(id, variant).then((saved) => saved?.blob))
      .then((blob) => {
        if (cancelled) return;
        if (!blob) return setLoaded({ key, file: "missing" });
        url = URL.createObjectURL(blob);
        setLoaded({ key, file: { blob, url } });
      })
      .catch(() => !cancelled && setLoaded({ key, file: "missing" }));
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [id, variant, uploaded, key]);
  return loaded?.key === key ? loaded.file : undefined;
};

let uploads: Upload[] = [];
const uploadListeners = new Set<() => void>();
let stopWatching: (() => void) | undefined;
const reloadUploads = () =>
  readUploads()
    .then((next) => {
      uploads = next;
      uploadListeners.forEach((fn) => fn());
    })
    .catch(console.error);

const subscribeUploads = (listener: () => void) => {
  uploadListeners.add(listener);
  if (!stopWatching) {
    stopWatching = watchUploads(() => void reloadUploads());
    void reloadUploads();
  }
  return () => {
    uploadListeners.delete(listener);
    if (uploadListeners.size > 0) return;
    stopWatching?.();
    stopWatching = undefined;
  };
};

/** This device's uploads still waiting on the server, kept current across tabs. */
export const useUploads = () => useSyncExternalStore(subscribeUploads, () => uploads);
