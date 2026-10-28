# Repos

## When a row isn't there

- **Throw when every caller would refuse the same way; return `undefined` when a caller decides.** `categoryRepo.findById`, a stale `update`, `remove` and `inviteTokenRepo.findInviterName` throw, so no route can forget the refusal. `noteRepo.findOwn`, `inviteTokenRepo.claim` (a 410 to accept, a 403 to sign up), `taskRepo.markEdited`, `userRepo.findById` (a name falls back to "Someone"), `sessionRepo.findValid` and `userRepo.findWithPassword` (a 401 that mustn't say which part was wrong) return `undefined`, as `findFirst` and `rows.at(0)` do. Never `null` for "not there"; a yes-or-no question returns a boolean (`exists`, `canUse`).
- **A lookup a route runs in a `Promise.all` beside `requireTask` or `requireList` returns `undefined` when its refusal could differ from theirs**, even when every caller refuses alike: thrown, it races the access check's 404 or 403, and whichever settles first answers (`contactRepo.findContactUser`'s 400). One that refuses with the same 404 may throw (`findByIdWithCollaborators`).

## Errors

- **Throw a class from `errors.ts`, never `new HTTPException`**, in repos and routes alike. `NotFoundError` (404), `StaleUpdateError` and `IdTakenError` (409) and `InsertFailedError` (500) are `LoggedHTTPException`s: their message says what happened by kind, and the ids go in `detail`, which `onError` logs. `BadRequestError`, `ForbiddenError`, `ConflictError` and `GoneError` take the message. Only the 401s, the rate limiter's 429s and the cron's missing secret (a 500) have no class.
- **A message is what a person reads** (`../CLAUDE.md`): what happened and what they can do, never an id, a table or "Not authorized". Give `NotFoundError` no id that's a secret, such as an invite's token: `detail` is logged.
