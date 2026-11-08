import { OAuthError, OAuthErrorCode, type AuthInfo, type OAuthTokenVerifier } from "@modelcontextprotocol/server";
import * as mcpTokenRepo from "../db/mcp-token.repo";
import type { McpCaller } from "./caller";

export const verifier: OAuthTokenVerifier = {
  verifyAccessToken: async (token) => {
    const row = await mcpTokenRepo.findValid(token, "mcp");
    if (!row)
      throw new OAuthError(
        OAuthErrorCode.InvalidToken,
        "This token isn't valid. Make one in Ajot: Settings, then Connect Claude.",
      );
    mcpTokenRepo.markUsed(row.id).catch((err) => console.error("[mcp] couldn't stamp use:", err));
    const caller: McpCaller = { userId: row.userId, tokenId: row.id, canWrite: row.canWrite };
    return {
      token,
      clientId: `pat:${row.id}`,
      scopes: row.canWrite ? ["ajot:read", "ajot:write"] : ["ajot:read"],
      expiresAt: Math.floor(Date.parse(row.expiresAt) / 1000),
      extra: { caller },
    };
  },
};

export const callerOf = (authInfo: AuthInfo | undefined): McpCaller => {
  const caller = authInfo?.extra?.caller as McpCaller | undefined;
  if (!caller) throw new Error("an MCP request reached the tools without a verified token");
  return caller;
};
