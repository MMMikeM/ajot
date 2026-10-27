import { type connect, Session, Statement } from "@tursodatabase/serverless";
import { isRead } from "./retry";

type Connection = ReturnType<typeof connect>;
type Config = Parameters<typeof connect>[0];
type Method = (...args: unknown[]) => unknown;

// Private on Connection: the session its statements run on, and the lock that queues them
type Internals = {
  session: Parameters<typeof Statement.fromSession>[0];
  execLock: Parameters<typeof Statement.fromSession>[3];
};
const internals = (connection: Connection) => connection as unknown as Internals;

/**
 * Connection.prepare asks the server to describe the statement, a round trip of its own before the
 * one that runs it, for the column metadata behind columns() and reader. Drizzle reads neither:
 * rows are named from the columns that come back with them. This is the statement prepare builds,
 * on the same session and lock, so a transaction's statements stay in it.
 */
export const withoutDescribe = (connection: Connection) => {
  connection.prepare = async (sql) => {
    const { session, execLock } = internals(connection);
    return Statement.fromSession(session, sql, [], execLock);
  };
  return connection;
};

// libSQL server ends a session idle for 10 s, failing the next request on it. A request that
// starts a new one costs no more than any other, so a connection starts one well before that.
const SESSION_IDLE_MS = 5_000;

/** For a connection that only autocommits: a transaction's session must never be swapped. */
export const freshSessionAfterIdle = (connection: Connection, config: Config) => {
  let lastCallAt = Date.now();
  return new Proxy(connection, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;
      const method = value as Method;
      if (property !== "prepare" && property !== "all" && property !== "get" && property !== "run")
        return method.bind(target);
      return (...args: unknown[]) => {
        if (Date.now() - lastCallAt > SESSION_IDLE_MS && !target.inTransaction)
          internals(target).session = new Session(config);
        lastCallAt = Date.now();
        return method.apply(target, args);
      };
    },
  });
};

/**
 * A connection runs one statement at a time, so concurrent requests queued on it and a
 * Promise.all of reads cost the sum of their round trips. SELECTs take turns on the readers
 * instead; everything else stays on the primary, so writes still run one at a time, in order.
 */
export const withReadPool = (primary: Connection, readers: Connection[]) => {
  let turn = 0;
  const nextReader = () => readers[turn++ % readers.length]!;
  return new Proxy(primary, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;
      const method = value as Method;
      if (property === "transaction")
        return () => {
          throw new Error("Use inTransaction: db's reads would run outside the transaction");
        };
      if (property !== "prepare" && property !== "all" && property !== "get")
        return method.bind(target);
      return (sql: unknown, ...rest: unknown[]) =>
        isRead(sql)
          ? (Reflect.get(nextReader(), property) as Method)(sql, ...rest)
          : method.call(target, sql, ...rest);
    },
  });
};
