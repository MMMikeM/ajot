import { existsSync } from "node:fs";
import { defineConfig } from "drizzle-kit";

// CI sets TURSO_* in the environment instead.
const devEnv = new URL("../../.env.dev", import.meta.url);
if (existsSync(devEnv)) process.loadEnvFile(devEnv);

export default defineConfig({
  out: "./drizzle",
  schema: "./src/db/schema.ts",
  dialect: "turso",
  dbCredentials: {
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN!,
  },
});
