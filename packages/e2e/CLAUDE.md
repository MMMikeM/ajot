# E2E Tests (`packages/e2e`)

Playwright test suite. Two projects: `desktop` (Chrome) runs every spec, and `mobile` (iPhone 14 via Chromium) only `TOUCH_SPECS` in `playwright.config.ts`, the specs where the touch layout or gestures differ. Add a spec there when it checks something the touch layout does its own way.

## The stack

`pnpm test:e2e` brings its own, so it needs Docker and nothing else running: Playwright's `webServer` starts `api-stack.ts` (throwaway libSQL and versitygw containers, the latter an S3 bucket that checks presigned signatures as Tigris does, then the migrations and the API server on port 3180) and the client's production build on 5180 (`vp preview`), proxying to it. The `test` task in this package's `vite.config.ts` builds the client first: on the dev server, compiling each module as a page asked for it made every load slow on CI. The build's service worker is blocked, so it can't answer requests a test mocks. Each run starts from an empty database and bucket, and stopping the run removes the containers. Set `BASE_URL` to run against a stack that's already up instead; nothing is started then.

## Entry points

- `*.spec.ts` — Playwright test files, picked up automatically
- `screenshot.ts` — standalone script (`pnpm screenshot`), captures viewport screenshots + axe contrast audit
- `screenshot-mock.ts` — the same against mocked `/api` data (`pnpm --dir packages/e2e screenshot:mock`); needs only the Vite dev server
- `task-rows`, `navigation`, `delete-list`, `delete-others-task`, `sign-up`, `startup`, `list-sharing`, `undo-window`, `accessibility`, `remove-contact` (`.spec.ts`) — UI behaviour and axe checks against mocked `/api` data (`openList` in `helpers/mock-api.ts`); they run without the API server or database, on desktop only
- `touch.spec.ts` — the same against the phone layout, only where touch gets there another way: the lists sheet for the sidebar, swipe actions for hover buttons, the install offer, the longer Undo window, and axe on the phone layout. It skips itself on desktop
- `skeleton.spec.ts` — the prerendered loading skeleton against the loaded list. It needs no API or accounts, so `pnpm test:e2e:prerender` runs it on its own: `playwright.prerender.config.ts` serves the same build with `vp preview` on another port, with the service worker allowed. Plain `pnpm test:e2e` skips it
- `stale-chunk.spec.ts` — a lazy chunk removed by a deploy reloads the page once. Vite only fires `vite:preloadError` in a production build, so it runs with the prerender suite too
- `update-reload.spec.ts` — a newer deploy's service worker taking over offers a reload in a toast, and reloads a hidden page itself; one of the page's own build offers nothing. It needs the build's worker, so it runs with the prerender suite
- `perf.spec.ts` — a DOMContentLoaded budget, also in the prerender suite, so the main suite's workers don't slow its loads. It keeps the fastest of three cold loads
- `extension.spec.ts`, `pwa-background.spec.ts` — the flight-mode suite: with no page open, the Chrome extension's background (at sign-in, on a sync push) and the PWA's worker (on a `changes` push, on a periodic sync) save the lists, then a page opened offline shows them. Pushes and periodic syncs are delivered over CDP (`helpers/background.ts`). `pnpm test:e2e:background` builds the extension (and so the client) and runs `playwright.background.config.ts`, which adds `vp preview` on 4175 to the usual stack; CI runs it after the prerender suite, in parallel with the main suite's shards. Playwright can't load the Firefox add-on, so its background is checked by hand. `pwa-background.spec.ts` also saves a push's rows with the network off, opens a notification's `/task/<id>` offline, which needs the worker's app-shell fallback, and checks that a trigger muted in Settings stays muted on that device, with a stubbed subscription, since headless Chromium can't subscribe to a push service
- `filmstrip.ts` — standalone script, CDP screencast during page load
- `startup-bench.ts` — standalone script: reloads a production build (`vp preview`) against mocked data and prints the median of each `[startup]` step, under 4× CPU throttling by default. Compare chunking or startup changes with it, not with byte counts
- `interaction-bench.ts` — standalone script: against the same build and mocked data plus `--tasks` extra rows (150 by default), checks a reload and then typing, adding, ticking, opening and closing a task, scrolling, and switching lists (desktop). For each it prints INP (the slowest Event Timing entry), CLS (the layout shift Core Web Vitals counts) and animation frames over 50ms, then the elements that shifted and the scripts behind the long frames. `--runs`, `--cpu` (4× by default) and `--mobile` (iPhone 14). Use it for jank and layout shift too, not only speed. Clicks go to precomputed points, since a locator's `click()` runs checks in the page that Event Timing counts as input delay. `startup-bench.ts` uses the default ~15 mock tasks, so it won't show what a long list costs; this one will

