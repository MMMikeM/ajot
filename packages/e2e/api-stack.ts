// Playwright's webServer runs this: a throwaway libSQL database in Docker, the migrations run on
// it, and the API server on top. Stopping it removes the container, so every run starts empty.

import { execFileSync, spawn } from "node:child_process";
import { resolve } from "node:path";
import { API_PORT } from "./helpers/stack";

// Pinned, so a new image can't change the database under the suite
const IMAGE =
  "ghcr.io/tursodatabase/libsql-server@sha256:6dd3eb276d9d3604e4a48ac4a999a2e267814732d57d7e94c04ba71482333a67";
const LABEL = "ajot-e2e";
const ROOT = resolve(import.meta.dirname, "../..");

const docker = (...args: string[]) => execFileSync("docker", args, { encoding: "utf8" }).trim();

// A run killed outright never reaches its exit handler, so its container is cleared here
const leftovers = docker("ps", "-aq", "--filter", `label=${LABEL}`);
if (leftovers) docker("rm", "-f", ...leftovers.split("\n"));

const container = docker("run", "-d", "--rm", "--label", LABEL, "-p", "127.0.0.1::8080", IMAGE);
process.on("exit", () => {
  try {
    docker("rm", "-f", container);
  } catch {
    // Already gone
  }
});
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => process.exit(0));

const dbUrl = `http://${docker("port", container, "8080/tcp").split("\n")[0]}`;
for (let attempt = 0; ; attempt++) {
  const ready = await fetch(`${dbUrl}/health`).then(
    (res) => res.ok,
    () => false,
  );
  if (ready) break;
  if (attempt === 100) throw new Error(`libSQL at ${dbUrl} never became healthy`);
  await new Promise((r) => setTimeout(r, 100));
}

const env = {
  ...process.env,
  TURSO_DATABASE_URL: dbUrl,
  TURSO_AUTH_TOKEN: "e2e",
  PORT: String(API_PORT),
  VAPID_SUBJECT: "mailto:e2e@example.com",
};
const pnpm = (...args: string[]) =>
  execFileSync("pnpm", ["--filter", "@newtab-todo/server", ...args], {
    cwd: ROOT,
    env,
    stdio: "inherit",
  });
pnpm("db:migrate");
pnpm("build");

const server = spawn("node", ["--enable-source-maps", "dist/index.js"], {
  cwd: resolve(ROOT, "packages/server"),
  env,
  stdio: "inherit",
});
server.on("exit", (code) => process.exit(code ?? 1));
process.on("exit", () => server.kill());
