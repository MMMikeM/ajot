# Server Package

Hono API server with Drizzle ORM (Turso/libSQL). Package boundaries prevent server code from leaking into the client bundle.

## Tests

`pnpm test` runs the unit tests (`*.test.ts`, `vp test`); CI runs them before the e2e suites. `push-plan.ts` decides what each device is sent with no I/O, so it's tested directly; `push-queue.test.ts` mocks `./push` and uses fake timers for the one-second grouping.

## API routes

Routes are in `src/routes/`. Each file exports Hono route handlers.

## Database

One Turso database, reached over HTTP by `@tursodatabase/serverless` (`db/client.ts`): every statement is one round trip, so a query in a loop costs one each.

- **A connection runs one statement at a time.** `db` sends SELECTs to three reader connections in turn and everything else to one, in order (`db/connections.ts`), so concurrent requests and a `Promise.all` of reads don't queue behind each other. Transactions get a connection of their own (`inTransaction`).
- **libSQL server ends a session idle for 10 s** and refuses the next request on it, so a connection idle for 5 s starts a new one. Reads are retried once on a transport failure, and any statement once on an expired session, which never ran (`db/retry.ts`).
- **Session lookups are cached for 30 s** (`db/session.repo.ts`); its deletes drop them. `reset-password.ts` runs in a process of its own, so the sessions it deletes keep working on the running server for up to 30 s, or until it restarts.

## Who can reach what

- **Ask the views, never write the check again.** Who can see, edit or delete a task is the `task_access` view, and who's in a list is `list_members` (both in `db/views.ts`, created by `migrate.ts` on every run). Routes go through `requireTask`, `requireList` and `audienceOf` (`routes/task-users.ts`) and `categoryRepo.canUse`; a route that compares owners, shares or collaborators itself is the drift these replace.
- **A write that changes who reaches a task or list tells people through `sendReachChanges`** (`routes/reach.ts`). Read `reachRepo.read` before the write, inside its transaction when it has one, and pass it the result: whoever gained a task or list gets all of it, whoever lost one has it taken off, whoever kept one gets what the write changed. An audience worked out in the route drifts from the view, and sends an update for a row the recipient doesn't have, or nothing to whoever lost one.
- **The client's copy is `shared/task-access.ts`**, for what a page decides offline. Its paths and the view's SQL fragments are both keyed by `AccessPath`, so adding a way in fails to compile until both have it, and `task-access.test.ts` runs the migrations, as `migrate.ts` does, into an in-memory SQLite and checks the two agree row for row. Add a case there with any new path.

## Query patterns

- **Always use `db.query` (relational API)** for reads — never `db.select().from()`, except for the views, which the relational API can't read.
- **Drizzle v1 `where` uses object syntax**, not `eq()` operators: `where: { id: someId }`.
- **`db.insert()` / `db.update()` / `db.delete()`** (classic API) are fine for writes.
- Check existing repos in `src/db/` for the canonical patterns before writing new queries.
- **Tasks are never removed, only hidden** (`deletedAt`), so Undo restores a task with its shares, notes and reminders for everyone. Every read of tasks filters `deletedAt: { isNull: true }`, a `subtasks` relation included; only a restore reads a deleted one. Notes of a deleted task drop out of the notes list with it.
- **Lists are hidden too** (`categories.deletedAt`), with what the delete changed beyond the list in `deletion`, so Undo puts back their collaborators, everyone's tasks and the shares filed there. Every read of categories filters `deletedAt: { isNull: true }` and leaves both columns out of what it sends. Removing a contact deletes both rows, but keeps them and the lists the two shared in `removed_contacts` for its Undo.
