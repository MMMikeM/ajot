import { sql, type SQL } from "drizzle-orm";
import { readMigrationFiles, type MigrationMeta } from "drizzle-orm/migrator";
import { viewDefinitions } from "./views.ts";

/** What this needs of a drizzle SQLite database: Turso's, or node:sqlite's in the tests. */
type Database = {
  run(query: SQL): unknown;
  all<T>(query: SQL): T[] | PromiseLike<T[]>;
};

const hasTable = async (db: Database, name: string) => {
  const rows = await db.all(
    sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ${name}`,
  );
  return rows.length > 0;
};

const record = (db: Database, migration: MigrationMeta) =>
  db.run(sql`INSERT INTO "__drizzle_migrations" ("hash", "created_at", "name", "applied_at")
    VALUES (${migration.hash}, ${migration.folderMillis}, ${migration.name}, ${new Date().toISOString()})`);

const dropViews = async (db: Database) => {
  const views = await db.all<{ name: string }>(
    sql`SELECT name FROM sqlite_master WHERE type = 'view'`,
  );
  for (const { name } of views) await db.run(sql`DROP VIEW ${sql.identifier(name)}`);
};

/**
 * Applies the pending migrations in the format drizzle's migrator keeps, and creates the views
 * again, all in one transaction, so a migration that fails or leaves rows pointing at nothing
 * rolls back whole.
 *
 * SQLite checks every view when a rebuilt table is renamed into place, so the views are dropped
 * before each migration and created from views.ts after the last, on every run. And it ignores
 * PRAGMA foreign_keys inside a transaction, so a rebuild's DROP TABLE would cascade (dropping
 * tasks deleted every share and reminder): they're off for the connection around it, as SQLite's
 * own table-rebuild steps say. https://www.sqlite.org/lang_altertable.html#otheralter
 */
export const migrate = async (db: Database, migrationsFolder: string) => {
  const migrations = readMigrationFiles({ migrationsFolder });
  await db.run(sql`PRAGMA foreign_keys = OFF`);
  try {
    await db.run(sql`BEGIN IMMEDIATE`);
    try {
      await db.run(sql`CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
        id INTEGER PRIMARY KEY,
        hash text NOT NULL,
        created_at numeric,
        name text,
        applied_at TEXT
      )`);
      const recorded = await db.all<{ name: string }>(sql`SELECT name FROM "__drizzle_migrations"`);
      // A database drizzle-kit push built before there were migrations has the baseline's tables
      const adopted = recorded.length === 0 && (await hasTable(db, "users"));
      if (adopted) {
        await record(db, migrations[0]);
        recorded.push({ name: migrations[0].name });
      }
      const done = new Set(recorded.map((m) => m.name));
      const applied: string[] = [];
      for (const migration of migrations.filter((m) => !done.has(m.name))) {
        await dropViews(db);
        for (const statement of migration.sql) await db.run(sql.raw(statement));
        await record(db, migration);
        applied.push(migration.name);
      }
      await dropViews(db);
      for (const { name, query } of viewDefinitions)
        await db.run(sql`CREATE VIEW ${sql.identifier(name)} AS ${query}`);
      const broken = await db.all(sql`PRAGMA foreign_key_check`);
      if (broken.length > 0)
        throw new Error(`Rows point at rows that aren't there: ${JSON.stringify(broken)}`);
      await db.run(sql`COMMIT`);
      return { adopted: adopted ? migrations[0].name : undefined, applied };
    } catch (error) {
      await db.run(sql`ROLLBACK`);
      throw error;
    }
  } finally {
    await db.run(sql`PRAGMA foreign_keys = ON`);
  }
};
