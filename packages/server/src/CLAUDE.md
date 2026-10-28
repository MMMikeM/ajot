# Server Package

Hono API server with Drizzle ORM (Turso/libSQL). Package boundaries prevent server code from leaking into the client bundle.

## Tests

`pnpm test` runs the unit tests (`*.test.ts`, `vp test`); CI runs them before the e2e suites. `push-plan.ts` decides what each device is sent with no I/O, so it's tested directly; `push-queue.test.ts` mocks `./push` and uses fake timers for the one-second grouping.

## API routes

Routes are in `src/routes/`. Each file exports Hono route handlers.

- **What a client is told is what a person reads.** The app shows a route's `{ error }` as it is. Input a schema refuses is answered in that shape with its first issue's message (`rejectInvalidInput`, the root app's `defaultHook`), so a field a person can get wrong needs a message worded for them. `NotFoundError` and the other `LoggedHTTPException`s (`db/errors.ts`) say what happened by kind, and `onError` logs the ids they carry. When repos throw and when they return `undefined` is in `db/CLAUDE.md`.
- **A route declares every status its handler and the repos under it can throw**, with `...errors(403, 404)` (`routes/crud.ts`), so the OpenAPI document and the client's `hc` response types match what it answers. A description written for the route stays a `jsonContent(errorSchema, "…")`. 413, 422 and 500 are app-wide (`onError`), and so is the 400 a schema refuses, declared only where the handler throws one too.

## Database

One Turso database, reached over HTTP by `@tursodatabase/serverless` (`db/client.ts`): every statement is one round trip, so a query in a loop costs one each.

- **A connection runs one statement at a time.** `db` sends SELECTs to three reader connections in turn and everything else to one, in order (`PooledConnection` in `db/connection.ts`), so concurrent requests and a `Promise.all` of reads don't queue behind each other. Transactions get a connection of their own (`inTransaction`).
- **libSQL server ends a session idle for 10 s** and refuses the next request on it. Reads are retried once on a transport failure, and any statement once on an expired session, which never ran, on a new one (`db/connection.ts`).
- **Session lookups are cached for 30 s** (`db/session.repo.ts`); its deletes drop them. `reset-password.ts` runs in a process of its own, so after deleting the user's sessions it tells the running server, at `SERVER_URL` (default `localhost:$PORT`), through `POST /api/auth/sessions-revoked`, signed with the database token (`session-revocation.ts`). If that can't reach it, they keep working there for up to 30 s. It reaches the one machine that answers, as SSE and the push queue assume there is.

## Who can reach what

- **Ask the views, never write the check again.** Who can see, edit or delete a task is the `task_access` view, and who's in a list is `list_members` (both in `db/views.ts`, created by `migrate.ts` on every run). Routes go through `requireTask`, `requireList` and `audienceOf` (`routes/task-users.ts`) and `categoryRepo.canUse`; a route that compares owners, shares or collaborators itself is the drift these replace.
- **A write that changes who reaches a task or list tells people through `sendReachChanges`** (`routes/reach.ts`). Read `reachRepo.read` before the write, inside its transaction when it has one, and pass it the result: whoever gained a task or list gets all of it, whoever lost one has it taken off, whoever kept one gets what the write changed. An audience worked out in the route drifts from the view, and sends an update for a row the recipient doesn't have, or nothing to whoever lost one.
- **The client's copy is `shared/task-access.ts`**, for what a page decides offline. Its paths and the view's SQL fragments are both keyed by `AccessPath`, so adding a way in fails to compile until both have it, and `task-access.test.ts` runs the migrations, as `migrate.ts` does, into an in-memory SQLite and checks the two agree row for row. Add a case there with any new path.

## Query patterns

- **Always use `db.query` (relational API)** for reads — never `db.select().from()`, except for the views, which the relational API can't read.
- **Drizzle v1 `where` uses object syntax**, not `eq()` operators: `where: { id: someId }`.
- **`db.insert()` / `db.update()` / `db.delete()`** (classic API) are fine for writes.
- Check existing repos in `src/db/` for the canonical patterns before writing new queries.
- **Deleting a task only hides it** (`deletedAt`), so Undo restores it with its shares, notes and reminders for everyone. `db/purge.repo.ts` removes it 30 days later, at startup and then daily (`purge.ts`), with what cascades from it, unless a subtask under it was deleted more recently. A live subtask's parent is live (`live_subtask_has_live_parent`, a foreign key on the generated `live` column, which no read or write sends): a subtask's restore under a deleted parent is refused, so Undo restores the parent first, and a delete hides the parent's live subtasks in the same statement. Every read of tasks filters `deletedAt: { isNull: true }`, a `subtasks` relation included; only a restore reads a deleted one. Notes of a deleted task drop out of the notes list with it.
- **Lists are hidden too** (`categories.deletedAt`), with what the delete changed beyond the list in `deletion`, so Undo puts back their collaborators, everyone's tasks and the shares filed there. Every read of categories filters `deletedAt: { isNull: true }` and leaves both columns out of what it sends. The purge removes a list 30 days after it was deleted, with its collaborators, unless a live task or share is still filed in it. Removing a contact deletes both rows, but keeps them and the lists the two shared in `removed_contacts` for its Undo, for an hour (the next removal drops older ones). A list's owner removing someone keeps their row and what leaving moved in `removed_collaborators` for its Undo, for an hour (the next removal drops older ones); adding them afresh drops it, and someone who leaves gets no record. The purge drops both kinds of record once their hour is up; the two becoming contacts again through an invite (`inviteTokenRepo.consume`) drops a `removed_contacts` record between them. It also drops sessions past their expiry, invites used or expired 30 days ago, and notifications sent a week ago or due 30 days ago and never sent.
- **`sort_order` holds a fractional-indexing key or null**, a `CHECK` that `isSortKey` (`shared/sort-order.ts`) mirrors, base-62 digits only, where fractional-indexing itself takes any character. A malformed key a client sends is left out of the write (`db/sort-key.ts`) rather than refusing it, and a constraint the database still refuses is a 422, which the client doesn't retry.
