import { type Config, Connection, Statement } from "@tursodatabase/serverless";

/**
 * Fly suspends this machine when idle (fly.toml: auto_stop_machines = 'suspend'). On resume the
 * process still holds keep-alive sockets the far side has dropped, so the first query fails in
 * transit and an identical retry succeeds. 401 is not a transport failure: a rejected token fails
 * the same way twice.
 *
 * Keyed on the SQL rather than the method:
 * drizzle runs INSERT/UPDATE/DELETE ... RETURNING through the same all()/get() as reads, and a
 * write that failed in transit may still have been applied, so only SELECTs are replayed.
 *
 * An expired session is the exception. libSQL server ends a session idle for 10 s and refuses the
 * next request on it before running any of it, and the driver drops the session on that error, so
 * a write is replayed on a fresh one too. That happens after every quiet spell, so it isn't logged.
 */

const TRANSPORT_FAILURE =
  /fetch failed|other side closed|socket hang up|premature close|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|ENOTFOUND|EAI_AGAIN|UND_ERR|HTTP error! status: (?:400|5\d\d)/i;

// The pipeline endpoint reports it only as a 400 (matched above); the cursor one, which runs
// every statement, passes on the server's message
const SESSION_EXPIRED = /stream has expired/i;

/** Drizzle wraps driver errors, and undici nests its own, so the reason can be several causes deep. */
const causedBy = (error: unknown, reason: RegExp): boolean => {
  for (let current = error, depth = 0; current instanceof Error && depth < 5; depth++) {
    if (reason.test(current.message)) return true;
    current = current.cause;
  }
  return false;
};

const isTransportFailure = (error: unknown) => causedBy(error, TRANSPORT_FAILURE);
const isSessionExpired = (error: unknown) => causedBy(error, SESSION_EXPIRED);

const isRead = (sql: string) => /^\s*select\b/i.test(sql);

type Retryable = (error: unknown) => boolean;

const retryableFor = (sql: string): Retryable =>
  isRead(sql) ? (error) => isTransportFailure(error) || isSessionExpired(error) : isSessionExpired;

const retryOnce = async <T>(call: () => Promise<T>, retryable: Retryable): Promise<T> => {
  try {
    return await call();
  } catch (error) {
    if (!retryable(error)) throw error;
    if (!isSessionExpired(error)) console.warn("[db] retrying once:", (error as Error).message);
    return await call();
  }
};

// Private on Connection: the session its statements run on, and the lock that queues them
type Internals = {
  session: Parameters<typeof Statement.fromSession>[0];
  execLock: Parameters<typeof Statement.fromSession>[3];
};

/**
 * Connection.prepare asks the server to describe the statement, a round trip of its own before the
 * one that runs it, for the column metadata behind columns() and reader. Drizzle reads neither:
 * rows are named from the columns that come back with them. This is the statement prepare builds,
 * on the same session and lock, so a transaction's statements stay in it.
 */
export class OneTripConnection extends Connection {
  override async prepare(sql: string) {
    const { session, execLock } = this as unknown as Internals;
    return Statement.fromSession(session, sql, [], execLock);
  }
}

/**
 * Drizzle only ever sends a plain (deferred) BEGIN. A deferred transaction that reads and then
 * writes can't wait for another writer's lock: SQLite fails it with SQLITE_BUSY at once. IMMEDIATE
 * takes the lock at BEGIN, where it waits its turn instead.
 */
export class ImmediateConnection extends OneTripConnection {
  override transaction(fn: Parameters<Connection["transaction"]>[0]) {
    return super.transaction(fn).immediate;
  }
}

/**
 * A connection runs one statement at a time, so concurrent requests queued on it and a
 * Promise.all of reads would take the sum of their round trips. SELECTs take turns on the readers
 * instead; everything else stays here, so writes still run one at a time, in order. Statements
 * are retried once, which a transaction's must never be, so it has no transactions.
 */
export class PooledConnection extends OneTripConnection {
  readonly #readers: OneTripConnection[];
  #turn = 0;

  constructor(config: Config, { readers }: { readers: number }) {
    super(config);
    this.#readers = Array.from({ length: readers }, () => new OneTripConnection(config));
  }

  #readerFor(sql: string) {
    return isRead(sql) ? this.#readers[this.#turn++ % this.#readers.length] : undefined;
  }

  override async prepare(sql: string) {
    const statement = await (this.#readerFor(sql)?.prepare(sql) ?? super.prepare(sql));
    const retryable = retryableFor(sql);
    const all = statement.all.bind(statement);
    const get = statement.get.bind(statement);
    const run = statement.run.bind(statement);
    statement.all = (...args) => retryOnce(() => all(...args), retryable);
    statement.get = (...args) => retryOnce(() => get(...args), retryable);
    statement.run = (...args) => retryOnce(() => run(...args), retryable);
    return statement;
  }

  // The retry goes to the connection whose session just expired: the driver has dropped it, so
  // its next request starts a new one, where the next reader's has likely expired too
  override all(sql: string, ...params: unknown[]) {
    const reader = this.#readerFor(sql);
    return retryOnce(
      () => reader?.all(sql, ...params) ?? super.all(sql, ...params),
      retryableFor(sql),
    );
  }

  override get(sql: string, ...params: unknown[]) {
    const reader = this.#readerFor(sql);
    return retryOnce(
      () => reader?.get(sql, ...params) ?? super.get(sql, ...params),
      retryableFor(sql),
    );
  }

  override run(sql: string, ...params: unknown[]) {
    return retryOnce(() => super.run(sql, ...params), retryableFor(sql));
  }

  override transaction(): never {
    throw new Error("Use inTransaction: db's reads would run outside the transaction");
  }

  override async close() {
    await Promise.all([super.close(), ...this.#readers.map((reader) => reader.close())]);
  }
}
