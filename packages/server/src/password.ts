import { availableParallelism } from "node:os";
import { hash, verify } from "@node-rs/argon2";

export const MIN_PASSWORD_LENGTH = 8;

const ARGON2_OPTIONS = {
  memoryCost: 19456,
  timeCost: 2,
  outputLen: 32,
  parallelism: 1,
};

// Each hash holds 19 MiB and one of libuv's four threads, which file and DNS work wait on too, so
// sign-ins sent at once from many addresses, which no per-address limit stops, queue here instead.
// At least one thread is always left free.
const MAX_HASHING = Math.min(availableParallelism(), 3);
let hashing = 0;
const waiting: (() => void)[] = [];

const inTurn = async <T>(work: () => Promise<T>) => {
  if (hashing < MAX_HASHING) hashing++;
  else await new Promise<void>((resolve) => waiting.push(resolve));
  try {
    return await work();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else hashing--;
  }
};

export const hashPassword = (password: string) => inTurn(() => hash(password, ARGON2_OPTIONS));

export const verifyPassword = (passwordHash: string, password: string) =>
  inTurn(() => verify(passwordHash, password));
