import { z } from "@hono/zod-openapi";
import { errorSchema, okSchema, unauthorizedResponse } from "./openapi-schemas";

export const jsonBody = <T extends z.ZodType>(schema: T) =>
  ({ body: { content: { "application/json": { schema } } } }) as const;

export const jsonContent = <T extends z.ZodType>(schema: T, description = "OK") =>
  ({ description, content: { "application/json": { schema } } }) as const;

const refusals = {
  400: jsonContent(errorSchema, "Bad request"),
  403: jsonContent(errorSchema, "Forbidden"),
  404: jsonContent(errorSchema, "Not found"),
  409: jsonContent(errorSchema, "Conflict"),
  429: jsonContent(errorSchema, "Too many tries"),
} as const;

type Refusal = keyof typeof refusals;
type Ok = z.ZodType | true;

type Responses<O, E extends readonly Refusal[], P, X> = (O extends true
  ? { 200: ReturnType<typeof jsonContent<typeof okSchema>> }
  : O extends z.ZodType
    ? { 200: ReturnType<typeof jsonContent<O>> }
    : unknown) &
  Pick<typeof refusals, E[number]> &
  (P extends true ? unknown : { 401: typeof unauthorizedResponse }) &
  X;

/**
 * What a route can answer: `ok`, its 200 body (`true` for `{ ok: true }`); `errors`, the refusals
 * its handler and the repos under it can throw, in errorSchema's shape; the auth middleware's 401
 * unless the route is `public`; and `extra`, responses with a description of their own.
 */
export const res = <
  const O extends Ok | undefined = undefined,
  const E extends readonly Refusal[] = [],
  const P extends boolean = false,
  const X extends Record<number, unknown> = {},
>(spec: {
  ok?: O;
  errors?: E;
  public?: P;
  extra?: X;
}) => {
  const given: Ok | undefined = spec.ok;
  const ok = given === true ? okSchema : given;
  return {
    ...(ok ? { 200: jsonContent(ok) } : {}),
    ...Object.fromEntries((spec.errors ?? []).map((status) => [status, refusals[status]])),
    ...(spec.public ? {} : { 401: unauthorizedResponse }),
    ...spec.extra,
    // Inferred from the arguments only: inside createRoute, the return type's context is an index
    // signature, which would otherwise widen X and with it every route's statuses
  } as NoInfer<Responses<O, E, P, X>>;
};

export const okBody = { ok: true as const };
