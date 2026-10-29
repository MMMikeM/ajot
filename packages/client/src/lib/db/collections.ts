import { createCollection } from "@tanstack/db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";
import { queryClient } from "~/lib/db/query-client";
import { client } from "~/lib/api";
import { ApiError } from "~/lib/api-client";
import { listRoutes } from "~/lib/list-routes";
import { getAuthToken } from "~/lib/auth/token";
import type { Attachment, Task, Category, Contact, Note } from "~/lib/types";
import { getBuildTarget } from "../build-target";
import { markStartup } from "~/lib/startup-timing";
import { restoreSnapshot } from "~/lib/db/snapshot";
import { SNAPSHOT_KEYS } from "~/lib/snapshot-store";
import { getSignedInUserId } from "~/lib/auth/current-user";
import { getServerUrl } from "~/lib/server-url";
import { syncFiles } from "~/lib/files/file-job";

const openSnapshot = async () => {
  markStartup("snapshot-read-start");
  try {
    await restoreSnapshot(queryClient, SNAPSHOT_KEYS);
    markStartup("snapshot-read-end");
  } catch (err) {
    console.warn("[db] snapshot unavailable, loading from the server:", err);
  }
};

const routes = listRoutes(client);

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
      attachmentsCollection: null,
    };

  await openSnapshot();
  return {
    contactsCollection: createCollection(
      queryCollectionOptions<Contact>({
        id: "contacts",
        queryKey: ["contacts"] as const,
        queryFn: async () => {
          if (!getAuthToken()) return [];
          const res = await routes.contacts();
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
          const res = await routes.categories();
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
          const res = await routes.tasks();
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
          const res = await routes.notes();
          if (res.status === 401) return [];
          if (!res.ok) throw new Error("Failed to fetch notes");
          return res.json();
        },
        queryClient,
        getKey: (item) => item.id,
        retry: () => !!getAuthToken(),
      }),
    ),
    attachmentsCollection: createCollection(
      queryCollectionOptions<Attachment>({
        id: "attachments",
        queryKey: ["attachments"] as const,
        queryFn: async () => {
          const token = getAuthToken();
          if (!token) return [];
          const fetchedAt = Date.now();
          const res = await routes.attachments();
          // Wider than this server's types: one from before attachments answers 404
          const status: number = res.status;
          if (status === 401 || status === 404) return [];
          if (!res.ok) throw new ApiError(status, "/api/attachments");
          const rows = await res.json();
          // A fresh list: save the thumbnails it shows and let go of what it no longer does
          const session = { token, serverUrl: getServerUrl(), userId: getSignedInUserId() };
          void syncFiles({ session, rows, fetchedAt });
          return rows;
        },
        queryClient,
        getKey: (item) => item.id,
        retry: () => !!getAuthToken(),
      }),
    ),
  };
}

// Null in the SSR prerender, which has no IndexedDB: the routes that read them never render there
const collections = await makeCollections();
export const tasksCollection = collections.tasksCollection!;
export const categoriesCollection = collections.categoriesCollection!;
export const notesCollection = collections.notesCollection!;
export const contactsCollection = collections.contactsCollection!;
export const attachmentsCollection = collections.attachmentsCollection!;
