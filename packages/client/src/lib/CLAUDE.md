# Client Library (`src/lib/`)

Client-only code. SPA — no `typeof window` or `isServer` guards needed.

## SSR prerender safety

Any module that accesses `localStorage`, `window`, or browser-only APIs (`IndexedDB`) at **module init time** (top-level code) must guard with `typeof localStorage !== 'undefined'` / `typeof window !== 'undefined'`. The SSR prerender runs in Node.js where these globals don't exist. Function bodies are fine — only top-level statements matter.

## Structure

- **`db/`** — TanStack DB layer: `collections.ts`, `hooks.ts` (useLiveQuery + mutations), `offline.ts` (offline executor and its mutation functions), `shared-outbox.ts` (every tab queues in one outbox, the leader sends it), `tab-leader.ts` (which tab leads, and the next one when it closes), `outbox-storage.ts`, `synced-writes.ts`, `add-task.ts`
- **`sync/`** — Live sync mechanisms: `sse.ts` (browser tab SSE), `push.ts` (Web Push), `register-sw.ts`, `prewarm.ts` (save every list for the next page opened offline), `prewarm-extension.ts` (the backgrounds' session and 5-minute alarm), `worker-session.ts` (the PWA worker's copy of the token)
- **`api-client.ts`** — `apiClient(session)`, the server's routes typed from the server, for any context; `api.ts` builds the page's `client` on it, signing each request with the page's session. Nothing else in the client calls `fetch` (lint refuses it), except `files/bucket.ts` for the bucket's presigned URLs
- **`files/`** — attachments a device holds: the `ajot-files` store, preparing a file, and the upload queue. Outside `db/`, so the backgrounds and the worker can send uploads too
- **`snapshot-store.ts`** — the IndexedDB lists a new tab starts from; outside `db/` so the backgrounds can write them
- **`auth/`** — Identity: `signed-in.ts` (the token and its user, one store so no tab ever holds one account's token with another's user), `token.ts` and `current-user.ts` (read it), `session.ts` (sign-in, sign-out, the backgrounds' copy, and expiry on a 401 from `api.ts`)
- **`state/`** — App UI state: `active-category.ts`, `undo.ts`
- **`hooks/`** — Standalone React hooks: `use-install-prompt.ts`, `use-swipe-reveal.ts`, `use-invite.ts` (People's invite link, also offered by the sharing sheets)
- **`constants.ts`** — re-exports from `@newtab-todo/shared`

## Non-obvious decisions

- **`sse.ts` vs `push.ts`** — SSE is for browser tabs (always-connected). Push is for when no tabs are open (service worker receives push event). In the Firefox extension, tabs use neither: they get runtime messages from the background page, which holds SSE. With no Web Push there, the server also writes each notification on the stream (`notification` events), and that background shows it with `browser.notifications`; like Chrome's extension it has no Settings, so every kind shows. Chrome extension tabs open their own SSE, and the background service worker receives push.
- **Everything that can run with no page open pre-warms the snapshot**, so the app opens in flight mode on recent lists. Firefox's background saves after SSE opens and after each burst of changes; Chrome's on startup, sign-in and every push except `deploy`; both every 5 minutes on an alarm. The PWA's worker saves on every push and on Periodic Background Sync. Each save fetches all four lists and is dropped if the account changed meanwhile. A push's rows (`saved-rows.ts`) are saved first, only for the signed-in account, so they're kept when that fetch fails. A tab saves each change as it lands, and anything still waiting when it's hidden or closed.
