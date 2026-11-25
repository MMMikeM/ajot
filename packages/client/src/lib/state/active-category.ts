import { createExternalStore } from "~/lib/external-store";
import { categoriesCollection } from "~/lib/db/collections";
import { useCategories } from "~/lib/db/hooks";
import { offline } from "~/lib/db/offline";
import { queryClient } from "~/lib/db/query-client";
import type { Category } from "~/lib/types";

const KEY = "newtab-todo-active-category";
const store = createExternalStore<string | null>(
  typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null,
);

/**
 * Whether the open list, when it isn't on the device, is gone rather than yet to arrive: one
 * reached by a link may not have synced, and one made offline is shown again only once the outbox
 * has been read.
 */
const openList = createExternalStore({
  /** On the device at some point since it was opened, so missing now means deleted or left */
  seen: false,
  /** Missing from a server answer since it was opened */
  notOnServer: false,
});
const outboxShown = createExternalStore(false);

const isOnDevice = (id: string) => categoriesCollection.has(id);

if (typeof window !== "undefined") {
  categoriesCollection.subscribeChanges(
    (changes) => {
      const id = store.get();
      if (openList.get().seen || !id) return;
      if (changes.some((change) => change.key === id && change.type !== "delete"))
        openList.set({ ...openList.get(), seen: true });
    },
    { includeInitialState: true },
  );
  // Restoring the saved lists writes the cache as `manual`, so only a fetch counts as an answer
  queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== "updated" || event.action.type !== "success" || event.action.manual) return;
    const [key, ...rest] = event.query.queryKey;
    if (key !== "categories" || rest.length > 0) return;
    const id = store.get();
    const answer = event.query.state.data as Category[] | undefined;
    if (id && !answer?.some((list) => list.id === id))
      openList.set({ ...openList.get(), notOnServer: true });
  });
  const showOutbox = () => outboxShown.set(true);
  offline.waitForInit().then(showOutbox, showOutbox);
}

export const setActiveCategoryId = (id: string | null) => {
  if (id) localStorage.setItem(KEY, id);
  else localStorage.removeItem(KEY);
  const seen = !!id && isOnDevice(id);
  openList.set({ seen, notOnServer: false });
  store.set(id);
  // A link can name a list made since this device last asked
  if (id && !seen) categoriesCollection.utils.refetch().catch(console.warn);
};

export const useActiveCategoryId = store.useStore;

/**
 * The list a task added now goes to: the open one, or the Inbox once that list is known to be
 * gone, so an add never goes to a list the server would refuse.
 */
export const useOpenListId = () => {
  const id = useActiveCategoryId();
  const { seen, notOnServer } = openList.useStore();
  const shown = outboxShown.useStore();
  const { data: lists = [] } = useCategories();
  if (!id || lists.some((list) => list.id === id)) return id;
  return shown && (seen || notOnServer) ? null : id;
};
