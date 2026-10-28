// Rehearses the pending migrations on a copy of a Turso database: copies it, takes stock, runs
// migrate.ts against the copy, takes stock again and says what changed, then destroys the copy.
// The source is only ever read by `turso db create --from-db`; nothing here connects to it.
//
//   pnpm db:rehearse <database> [--group <group>] [--keep]
//   pnpm db:rehearse --url <copy-url> --token <copy-token>   (a copy you made; never destroyed)
//
// Needs the turso CLI, signed in (`turso auth login`). TURSO_BIN overrides where it is.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { connect } from "@tursodatabase/serverless";
import { isSortKey } from "@newtab-todo/shared/sort-order";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    group: { type: "string" },
    keep: { type: "boolean", default: false },
    url: { type: "string" },
    token: { type: "string" },
  },
});
const [source] = positionals;
if (!source && !values.url) {
  console.error("Usage: pnpm db:rehearse <database> [--group <group>] [--keep]");
  console.error("       pnpm db:rehearse --url <copy-url> --token <copy-token>");
  process.exit(2);
}

const tursoBin = () => {
  if (process.env.TURSO_BIN) return process.env.TURSO_BIN;
  if (!spawnSync("turso", ["--version"]).error) return "turso";
  const installed = join(homedir(), ".turso", "turso");
  if (existsSync(installed)) return installed;
  throw new Error("No turso CLI on PATH or in ~/.turso; set TURSO_BIN");
};

const turso = (bin: string, ...args: string[]) =>
  execFileSync(bin, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();

type Copy = { url: string; token: string; destroy?: () => void };

const makeCopy = (database: string): Copy => {
  const bin = tursoBin();
  const group = values.group ?? /^Group:\s*(\S+)/m.exec(turso(bin, "db", "show", database))?.[1];
  if (!group) throw new Error(`Couldn't read ${database}'s group; pass --group`);
  const copy = `rehearse-${Date.now().toString(36)}`;
  console.log(`[rehearse] copying ${database} to ${copy} in group ${group}`);
  turso(bin, "db", "create", copy, "--from-db", database, "--group", group, "--wait");
  const destroy = () => {
    console.log(`[rehearse] destroying ${copy}`);
    turso(bin, "db", "destroy", copy, "--yes");
  };
  try {
    return {
      url: turso(bin, "db", "show", copy, "--url"),
      token: turso(bin, "db", "tokens", "create", copy, "--expiration", "1d"),
      destroy: values.keep ? undefined : destroy,
    };
  } catch (error) {
    if (!values.keep) destroy();
    throw error;
  }
};

type Stock = {
  tables: Map<string, number>;
  malformedKeys: { tasks: number; categories: number };
  liveUnderDeleted: number;
  liveTasks: number;
  taskOrder: string[];
  listOrder: string[];
  stamps: string[];
  danglingKeys: number;
};

const takeStock = async (url: string, token: string): Promise<Stock> => {
  const db = connect({ url, authToken: token });
  const all = <T>(sql: string) => db.all(sql) as Promise<T[]>;
  try {
    const names = await all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND name NOT LIKE '\\_\\_%' ESCAPE '\\' ORDER BY name",
    );
    const tables = new Map<string, number>();
    for (const { name } of names) {
      const [row] = await all<{ n: number }>(`SELECT count(*) AS n FROM "${name}"`);
      tables.set(name, row!.n);
    }
    const malformed = async (table: string) =>
      (await all<{ sort_order: string | null }>(`SELECT sort_order FROM ${table}`)).filter(
        (row) => row.sort_order !== null && !isSortKey(row.sort_order),
      ).length;
    const ids = async (sql: string) => (await all<{ id: string }>(sql)).map((row) => row.id);
    const [{ n: liveUnderDeleted }] = await all<{ n: number }>(
      "SELECT count(*) AS n FROM tasks s JOIN tasks p ON p.id = s.parent_id WHERE s.deleted_at IS NULL AND p.deleted_at IS NOT NULL",
    );
    const [{ n: liveTasks }] = await all<{ n: number }>(
      "SELECT count(*) AS n FROM tasks WHERE deleted_at IS NULL",
    );
    return {
      tables,
      malformedKeys: { tasks: await malformed("tasks"), categories: await malformed("categories") },
      liveUnderDeleted,
      liveTasks,
      // The order the server reads them in, ties included
      taskOrder: await ids("SELECT id FROM tasks ORDER BY sort_order, created_at, id"),
      listOrder: await ids("SELECT id FROM categories ORDER BY sort_order, name, id"),
      stamps: (
        await all<{ id: string; updated_at: string }>(
          "SELECT id, updated_at FROM tasks ORDER BY id",
        )
      ).map((row) => `${row.id} ${row.updated_at}`),
      danglingKeys: (await all("PRAGMA foreign_key_check")).length,
    };
  } finally {
    await db.close();
  }
};

