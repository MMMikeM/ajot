import { createCollection } from "@tanstack/db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";
import { queryClient } from "~/lib/db/query-client";
import { client } from "~/lib/api";
import { getAuthToken } from "~/lib/auth/token";
import type { Task, Category, Contact, Note } from "~/lib/types";
import { getBuildTarget } from "../build-target";
import { markStartup } from "~/lib/startup-timing";
import { restoreSnapshot } from "~/lib/db/snapshot";
import { SNAPSHOT_KEYS } from "~/lib/snapshot-store";

// Guard: IndexedDB requires browser APIs — not available in Node.js (SSR prerender).
// Lazy route components that consume these collections suspend in SSR before rendering,
// so null exports are safe. See packages/client/src/routes/CLAUDE.md.

const openSnapshot = async () => {
  markStartup("snapshot-read-start");
  try {
    await restoreSnapshot(queryClient, SNAPSHOT_KEYS);
    markStartup("snapshot-read-end");
  } catch (err) {
    console.warn("[db] snapshot unavailable, loading from the server:", err);
  }
};

// Signed out, or on a 401 (which signs out), each queryFn returns [] rather than throwing: a
// query error during the first load puts the collection in an error state that rejects local
// inserts. Signed-out edits live as pending outbox transactions (lib/db/offline.ts) until the
// user signs in.
async function makeCollections() {
  if (getBuildTarget() === "server")
    return {
      categoriesCollection: null,
      tasksCollection: null,
      notesCollection: null,
      contactsCollection: null,
    };

  await openSnapshot();
  return {
    contactsCollection: createCollection(
      queryCollectionOptions<Contact>({
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
    categoriesCollection: createCollection(
      queryCollectionOptions<Category>({
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
    tasksCollection: createCollection(
      queryCollectionOptions<Task>({
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
    notesCollection: createCollection(
      queryCollectionOptions<Note>({
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
  };
}

// makeCollections() returns null values on the server path (SSR prerender).
// This module is client-only — no server-path code ever imports it.
const collections = await makeCollections();
export const tasksCollection = collections.tasksCollection!;
export const categoriesCollection = collections.categoriesCollection!;
export const notesCollection = collections.notesCollection!;
export const contactsCollection = collections.contactsCollection!;
