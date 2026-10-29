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

- **A newer deploy's worker taking over asks for a reload** (`register-sw.ts`, `components/update-banner.tsx`): a banner across the top with Reload, which can't be dismissed, while the page is on screen; the shell, sidebar and sheets sit `--banner-h` lower while it shows, since reloading would lose whatever the user is in the middle of, and a reload by itself once the page is hidden. The worker answers with its build (`MSG_BUILD_VERSION`), so a first install or a worker of the page's own build offers nothing. A deploy restarts the server, so SSE reopening after a drop asks for the new worker straight away; the PWA gets no deploy push, which goes to extensions only.

- **`sse.ts` vs `push.ts`** — SSE is for browser tabs (always-connected). Push is for when no tabs are open (service worker receives push event). In the Firefox extension, tabs use neither: they get runtime messages from the background page, which holds SSE. With no Web Push there, the server also writes each notification on the stream (`notification` events), and that background shows it with `browser.notifications`; like Chrome's extension it has no Settings, so every kind shows. Chrome extension tabs open their own SSE, and the background service worker receives push.
- **Everything that can run with no page open pre-warms the snapshot**, so the app opens in flight mode on recent lists. Firefox's background saves after SSE opens and after each burst of changes; Chrome's on startup, sign-in and every push except `deploy`; both every 5 minutes on an alarm. The PWA's worker saves on every push and on Periodic Background Sync. Each save fetches all four lists and is dropped if the account changed meanwhile. A push's rows (`saved-rows.ts`) are saved first, only for the signed-in account, so they're kept when that fetch fails. A tab saves each change as it lands, and anything still waiting when it's hidden or closed.
- **Every context sends queued uploads** (`files/sender.ts`, one run at a time per context and one context at a time through the `ajot-uploads` lock): a tab on startup, reconnect and each queued file; Firefox's background on startup, the stream opening and the alarm; Chrome's background whenever its worker wakes, on the alarm and on push, files up to 5 MB, since a slower PUT outlives the worker; the PWA's worker on push, the same size, and on Background Sync, any size, which a tab registers when it queues a file. Opening the app or reconnecting makes every waiting upload due at once (`retryWaitingNow`).
- **The files a device keeps follow the lists** (`files/file-job.ts`, under the `ajot-files` lock): after every background prewarm (outside prewarm's queue, so a push's rows never wait on bytes) and whenever a tab's attachments list answers 200, it saves every thumbnail the list shows, up to 200 a run, then evicts what `files/evict-plan.ts` says: never without a list fresh from the server for a known account, never a pinned upload or a blob saved after that list was fetched; another account's blobs, those missing from the lists for a day (so a deleted task's are still there for its Undo), and full files over 100 MB (or 5% of quota), least recently shown first. Signing out deletes the account's files except uploads still waiting.
