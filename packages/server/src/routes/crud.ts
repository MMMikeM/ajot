import { z } from "@hono/zod-openapi";
import { errorSchema, okSchema, unauthorizedResponse } from "./openapi-schemas";

export const jsonBody = <T extends z.ZodType>(schema: T) =>
  ({ body: { content: { "application/json": { schema } } } }) as const;

export const jsonContent = <T extends z.ZodType>(schema: T, description = "OK") =>
  ({ description, content: { "application/json": { schema } } }) as const;

export const withAuth = <T extends Record<number, unknown>>(responses: T) =>
  ({ ...responses, 401: unauthorizedResponse }) as T & { 401: typeof unauthorizedResponse };

const refusals = {
  400: jsonContent(errorSchema, "Bad request"),
  403: jsonContent(errorSchema, "Forbidden"),
  404: jsonContent(errorSchema, "Not found"),
  409: jsonContent(errorSchema, "Conflict"),
  429: jsonContent(errorSchema, "Too many tries"),
} as const;

/** The refusals a route can answer with, each in errorSchema's shape. */
export const errors = <const S extends (keyof typeof refusals)[]>(...statuses: S) =>
  Object.fromEntries(statuses.map((status) => [status, refusals[status]])) as Pick<
    typeof refusals,
    S[number]
  >;

export const okResponse = { 200: jsonContent(okSchema) };
export const okBody = { ok: true as const };
