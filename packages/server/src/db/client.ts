import { connect } from "@tursodatabase/serverless";
import { drizzle } from "drizzle-orm/tursodatabase-serverless";
import { relations } from "./schema";
import { freshSessionAfterIdle, withoutDescribe, withReadPool } from "./connections";
import { withRetry } from "./retry";

const config = {
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
  defaultQueryTimeout: 30_000,
};

const READERS = 3;

const autocommitting = () => freshSessionAfterIdle(withoutDescribe(connect(config)), config);
const readers = Array.from({ length: READERS }, autocommitting);

export const db = drizzle({
  client: withRetry(withReadPool(autocommitting(), readers)),
  relations,
});

type Db = typeof db;
export type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Drizzle only ever sends a plain (deferred) BEGIN. A deferred transaction that reads and then
 * writes can't wait for another writer's lock: SQLite fails it with SQLITE_BUSY at once. IMMEDIATE
 * takes the lock at BEGIN, where it waits its turn instead.
 */
const beginImmediate = (client: ReturnType<typeof connect>) => {
  const transaction = client.transaction.bind(client);
  client.transaction = (fn) => transaction(fn).immediate;
  return client;
};

// A connection is one Turso session, so a transaction on the shared one would sweep in
// statements from concurrent requests. Each gets its own, without the retry: a retried
// statement would land on a fresh session, outside the transaction.
export const inTransaction = async <T>(run: (tx: Transaction) => Promise<T>) => {
  const connection = drizzle({
    client: beginImmediate(withoutDescribe(connect(config))),
    relations,
  });
  try {
    return await connection.transaction(run);
  } finally {
    await connection.$client.close();
  }
};