## Helpers (`helpers/`)

| File            | What it exports                                                                                               |
| --------------- | ------------------------------------------------------------------------------------------------------------- |
| `users.ts`      | `USER_1`, `USER_2` — dedicated e2e accounts (Alice / Bob)                                                     |
| `stack.ts`      | `API_PORT`, `CLIENT_PORT`, `BASE_URL`, `API_URL` — where the suite finds the app                              |
| `auth.ts`       | `getOrCreateUser(user, inviter?)` — login, or signup (invited) on first run; `signIn(page, auth)`             |
| `api.ts`        | `apiRequest` throws on a refusal, `send` returns it; `newTask`, `addTask` and kin; `tasksOf`, `notesOf`       |
| `app.ts`        | `waitForAppReady`, `createTask`, `createCategory`, `clearLocalStorage`, `clearIDB`                            |
| `sync.ts`       | `createSyncTracker(page)` — tracks non-GET `/api/*` mutations, exposes `waitForSync()` + `assertNoFailures()` |
| `live.ts`       | `listenLive(page)` — `open()` waits for the event stream, `expectHeard()` an event, `assertAllApplied()`      |
| `screenshot.ts` | `takeScreenshot`, `forBothViewports`, `reportViolations` — used by the screenshot script                      |
| `mock-api.ts`   | `mockApi(page, opts)` — serves `/api/*` from in-memory fixtures and signs the page in (no server needed)      |

## Fixtures (`fixtures.ts`)

Specs import `test` and `expect` from here, never `@playwright/test` (lint refuses it): every page in its contexts fails the test on a Content Security Policy violation (`helpers/csp.ts`), which the report-only policy would only log. A context a spec opens itself is watched only if it calls `watchCsp`. The fixtures:

- `appPage` — navigated to `/` and ready (unauthenticated)
- `user1Auth` / `user2Auth` — this worker's own Alice and Bob (`e2e_alice_<worker>`), contacts of each other
- `user1Page` — signed in as `user1Auth` (default context)
- `user2Page` — signed in as `user2Auth` in an **isolated browser context** — use alongside `user1Page` for cross-user tests
- `syncTracker` — auto-calls `assertNoFailures()` in teardown

## Test users

`global-setup.ts` makes `USER_1` before any worker starts: a new server takes one signup without an invite, and workers racing to make it all failed but one. Each worker then gets its own Alice and Bob, invited by `USER_1`. Specs clear their account's tasks and lists in `beforeEach`, which on one shared account deleted what other workers' tests had just made. Against a persistent `BASE_URL` stack the accounts are reused (login) on later runs.

## Non-obvious decisions

- **`mockApi` answers `/api/events` with 204** — EventSource stops reconnecting on a 204, so the mocked page doesn't loop on the SSE stream; `sse.ts`'s backoff still retries it, at most once a minute after the first few attempts. It also marks the swipe hint as seen by default, because the one-time peek slides the first row on touch.
- **`user2Page` uses a separate `browser.newContext()`** so localStorage is not shared with `user1Page`. This is required for cross-user isolation; plain `page` instances share the same context and therefore the same origin storage.
- **`waitForSync` polls, not `networkidle`** — the app holds a persistent SSE connection which keeps `networkidle` from ever resolving.
- **`createCategory` has two variants** — desktop uses `placeholder="Name..."`, mobile sheet uses `placeholder="List name..."`. Pass `"sidebar"` or `"sheet"` accordingly.
