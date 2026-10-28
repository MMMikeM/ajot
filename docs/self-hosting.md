# Self-hosting a sync server

The browser extensions keep tasks on the device until they're pointed at a sync server. A server
syncs your devices, shares lists between its users, and serves the web app (PWA) at its own
address. Nobody runs a public one: you run your own and invite the people you want on it.

## What you need

- A [Turso](https://turso.tech) database. The free tier is plenty.
- Somewhere to run the Docker image over HTTPS. The repo's `fly.toml` deploys to
  [Fly.io](https://fly.io); any Docker host works. The extensions only connect to `https://`
  servers (and `localhost`), and Web Push needs HTTPS too.
- Node 24 and pnpm, to push the database schema.

## 1. Create the database

```sh
turso db create todo
turso db show --url todo        # TURSO_DATABASE_URL
turso db tokens create todo     # TURSO_AUTH_TOKEN
```

## 2. Create the tables

From a clone of this repo:

```sh
pnpm install
TURSO_DATABASE_URL=… TURSO_AUTH_TOKEN=… pnpm db:migrate
```

Run it again after pulling changes that add a migration under `packages/server/drizzle`. A database set up with the old `db:push` is picked up as it is: its tables count as the first migration.

## 3. Generate Web Push keys

Push wakes the Chrome extension to sync with no tabs open, and the PWA uses it for background sync
and notifications.

```sh
pnpm --filter @newtab-todo/server exec node -e "import('@mmmike/web-push').then(async (m) => console.log(await m.generateVapidKeys()))"
```

Keep the private key secret. Changing the keys later makes every device subscribe again.

## 4. Configure and deploy

| Variable             | Required | What it is                                                           |
| -------------------- | -------- | -------------------------------------------------------------------- |
| `TURSO_DATABASE_URL` | yes      | From step 1                                                          |
| `TURSO_AUTH_TOKEN`   | yes      | From step 1                                                          |
| `VAPID_PUBLIC_KEY`   | yes      | From step 3; clients fetch it from `/api/config`                     |
| `VAPID_PRIVATE_KEY`  | yes      | From step 3                                                          |
| `VAPID_SUBJECT`      | yes      | `mailto:` address push services can contact, e.g. `mailto:you@x.com` |
| `CRON_SECRET`        | no       | Bearer token for `POST /api/notifications/process`                   |
| `DEPLOY_PUSH_SECRET` | no       | Header for `POST /api/deploy/notify`, which CI calls after deploying |
| `PORT`               | no       | Defaults to 3000                                                     |
| `ALLOWED_ORIGINS`    | no       | A web app's address, if served from another address than the API     |

On Fly, set the app name in `fly.toml`, then:

```sh
fly launch --no-deploy --copy-config
fly secrets set TURSO_DATABASE_URL=… TURSO_AUTH_TOKEN=… VAPID_PUBLIC_KEY=… VAPID_PRIVATE_KEY=… VAPID_SUBJECT=mailto:…
fly deploy
```

Elsewhere, build the `server` target of the `Dockerfile` and run it with those variables. It
listens on `PORT`.

## 5. Create the first account

Open your server's address in a browser. The first account on a new server needs no invite, so do
this straight after deploying: until then, anyone who finds the address could claim it.

After that, signing up takes an invite. Make one under **People → Invite someone** and send the link. The
person opening it can sign up, and the two of you become contacts.

## 6. Point the extensions at it

In the extension, choose **Sign in**, enter the server's address, then your username and password.
Tasks added before signing in sync up once you do.

Forgotten passwords are reset on the server:

```sh
SERVER_URL=https://your-server pnpm reset-password <user-id>  # locally, with the TURSO_* variables set
node dist/reset-password.js <user-id>                         # on the server, e.g. via `fly ssh console`
```

It signs the user out everywhere, then tells the running server, which otherwise keeps accepting
their sessions for up to 30 seconds. That request is signed with `TURSO_AUTH_TOKEN`, so it has to
match the server's.
