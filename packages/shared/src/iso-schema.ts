import { z } from "zod/v4";

export const isoDatetime = z.iso.datetime({ precision: 3 }).brand<"iso", "inout">();
export type ISODateString = z.output<typeof isoDatetime>;

export const isoDate = z.iso.date().brand<"isoDate", "inout">();
export type ISODateOnly = z.output<typeof isoDate>;
