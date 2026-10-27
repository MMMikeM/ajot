import { HTTPException } from "hono/http-exception";
import sessionRepo from "./db/session.repo";

/** A Bearer header. Never a cookie: the browser would attach one to a request another site starts. */
export const extractToken = (request: Request): string | null =>
  request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;

export const validateSession = async (token: string): Promise<string> => {
  const session = await sessionRepo.findValid(token);
  if (!session) throw new HTTPException(401, { message: "Unauthorized" });
  return session.userId;
};
