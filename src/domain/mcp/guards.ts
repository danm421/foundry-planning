import { verifyClientAccessFor } from "@/lib/clients/authz";
import type { McpPrincipal } from "@/lib/mcp/principal";

export class McpForbiddenError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "McpForbiddenError";
  }
}

/**
 * The one message for every unreadable-client outcome — denied, wrong firm,
 * or (in `define-tool.ts`) a schema-declared `clientId` whose parsed value
 * isn't a string. Shared so the two throw sites can never drift apart; a
 * denied client and a missing client must stay indistinguishable.
 */
export const CLIENT_UNREADABLE_MESSAGE = "Household not found or access denied";

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
  // `ok` plus the firm match is deliberately the WHOLE gate — no
  // `access.permission` check. Every MCP tool is read-only, so "view" is
  // always sufficient; a later task must not assume permission was checked
  // here and add its own (weaker) gate on top.
  if (!access.ok || access.firmId !== p.orgId) {
    throw new McpForbiddenError(CLIENT_UNREADABLE_MESSAGE);
  }
}
