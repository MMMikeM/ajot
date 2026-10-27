import { HTTPException } from "hono/http-exception";
import sessionRepo from "./db/session.repo";

/**
 * A Bearer header. Never a cookie: the browser would attach one to a request another site starts.
 * Only the event stream passes its URL, since EventSource can't set headers; anywhere else a
 * token in the URL would end up in logs and history.
 */
export const extractToken = (request: Request, url?: URL): string | null => {
  const header = request.headers.get("authorization");
  if (header) return header.replace(/^Bearer\s+/i, "");
  if (url) {
    const param = url.searchParams.get("token");
    if (param) return param;
  }
  return null;
};

export const validateSession = async (token: string): Promise<string> => {
  const session = await sessionRepo.findValid(token);
  if (!session) throw new HTTPException(401, { message: "Unauthorized" });
  return session.userId;
};
