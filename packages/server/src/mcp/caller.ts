/**
 * Who a tool calls the API as. /mcp hands it to the routes in Hono's env bindings, through
 * `app.request`: @hono/node-server fills env with its own `{ incoming, outgoing }` for every request
 * from outside, so no request can claim to be one.
 */
export type McpCaller = { userId: string; tokenId: string; canWrite: boolean };

const READS = new Set(["GET /api/tasks", "GET /api/categories", "GET /api/notes", "GET /api/contacts"]);
const WRITES = new Set(["POST /api/tasks", "PUT /api/tasks/status"]);

/** The routes the tools call, and nothing else a token could reach. */
export const mayCall = ({ canWrite }: McpCaller, method: string, path: string) => {
  const route = `${method} ${path}`;
  return READS.has(route) || (canWrite && WRITES.has(route));
};
