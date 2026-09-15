import { verifyClientAccessFor } from "@/lib/clients/authz";
import type { McpPrincipal } from "@/lib/mcp/principal";

export class McpForbiddenError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "McpForbiddenError";
  }
}

/**
 * Assert this principal may read `clientId`, always against the firm derived
 * from the token — never a firm supplied by the model.
 *
 * Unlike Forge's `assertClientReadable` there is no conversation to pin to: an
 * MCP session is book-scoped, so the caller may legitimately move between
 * households. The firm and visibility checks are what hold.
 *
 * A denied client and a missing client raise the SAME error, so existence
 * never leaks across firms or advisor books.
 */
export async function assertClientReadableForPrincipal(
  p: McpPrincipal,
  clientId: string,
): Promise<void> {
  const access = await verifyClientAccessFor(p, clientId);
  if (!access.ok || access.firmId !== p.orgId) {
    throw new McpForbiddenError("Household not found or access denied");
  }
}
