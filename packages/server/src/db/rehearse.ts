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

// Rows a migration's constraint refuses, counted as it finds them: the table the repair deletes
// them from, or none for those it changes in place
const refusedRows: { name: string; deletedFrom?: string; count: string }[] = [
  {
    name: "contacts with yourself",
    deletedFrom: "contacts",
    count: "SELECT count(*) AS n FROM contacts WHERE user_id = contact_user_id",
  },
  {
    name: "Undo records of a contact with yourself",
    deletedFrom: "removed_contacts",
    count: `SELECT count(*) AS n FROM removed_contacts r WHERE EXISTS (SELECT 1 FROM json_each(r.contacts)
      WHERE json_extract(value, '$.userId') = json_extract(value, '$.contactUserId'))`,
  },
  {
    name: "unsent reminders for a task with no due date",
    deletedFrom: "notification_queue",
    count: `SELECT count(*) AS n FROM notification_queue
      WHERE type = 'reminder-due' AND sent_at IS NULL
        AND task_id IN (SELECT id FROM tasks WHERE due_date IS NULL)`,
  },
  {
    name: "unsent reminders past one a task",
    deletedFrom: "notification_queue",
    count: `SELECT count(*) - count(DISTINCT task_id) AS n FROM notification_queue
      WHERE type = 'reminder-due' AND sent_at IS NULL
        AND task_id IN (SELECT id FROM tasks WHERE due_date IS NOT NULL)`,
  },
  {
    name: "digests past one a user a day",
    deletedFrom: "notification_queue",
    count: `SELECT count(*) - (SELECT count(*) FROM (SELECT 1 FROM notification_queue
        WHERE type = 'overdue-digest' GROUP BY user_id, substr(scheduled_for, 1, 10))) AS n
      FROM notification_queue WHERE type = 'overdue-digest'`,
  },
  {
    name: "reminders without a task",
    deletedFrom: "notification_queue",
    count:
      "SELECT count(*) AS n FROM notification_queue WHERE type = 'reminder-due' AND task_id IS NULL",
  },
  {
    name: "digests with a task",
    count:
      "SELECT count(*) AS n FROM notification_queue WHERE type <> 'reminder-due' AND task_id IS NOT NULL",
  },
  {
    name: "subtasks under a subtask",
    count: `SELECT count(*) AS n FROM tasks s JOIN tasks p ON p.id = s.parent_id
      WHERE p.parent_id IS NOT NULL`,
  },
];

type Stock = {
  tables: Map<string, number>;
  refused: number[];
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
    const refused: number[] = [];
    for (const { count } of refusedRows) refused.push((await all<{ n: number }>(count))[0]!.n);
    return {
      tables,
      refused,
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
  const deleted = new Map<string, number>();
  refusedRows.forEach(({ deletedFrom }, i) => {
    if (deletedFrom) deleted.set(deletedFrom, (deleted.get(deletedFrom) ?? 0) + before.refused[i]!);
  });
  for (const [table, count] of before.tables) {
    const now = after.tables.get(table);
    const refused = deleted.get(table) ?? 0;
    checks.push([
      `${table} rows`,
      now === count - refused,
      `${count} → ${now ?? "gone"}${refused ? `, ${refused} refused` : ""}`,
    ]);
  }
  refusedRows.forEach(({ name }, i) =>
    checks.push([name, after.refused[i] === 0, `${before.refused[i]} → ${after.refused[i]}`]),
  );
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
