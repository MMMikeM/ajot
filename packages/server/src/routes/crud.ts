import { z } from "@hono/zod-openapi";
import { errorSchema, okSchema } from "./openapi-schemas";

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
const noContentResponse = { description: "No content" } as const;

type OkResponse<O> = [O] extends [true]
  ? { 200: ReturnType<typeof jsonContent<typeof okSchema>> }
  : [O] extends [z.ZodType]
    ? { 200: ReturnType<typeof jsonContent<O>> }
    : unknown;

// An extra replaces the response at its status, as its spread does at runtime
type Responses<O, N, E extends readonly Refusal[], X> = Omit<
  OkResponse<O> &
    ([N] extends [true] ? { 204: typeof noContentResponse } : unknown) &
    Pick<typeof refusals, E[number]>,
  keyof X
> &
  X;

/**
 * What a route can answer: `ok`, its 200 body (`true` for `{ ok: true }`), or `noContent`, a 204;
 * `errors`, the refusals its handler and the repos under it can throw, in errorSchema's shape; and
 * `extra`, responses with a description of their own. A route on an `authed()` router gets the
 * middleware's 401 from `authedRoute`.
 */
export const res = <
  const O extends Ok | undefined = undefined,
  const N extends boolean = false,
  const E extends readonly Refusal[] = [],
  const X extends Record<number, unknown> = {},
>(spec: {
  ok?: O;
  noContent?: N;
  errors?: E;
  extra?: X;
}) => {
  const given: Ok | undefined = spec.ok;
  const ok = given === true ? okSchema : given;
  return {
    ...(ok ? { 200: jsonContent(ok) } : {}),
    ...(spec.noContent ? { 204: noContentResponse } : {}),
    ...Object.fromEntries((spec.errors ?? []).map((status) => [status, refusals[status]])),
    ...spec.extra,
    // Inferred from the arguments only: inside createRoute, the return type's context is an index
    // signature, which would otherwise widen X and with it every route's statuses
  } as NoInfer<Responses<O, N, E, X>>;
};

export const okBody = { ok: true as const };
