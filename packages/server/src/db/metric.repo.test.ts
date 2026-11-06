import { beforeEach, expect, test, vi } from "vite-plus/test";
import { db } from "./client";
import * as metricRepo from "./metric.repo";
import { metricCounts } from "./schema";

// vi.mock runs before this file's imports, so the database it builds can only be imported there
vi.mock("./client", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { fileURLToPath } = await import("node:url");
  const { drizzle } = await import("drizzle-orm/node-sqlite");
  const { migrate } = await import("./migrator");
  const { relations } = await import("./schema");
  const memory = drizzle({ client: new DatabaseSync(":memory:"), relations });
  await migrate(memory, fileURLToPath(new URL("../../drizzle", import.meta.url)));
  return { db: memory, inTransaction: (run: (tx: typeof memory) => unknown) => run(memory) };
});

beforeEach(async () => {
  await db.delete(metricCounts);
});

const countOf = async (name: string) =>
  (await db.query.metricCounts.findFirst({ where: { name } }))?.count;

test("a full day takes no new names, but its names keep counting", async () => {
  const names = Array.from({ length: metricRepo.MAX_NAMES_A_DAY }, (_, i) => `name-${i}`);
  await metricRepo.add(new Map(names.map((name) => [name, 1])));

  await metricRepo.incrementIfRoom("one-too-many");
  await metricRepo.incrementIfRoom("name-0");

  expect(await countOf("one-too-many")).toBeUndefined();
  expect(await countOf("name-0")).toBe(2);
  expect(await db.$count(metricCounts)).toBe(metricRepo.MAX_NAMES_A_DAY);
});