const migrate = (url: string, token: string) => {
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL("./migrate.ts", import.meta.url))],
    {
      stdio: "inherit",
      env: { ...process.env, TURSO_DATABASE_URL: url, TURSO_AUTH_TOKEN: token },
    },
  );
  return result.status === 0;
};

const sameList = (a: string[], b: string[]) =>
  a.length === b.length && a.every((value, index) => value === b[index]);

const report = (before: Stock, after: Stock) => {
  const checks: [string, boolean, string][] = [];
  for (const [table, count] of before.tables) {
    const now = after.tables.get(table);
    checks.push([`${table} rows`, now === count, `${count} → ${now ?? "gone"}`]);
  }
  for (const table of after.tables.keys())
    if (!before.tables.has(table)) console.log(`[rehearse] new table ${table}`);
  checks.push(
    [
      "malformed task keys",
      after.malformedKeys.tasks === 0,
      `${before.malformedKeys.tasks} → ${after.malformedKeys.tasks}`,
    ],
    [
      "malformed list keys",
      after.malformedKeys.categories === 0,
      `${before.malformedKeys.categories} → ${after.malformedKeys.categories}`,
    ],
    [
      "live subtasks under a deleted parent",
      after.liveUnderDeleted === 0,
      `${before.liveUnderDeleted} → ${after.liveUnderDeleted}`,
    ],
    [
      "live tasks, less those re-hidden",
      after.liveTasks === before.liveTasks - before.liveUnderDeleted,
      `${before.liveTasks} → ${after.liveTasks}`,
    ],
    ["task order", sameList(before.taskOrder, after.taskOrder), `${after.taskOrder.length} tasks`],
    ["list order", sameList(before.listOrder, after.listOrder), `${after.listOrder.length} lists`],
    ["task updated_at untouched", sameList(before.stamps, after.stamps), ""],
    ["dangling foreign keys", after.danglingKeys === 0, `${after.danglingKeys}`],
  );
  for (const [name, ok, detail] of checks)
    console.log(`${ok ? "pass" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  const renumbered = before.malformedKeys.tasks + before.malformedKeys.categories > 0;
  console.log(
    renumbered
      ? "[rehearse] malformed keys were found, so the migration renumbered their table"
      : "[rehearse] no malformed keys, so the renumbering won't run",
  );
  return checks.every(([, ok]) => ok);
};

const copy: Copy = values.url ? { url: values.url, token: values.token ?? "" } : makeCopy(source!);
let passed = false;
try {
  const before = await takeStock(copy.url, copy.token);
  if (!migrate(copy.url, copy.token)) {
    console.error("[rehearse] FAIL  the migration failed; it rolled back on the copy");
  } else {
    passed = report(before, await takeStock(copy.url, copy.token));
  }
} finally {
  copy.destroy?.();
}
console.log(passed ? "[rehearse] all checks passed" : "[rehearse] checks failed");
process.exit(passed ? 0 : 1);
