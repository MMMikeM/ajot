# Ajot

**A calm task list for your new tab page and your phone, as up to date in flight mode as it was online.**

<p>
<a href="https://github.com/MMMikeM/browser-extension-newtab/actions/workflows/deploy.yml"><picture><source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/github/actions/workflow/status/MMMikeM/browser-extension-newtab/deploy.yml?branch=main&label=CI&logo=githubactions&style=flat-square&colorA=151b23&logoColor=f0f6fc"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/MMMikeM/browser-extension-newtab/deploy.yml?branch=main&label=CI&logo=githubactions&style=flat-square&colorA=f6f8fa&logoColor=1f2328"></picture></a>
<a href="#from-zero-to-synced"><picture><source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/Firefox-140%2B-gray?logo=firefoxbrowser&style=flat-square&colorA=151b23&colorB=7c5cff&logoColor=f0f6fc"><img alt="Firefox 140+" src="https://img.shields.io/badge/Firefox-140%2B-gray?logo=firefoxbrowser&style=flat-square&colorA=f6f8fa&colorB=7c5cff&logoColor=1f2328"></picture></a>
<a href="#from-zero-to-synced"><picture><source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/Chrome-121%2B-gray?logo=googlechrome&style=flat-square&colorA=151b23&colorB=7c5cff&logoColor=f0f6fc"><img alt="Chrome 121+" src="https://img.shields.io/badge/Chrome-121%2B-gray?logo=googlechrome&style=flat-square&colorA=f6f8fa&colorB=7c5cff&logoColor=1f2328"></picture></a>
<a href="#from-zero-to-synced"><picture><source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/PWA-installable-gray?logo=pwa&style=flat-square&colorA=151b23&colorB=7c5cff&logoColor=f0f6fc"><img alt="PWA" src="https://img.shields.io/badge/PWA-installable-gray?logo=pwa&style=flat-square&colorA=f6f8fa&colorB=7c5cff&logoColor=1f2328"></picture></a>
</p>

Most task apps are a website wearing an app's clothes: open one with no signal and you get a spinner, or the list as it was the last time you looked. Ajot keeps every list on the device and refreshes it in the background whenever the browser lets anything run, so a new tab shows your tasks instantly and turning on flight mode loses nothing.

It's one codebase that runs as a Firefox extension and a Chrome extension, both replacing the new tab page, and as an installable web app for your phone. Signed out, tasks stay on the device. Signed in to a server you run yourself, they sync across your devices and between the people you invite.

- Tasks with subtasks, notes, due dates and assignees. Hold a row to drag it into place.
- An Inbox plus your own categories. Share one task or a whole category with a contact.
- Right-click a page, a link or selected text to make it a task, or send it straight to someone.
- Undo for anything that completes or deletes.

## From zero to synced

**1. Run a server.** It needs a [Turso](https://turso.tech) database and a Docker host with HTTPS; the repo deploys to Fly.io. [Self-hosting](docs/self-hosting.md) walks through it in six steps. The first account on a new server needs no invite, and everyone after that signs up from an invite link.

**2. Install the extension.** It isn't on the stores yet, so build it:

```bash
pnpm install
pnpm build:ext
```

In Firefox, open `about:debugging`, choose **This Firefox → Load Temporary Add-on** and pick `packages/client/dist-extension/firefox/manifest.json`. In Chrome, open `chrome://extensions`, turn on **Developer mode** and load `packages/client/dist-extension/chrome` unpacked. Every deploy also uploads store-ready zips of both as CI artifacts.

**3. Sign in.** In the extension, choose **Sign in** and enter your server's address. On your phone, open the same address and add it to the home screen.

## Staying current offline

While the app is open, a live connection to the server saves each change to IndexedDB as it arrives. Changes made offline wait in a queue and send once you're back. With no page open, each context keeps itself fresh in its own way:

| Context           | With no tab open                                                                                                              |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Firefox extension | The persistent background page keeps the live connection open.                                                                |
| Chrome extension  | A silent Web Push wakes the background worker, which fetches and saves the lists.                                             |
| PWA               | Every push saves the changed rows it carries and refetches. Installed Chromium apps also refresh on Periodic Background Sync. |

Browsers make every web push show a notification, so the PWA can't refresh silently. **Settings** chooses which kinds of change notify on each device, such as edits from your other devices, new shares, completions or the overdue digest, and only those wake the app.

## Development

Copy `.env.example` to `.env.dev`, fill it in with a Turso database and Web Push keys made as in [self-hosting](docs/self-hosting.md), then push the schema and start everything:

```bash
pnpm db:push
pnpm dev
```

| Command          | What it does                                                         |
| ---------------- | -------------------------------------------------------------------- |
| `pnpm dev`       | The API on port 3000 and the client dev server, which proxies `/api` |
| `pnpm build:ext` | Builds the client, then both extensions into `dist-extension/`       |
| `pnpm test`      | Server unit tests                                                    |
| `pnpm test:e2e`  | Playwright against a production build and a throwaway database       |
| `pnpm check`     | Format, lint, typecheck, knip and the import-graph rules             |

The server is Hono and Drizzle on Turso. The client is React 19 with TanStack Router, DB and Query, and a Workbox service worker. Vite+ runs the monorepo's tasks. Pushes to `main` deploy through CI once the tests pass.

## License

[AGPL-3.0](LICENSE). Run it, change it and host it for anyone you like. If you let other people use a changed version over a network, offer them its source.
