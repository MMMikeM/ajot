import type { ISODateOnly, ISODateString } from "./iso-schema";

export type { ISODateOnly, ISODateString } from "./iso-schema";

const pad = (n: number) => String(n).padStart(2, "0");

export const now = (): ISODateString => new Date().toISOString() as ISODateString;

export const today = (): ISODateOnly => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` as ISODateOnly;
};

export const hoursFromNow = (hours: number): ISODateString =>
  new Date(Date.now() + hours * 3_600_000).toISOString() as ISODateString;
