# Query Collection Reference

`@tanstack/query-db-collection` integrates TanStack DB with TanStack Query — automatic remote data fetching, optimistic updates with rollback, and direct sync store writes.

## Basic Usage

```ts
import { QueryClient } from "@tanstack/query-core";
import { createCollection } from "@tanstack/db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";

const todosCollection = createCollection(
  queryCollectionOptions({
    queryKey: ["todos"],
    queryFn: async () => (await fetch("/api/todos")).json(),
    queryClient,
    getKey: (item) => item.id,
  }),
);
```

## Configuration Options

### Required

- `queryKey` — Static array or function receiving `LoadSubsetOptions`
- `queryFn` — Fetches data from server
- `queryClient` — TanStack Query client instance
- `getKey` — Extracts unique key from item

### Query Options

- `select` — Extract array items from wrapped metadata
- `enabled` — Auto-run query (default: `true`)
- `refetchInterval` — Polling interval in ms (default: 0)
- `retry` / `retryDelay` — Retry config
- `staleTime` — Freshness duration
- `meta` — Custom metadata passed to queryFn context

### Collection Options

- `id` — Unique collection identifier
- `schema` — Item validation schema
- `startSync` — Start syncing immediately (default: `true`)

## Persistence Handlers

```ts
queryCollectionOptions({
  // ...
  onInsert: async ({ transaction }) => {
    await api.createTodos(transaction.mutations.map((m) => m.modified));
    // Return { refetch: false } to skip automatic refetch
  },
  onUpdate: async ({ transaction }) => {
    await api.updateTodos(transaction.mutations.map((m) => ({ id: m.key, changes: m.changes })));
  },
  onDelete: async ({ transaction }) => {
    await api.deleteTodos(transaction.mutations.map((m) => m.key));
  },
});
```

By default, successful handlers trigger a refetch. Return `{ refetch: false }` when:

- Server state matches what you sent
- You handle state via other mechanisms (WebSockets, SSE)
- You use direct writes to sync server response

## Direct Writes

Write directly to the synced data store, bypassing optimistic mutations and query refetch.

### Two Data Stores

1. **Synced Data Store** — Authoritative state from server via `queryFn`
2. **Optimistic Mutations Store** — Temporary changes, auto-rolled-back on failure

### API

```ts
await collection.utils.writeInsert(data); // Insert directly to sync store
await collection.utils.writeUpdate(data); // Update in sync store
await collection.utils.writeDelete(key); // Delete from sync store
await collection.utils.writeUpsert(data); // Insert or update
await collection.utils.writeBatch(() => {
  // Atomic batch
  collection.utils.writeInsert(item1);
  collection.utils.writeInsert(item2);
  collection.utils.writeDelete(id3);
});
await collection.utils.refetch(opts?); // Manual refetch (bypasses enabled: false)
```

Direct writes do NOT create optimistic mutations, do NOT trigger refetches, and update the TanStack Query cache immediately.

**Direct writes return promises — always await or catch them.** Errors (e.g. `writeUpdate` of a missing key, or a write before the collection is ready) reject the promise; they are not thrown synchronously. Inside a mutation function, await the write before returning: the optimistic state drops when the function settles, so an un-awaited write briefly shows the old synced row.

### Syncing Server-Computed Fields

```ts
onInsert: async ({ transaction }) => {
  const serverItems = await api.createTodos(transaction.mutations.map((m) => m.modified));
  await todosCollection.utils.writeBatch(() => {
    serverItems.forEach((item) => todosCollection.utils.writeInsert(item));
  });
  return { refetch: false };
};
```

## Important Behaviors

### Full State Sync

`queryFn` result is treated as **complete state**:

- Items in collection but not in result -> deleted
- Items in result but not in collection -> inserted
- Empty array -> all items deleted

### Partial/Incremental Fetches

Merge new data with existing cache data to return complete state:

```ts
queryFn: async ({ queryKey }) => {
  const existing = queryClient.getQueryData(queryKey) || [];
  const newData = await fetch(`/api/todos?since=${lastSync}`).then((r) => r.json());
  const map = new Map(existing.map((item) => [item.id, item]));
  newData.forEach((item) => map.set(item.id, item));
  return Array.from(map.values());
};
```

### Direct Writes vs Query Sync

If `queryFn` returns conflicting data, query data takes precedence. To prevent:

1. Use `{ refetch: false }` in persistence handlers
2. Set appropriate `staleTime`
3. Design `queryFn` for incremental updates
