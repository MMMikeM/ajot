// Runs before every `drizzle-kit push`. Adding a constraint rebuilds its table, and a rebuild that
// meets a row breaking the new rule fails after dropping the old table, leaving it empty. So each
// constraint ships with an idempotent fix here for the rows that would break it.
import { connect } from "@tursodatabase/serverless";

const fixes = [
  {
    constraint: "subtask_has_no_list",
    sql: "UPDATE tasks SET category_id = NULL WHERE parent_id IS NOT NULL AND category_id IS NOT NULL",
  },
];

const db = connect({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

for (const { constraint, sql } of fixes) {
  const { changes } = await db.run(sql);
  console.log(`[prepare-push] ${constraint}: fixed ${changes} rows`);
}
