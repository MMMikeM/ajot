// Applies the migrations in packages/server/drizzle. A database drizzle-kit
// push built before there were migrations already has the baseline's tables, so the baseline is
// recorded as applied rather than run, as drizzle's own `init` does for a single migration.
import { fileURLToPath } from "node:url";
import { connect } from "@tursodatabase/serverless";
import { sql } from "drizzle-orm";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { drizzle } from "drizzle-orm/tursodatabase-serverless";
import { migrate } from "drizzle-orm/tursodatabase-serverless/migrator";

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));
const db = drizzle({
  client: connect({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN,
  }),
});

const hasTable = async (name: string) => {
  const rows = await db.all(
    sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ${name}`,
  );
  return rows.length > 0;
};

const hasRecordedMigrations = async () =>
  (await hasTable("__drizzle_migrations")) &&
  (await db.all(sql`SELECT 1 FROM "__drizzle_migrations" LIMIT 1`)).length > 0;

if (!(await hasRecordedMigrations()) && (await hasTable("users"))) {
  const [baseline] = readMigrationFiles({ migrationsFolder });
  // The table drizzle's migrator creates
  await db.run(sql`CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
    id INTEGER PRIMARY KEY,
    hash text NOT NULL,
    created_at numeric,
    name text,
    applied_at TEXT
  )`);
  await db.run(sql`INSERT INTO "__drizzle_migrations" ("hash", "created_at", "name", "applied_at")
    VALUES (${baseline.hash}, ${baseline.folderMillis}, ${baseline.name}, ${new Date().toISOString()})`);
  console.log(`[migrate] ${baseline.name}: already in place, recorded as applied`);
}

// drizzle runs the migrations in one transaction, where SQLite ignores PRAGMA foreign_keys, so a
// rebuild's DROP TABLE would cascade: dropping tasks deleted every share and reminder. Off for the
// connection beforehand, as SQLite's own table-rebuild steps say, and checked before it's back on.
// https://www.sqlite.org/lang_altertable.html#otheralter
await db.run(sql`PRAGMA foreign_keys = OFF`);
try {
  await migrate(db, { migrationsFolder });
  const broken = await db.all(sql`PRAGMA foreign_key_check`);
  if (broken.length > 0)
    throw new Error(`[migrate] rows point at rows that aren't there: ${JSON.stringify(broken)}`);
} finally {
  await db.run(sql`PRAGMA foreign_keys = ON`);
}
console.log("[migrate] up to date");
