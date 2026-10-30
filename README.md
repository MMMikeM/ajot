# Ajot

**A calm task list for your new tab page and your phone, as up to date in flight mode as it was online.**

<p>
<a href="https://github.com/MMMikeM/ajot/actions/workflows/deploy.yml"><picture><source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/github/actions/workflow/status/MMMikeM/ajot/deploy.yml?branch=main&label=CI&logo=githubactions&style=flat-square&colorA=151b23&logoColor=f0f6fc"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/MMMikeM/ajot/deploy.yml?branch=main&label=CI&logo=githubactions&style=flat-square&colorA=f6f8fa&logoColor=1f2328"></picture></a>
<a href="#from-zero-to-synced"><picture><source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/Firefox-140%2B-gray?logo=firefoxbrowser&style=flat-square&colorA=151b23&colorB=7c5cff&logoColor=f0f6fc"><img alt="Firefox 140+" src="https://img.shields.io/badge/Firefox-140%2B-gray?logo=firefoxbrowser&style=flat-square&colorA=f6f8fa&colorB=7c5cff&logoColor=1f2328"></picture></a>
<a href="#from-zero-to-synced"><picture><source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/Chrome-121%2B-gray?logo=googlechrome&style=flat-square&colorA=151b23&colorB=7c5cff&logoColor=f0f6fc"><img alt="Chrome 121+" src="https://img.shields.io/badge/Chrome-121%2B-gray?logo=googlechrome&style=flat-square&colorA=f6f8fa&colorB=7c5cff&logoColor=1f2328"></picture></a>
<a href="#from-zero-to-synced"><picture><source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/PWA-installable-gray?logo=pwa&style=flat-square&colorA=151b23&colorB=7c5cff&logoColor=f0f6fc"><img alt="PWA" src="https://img.shields.io/badge/PWA-installable-gray?logo=pwa&style=flat-square&colorA=f6f8fa&colorB=7c5cff&logoColor=1f2328"></picture></a>
</p>

Most task apps are a website wearing an app's clothes: open one with no signal and you get a spinner, or the list as it was the last time you looked. Ajot keeps every list on the device and refreshes it in the background whenever the browser lets anything run, so a new tab shows your tasks instantly and turning on flight mode loses nothing.

It's one codebase that runs as a Firefox extension and a Chrome extension, both replacing the new tab page, and as an installable web app for your phone. Signed out, tasks stay on the device. Signed in to a server you run yourself, they sync across your devices and between the people you invite.

- Tasks with subtasks, notes, due dates and assignees. Hold a row to drag it into place.
- Files and photos on a task, there to view offline and sent once you're back online.
- An Inbox plus your own categories. Share one task or a whole category with a contact.
- Search across every list, done tasks, notes and descriptions included.
- Right-click a page, a link, an image or selected text to make it a task, or send it straight to someone.
- Undo for anything that completes or deletes.

## From zero to synced

**1. Run a server.** It needs a [Turso](https://turso.tech) database and a Docker host with HTTPS; the repo deploys to Fly.io. [Self-hosting](docs/self-hosting.md) walks through it in six steps. The first account on a new server needs no invite, and everyone after that signs up from an invite link. Attachments also need a Tigris bucket on Fly; without one the app simply doesn't offer them.

**2. Install the extension.** It isn't on the stores yet. Each [release](https://github.com/MMMikeM/ajot/releases) has both attached: in Firefox, open the signed `.xpi` to install it, and it updates itself to later releases from then on; in Chrome, unzip `ajot-<version>-chrome.zip`, open `chrome://extensions`, turn on **Developer mode** and load the folder unpacked, which you replace by hand for a new release. Or build it yourself:

```bash
pnpm install
pnpm build:ext
```

In Firefox, open `about:debugging`, choose **This Firefox → Load Temporary Add-on** and pick `packages/client/dist-extension/firefox/manifest.json`. In Chrome, open `chrome://extensions`, turn on **Developer mode** and load `packages/client/dist-extension/chrome` unpacked. Every deploy also uploads store-ready zips of both as CI artifacts.

**3. Sign in.** In the extension, choose **Sign in** and enter your server's address. On your phone, open the same address and add it to the home screen.

## Staying current offline

While the app is open, a live connection to the server saves each change to IndexedDB as it arrives. Changes made offline wait in a queue and send once you're back. With no page open, each context keeps itself fresh in its own way, saving the lists and every attachment's thumbnail, and sending files attached offline once it's online:

| Context           | With no tab open                                                                                                              |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Firefox extension | The persistent background page keeps the live connection open.                                                                |
| Chrome extension  | A silent Web Push wakes the background worker, which fetches and saves the lists.                                             |
| PWA               | Every push saves the changed rows it carries and refetches. Installed Chromium apps also refresh on Periodic Background Sync. |

Browsers make every web push show a notification, so the PWA can't refresh silently. Each change shows either a notification you've chosen in **Settings** for that device (edits from your other devices, new shares, completions, the overdue digest), or else a quiet "Your lists were updated" that makes no sound, replaces the last one and never goes to the device that made the change. Either way the app wakes and saves it.

## Development

Copy `.env.example` to `.env.dev`, fill it in with a Turso database and Web Push keys made as in [self-hosting](docs/self-hosting.md), then create the tables and start everything:

```bash
pnpm db:migrate
pnpm dev
```

| Command          | What it does                                                         |
| ---------------- | -------------------------------------------------------------------- |
| `pnpm dev`       | The API on port 3000 and the client dev server, which proxies `/api` |
| `pnpm build:ext` | Builds the client, then both extensions into `dist-extension/`       |
| `pnpm test`      | Server and client unit tests                                         |
| `pnpm test:e2e`  | Playwright against a production build and a throwaway database       |
| `pnpm check`     | Format, lint, typecheck, knip and the import-graph rules             |

The server is Hono and Drizzle on Turso. The client is React 19 with TanStack Router, DB and Query, and a Workbox service worker. Vite+ runs the monorepo's tasks. Pushes to `main` deploy through CI once the tests pass.

To release the extensions, bump `version` in `packages/client/package.json`, merge it, and push a matching tag (`git tag v1.2.0 origin/main && git push origin v1.2.0`). `.github/workflows/release.yml` builds both and attaches them, with the source, to a GitHub release. With `AMO_API_KEY` and `AMO_API_SECRET` set as repository secrets (an API key from addons.mozilla.org), it signs the Firefox add-on for self-distribution and attaches the `updates.json` an installed copy checks, so Firefox updates to it within a day; without them the Firefox zip only loads as a temporary add-on.

## License

[AGPL-3.0](LICENSE). Run it, change it and host it for anyone you like. If you let other people use a changed version over a network, offer them its source.
