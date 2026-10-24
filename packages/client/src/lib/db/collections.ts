import { createCollection, type CollectionConfig } from "@tanstack/db";
import { queryCollectionOptions, type QueryCollectionUtils } from "@tanstack/query-db-collection";
import { persistedCollectionOptions } from "@tanstack/browser-db-sqlite-persistence";
import { queryClient } from "~/lib/db/query-client";
import { client } from "~/lib/api";
import { getAuthToken } from "~/lib/auth/token";
import type { Task, Category, Contact, Note } from "~/lib/types";
import {
  openBrowserWASQLiteOPFSDatabase,
  createBrowserWASQLitePersistence,
  BrowserCollectionCoordinator,
} from "@tanstack/browser-db-sqlite-persistence";
import { getBuildTarget } from "../build-target";
import { markStartup } from "~/lib/startup-timing";
import { restoreSnapshot } from "~/lib/db/snapshot";

// Guard: OPFS requires browser APIs — not available in Node.js (SSR prerender).
// Lazy route components that consume these collections suspend in SSR before rendering,
// so null exports are safe. See packages/client/src/routes/CLAUDE.md.

// Signed out, or on a 401 (which signs out), each queryFn returns [] rather than throwing: a
// query error during the first load puts the collection in an error state that rejects local
// inserts. Signed-out edits live as pending outbox transactions (lib/db/offline.ts) until the
// user signs in.
type QueryOptions<T extends object> = CollectionConfig<
  T,
  string,
  never,
  QueryCollectionUtils<T, string, T>
> & { utils: QueryCollectionUtils<T, string, T> };

// Private windows refuse OPFS (Firefox throws a SecurityError), and opening it can time out.
// The app then keeps this session's data in memory rather than failing to start.
const openPersistence = async () => {
  markStartup("db-open-start");
  try {
    const database = await openBrowserWASQLiteOPFSDatabase({ databaseName: "newtab-todo.sqlite" });
    const coordinator = new BrowserCollectionCoordinator({ dbName: "newtab-todo" });
    const persistence = createBrowserWASQLitePersistence({ database, coordinator });
    markStartup("db-open-end");
    return persistence;
  } catch (err) {
    markStartup("db-unavailable");
    console.warn("[db] OPFS unavailable, keeping data in memory:", err);
    return null;
  }
};

// Firefox's extension worker takes ~300ms to open SQLite, against ~25ms in Chrome, so there the
// lists come back from an IndexedDB copy of their last server response instead
const restoresFromSnapshot = () => location.protocol === "moz-extension:";

const openSnapshot = async () => {
  markStartup("snapshot-read-start");
  try {
    await restoreSnapshot(queryClient, ["tasks", "categories", "notes", "contacts"]);
    markStartup("snapshot-read-end");
  } catch (err) {
    console.warn("[db] snapshot unavailable, loading from the server:", err);
  }
};

async function makeCollections() {
  if (getBuildTarget() === "server")
    return {
      categoriesCollection: null,
      tasksCollection: null,
      notesCollection: null,
      contactsCollection: null,
    };

  let persistence: Awaited<ReturnType<typeof openPersistence>> = null;
  if (restoresFromSnapshot()) await openSnapshot();
  else persistence = await openPersistence();
  const withPersistence = <T extends object>(options: QueryOptions<T>): QueryOptions<T> =>
    persistence
      ? {
          ...persistedCollectionOptions<T, string>({ ...options, persistence, schemaVersion: 1 }),
          // The wrapper passes utils through but types them as a plain UtilsRecord
          utils: options.utils,
        }
      : options;
  return {
    contactsCollection: createCollection(
      withPersistence<Contact>(
        queryCollectionOptions({
          id: "contacts",
          queryKey: ["contacts"] as const,
          queryFn: async () => {
            if (!getAuthToken()) return [];
            const res = await client.api.contacts.$get();
            if (res.status === 401) return [];
            if (!res.ok) throw new Error("Failed to fetch contacts");
            return res.json();
          },
          queryClient,
          getKey: (item) => item.id,
          retry: () => !!getAuthToken(),
        }),
      ),
    ),
    categoriesCollection: createCollection(
      withPersistence<Category>(
        queryCollectionOptions({
          id: "categories",
          queryKey: ["categories"] as const,
          queryFn: async () => {
            if (!getAuthToken()) return [];
            const res = await client.api.categories.$get();
            if (res.status === 401) return [];
            if (!res.ok) throw new Error("Failed to fetch categories");
            // Response schema marks user/collaborators nullish (shared with mutation routes),
            // but the list endpoint always includes them.
            return (await res.json()) as Category[];
          },
          queryClient,
          getKey: (item) => item.id,
          retry: () => !!getAuthToken(),
        }),
      ),
    ),
    tasksCollection: createCollection(
      withPersistence<Task>(
        queryCollectionOptions({
          id: "tasks",
          queryKey: ["tasks"] as const,
          queryFn: async () => {
            if (!getAuthToken()) return [];
            const res = await client.api.tasks.$get();
            if (res.status === 401) return [];
            if (!res.ok) throw new Error("Failed to fetch tasks");
            return res.json();
          },
          queryClient,
          getKey: (item) => item.id,
          retry: () => !!getAuthToken(),
        }),
      ),
    ),
    notesCollection: createCollection(
      withPersistence<Note>(
        queryCollectionOptions({
          id: "notes",
          queryKey: ["notes"] as const,
          queryFn: async () => {
            if (!getAuthToken()) return [];
            const res = await client.api.notes.$get();
            if (res.status === 401) return [];
            if (!res.ok) throw new Error("Failed to fetch notes");
            return res.json();
          },
          queryClient,
          getKey: (item) => item.id,
          retry: () => !!getAuthToken(),
        }),
      ),
    ),
  };
}

// makeCollections() returns null values on the server path (SSR prerender).
// This module is client-only — no server-path code ever imports it.
const collections = await makeCollections();
export const tasksCollection = collections.tasksCollection!;
export const categoriesCollection = collections.categoriesCollection!;
export const notesCollection = collections.notesCollection!;
export const contactsCollection = collections.contactsCollection!;
