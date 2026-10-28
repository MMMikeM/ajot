import { now } from "@newtab-todo/shared/iso";

/**
 * A device's stamp, or the server's time if the device's clock is ahead. A row's updatedAt is
 * the last-write-wins clock that every later write must beat, so a stamp from a clock running fast,
 * or one sent from the year 9999, would otherwise leave the row unchangeable until then.
 * Not refused: the client drops a refused change, and the edit would be lost.
 */
export const notAfterNow = <T extends string>(stamp: T): T => {
  const serverNow: string = now();
  return stamp < serverNow ? stamp : (serverNow as T);
};

/** The same for each of these stamps a write carries, leaving out the ones it doesn't. */
export const stampsNotAfterNow = <T extends Record<string, unknown>>(row: T, keys: (keyof T)[]) => {
  const clamped = { ...row };
  for (const key of keys) {
    const stamp = row[key];
    if (typeof stamp === "string") clamped[key] = notAfterNow(stamp) as T[keyof T];
  }
  return clamped;
};
