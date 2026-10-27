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
 * An expired session is the exception. Turso refuses a request on a session left idle (about 10 s
 * on libSQL server) before running any of it, and the driver drops the session on that error, so
 * a write is replayed on a fresh one too. connections.ts starts a fresh session after a shorter
 * idle, so this only catches a server that expires them sooner.
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

export const isTransportFailure = (error: unknown) => causedBy(error, TRANSPORT_FAILURE);
const isSessionExpired = (error: unknown) => causedBy(error, SESSION_EXPIRED);

export const isRead = (sql: unknown) => typeof sql === "string" && /^\s*select\b/i.test(sql);

type Retryable = (error: unknown) => boolean;

const retryableFor = (sql: unknown): Retryable =>
  isRead(sql) ? (error) => isTransportFailure(error) || isSessionExpired(error) : isSessionExpired;

const retryOnce = async <T>(call: () => Promise<T>, retryable: Retryable): Promise<T> => {
  try {
    return await call();
  } catch (error) {
    if (!retryable(error)) throw error;
    console.warn("[db] retrying once:", (error as Error).message);
    return await call();
  }
};

type Method = (...args: unknown[]) => unknown;

/** A prepared statement: raw() hands the statement back for the executing call, so it stays guarded. */
const guard = <T extends object>(statement: T, retryable: Retryable): T =>
  new Proxy(statement, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;
      const method = value as Method;
      if (property === "raw")
        return (...args: unknown[]) => guard(method.apply(target, args) as object, retryable);
      if (property === "all" || property === "get" || property === "values" || property === "run")
        return (...args: unknown[]) => retryOnce(async () => method.apply(target, args), retryable);
      return method.bind(target);
    },
  });

export const withRetry = <T extends object>(client: T): T =>
  new Proxy(client, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;
      const method = value as Method;

      if (property === "prepare")
        return async (sql: unknown, ...rest: unknown[]) =>
          guard((await method.call(target, sql, ...rest)) as object, retryableFor(sql));
      if (property === "all" || property === "get" || property === "run")
        return (sql: unknown, ...params: unknown[]) =>
          retryOnce(async () => method.call(target, sql, ...params), retryableFor(sql));
      return method.bind(target);
    },
  });
