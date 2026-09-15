import type { McpPrincipal } from "@/lib/mcp/principal";

/**
 * Everything a tool needs, all derived server-side from the verified bearer
 * token. The model supplies tool arguments only — never scope.
 */
export type McpToolContext = {
  principal: McpPrincipal;
  firmId: string;
};
