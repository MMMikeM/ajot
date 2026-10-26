# Server Package

Hono API server with Drizzle ORM (Turso/libSQL). Package boundaries prevent server code from leaking into the client bundle.

## Tests

`pnpm test` runs the unit tests (`*.test.ts`, `vp test`); CI runs them before the e2e suites. `push-plan.ts` decides what each device is sent with no I/O, so it's tested directly; `push-queue.test.ts` mocks `./push` and uses fake timers for the one-second grouping.

## API routes

Routes are in `src/routes/`. Each file exports Hono route handlers.

## Database

Single Turso instance with embedded replica. `syncInterval: 60` keeps local SQLite in sync. All writes go through Turso (remote-first), reads are local.

## Query patterns

- **Always use `db.query` (relational API)** for reads — never `db.select().from()`.
- **Drizzle v1 `where` uses object syntax**, not `eq()` operators: `where: { id: someId }`.
- **`db.insert()` / `db.update()` / `db.delete()`** (classic API) are fine for writes.
- Check existing repos in `src/db/` for the canonical patterns before writing new queries.
- **Tasks are never removed, only hidden** (`deletedAt`), so Undo restores a task with its shares, notes and reminders for everyone. Every read of tasks filters `deletedAt: { isNull: true }`, a `subtasks` relation included; only a restore reads a deleted one. Notes of a deleted task drop out of the notes list with it.
- **Lists are hidden too** (`categories.deletedAt`), with what the delete changed beyond the list in `deletion`, so Undo puts back their collaborators, everyone's tasks and the shares filed there. Every read of categories filters `deletedAt: { isNull: true }` and leaves both columns out of what it sends. Removing a contact deletes both rows, but keeps them and the lists the two shared in `removed_contacts` for its Undo.
