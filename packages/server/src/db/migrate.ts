// Applies the migrations in packages/server/drizzle to the database in TURSO_*
import { fileURLToPath } from "node:url";
import { connect } from "@tursodatabase/serverless";
import { drizzle } from "drizzle-orm/tursodatabase-serverless";
import { migrate } from "./migrator.ts";

const db = drizzle({
  client: connect({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN,
  }),
});

const { adopted, applied } = await migrate(
  db,
  fileURLToPath(new URL("../../drizzle", import.meta.url)),
);
if (adopted) console.log(`[migrate] ${adopted}: already in place, recorded as applied`);
for (const name of applied) console.log(`[migrate] ${name}: applied`);
console.log("[migrate] up to date");
