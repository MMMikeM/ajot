import { createRoute, z, type RouteConfig } from "@hono/zod-openapi";
import { errorSchema } from "./openapi-schemas";

export const jsonBody = <T extends z.ZodType>(schema: T) =>
  ({ body: { content: { "application/json": { schema } } } }) as const;

export const jsonContent = <T extends z.ZodType>(schema: T, description = "OK") =>
  ({ description, content: { "application/json": { schema } } }) as const;

const reasons: Record<number, string> = {
  200: "OK",
  204: "No content",
  400: "Bad request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not found",
  409: "Conflict",
  410: "Gone",
  429: "Too many requests",
};

type Shorthand = z.ZodType | true | string;

type Expanded<Status, Value> = Value extends z.ZodType
  ? ReturnType<typeof jsonContent<Value>>
  : Status extends 204
    ? { description: string }
    : ReturnType<typeof jsonContent<typeof errorSchema>>;

export type ShorthandRoute = Omit<RouteConfig, "responses"> & {
  responses: Record<number, Shorthand>;
};

export type RouteOf<R extends ShorthandRoute> = Omit<R, "responses"> & {
  responses: { [Status in keyof R["responses"]]: Expanded<Status, R["responses"][Status]> };
};

const expand = (responses: Record<number, Shorthand>) =>
  Object.fromEntries(
    Object.entries(responses).map(([key, value]) => {
      const reason = reasons[Number(key)];
      if (typeof value === "string") return [key, jsonContent(errorSchema, value)];
      if (value !== true) return [key, jsonContent(value, reason ?? "OK")];
      if (!reason) throw new Error(`A ${key} has no wording of its own: give it one`);
      return [key, key === "204" ? { description: reason } : jsonContent(errorSchema, reason)];
    }),
  );

export const route = <const R extends ShorthandRoute>(spec: R) =>
  // Typed from the argument only: inside .openapi(), the return type's context would widen the
  // statuses to every status code
  createRoute({ ...spec, responses: expand(spec.responses) }) as unknown as NoInfer<RouteOf<R>>;

export const okBody = { ok: true as const };
