import type { z } from "zod";
import { recordAudit } from "@/lib/audit";
import { checkMcpRateLimit, type RateLimitResult } from "@/lib/rate-limit";
import { sanitizeRow } from "@/lib/redaction/sanitize-row";
import { foundryUrl, type FoundryPage } from "@/lib/mcp/foundry-url";
import type { McpPrincipal } from "@/lib/mcp/principal";
import { assertClientReadableForPrincipal, McpForbiddenError, CLIENT_UNREADABLE_MESSAGE } from "./guards";
import type { McpToolContext } from "./context";

/** The reason union `checkMcpRateLimit` returns on `allowed: false`. */
type RateLimitDeniedReason = Extract<RateLimitResult, { allowed: false }>["reason"];

export class McpRateLimitedError extends Error {
  /**
   * Why the call was denied. `"exceeded"` is a real over-budget caller —
   * waiting helps. `"unconfigured"` and `"redis_error"` fail closed for a
   * server-side reason the caller cannot fix by waiting; Task 12 maps this
   * to 429 vs 503 by checking it.
   */
  constructor(public readonly reason: RateLimitDeniedReason) {
    super(
      reason === "exceeded"
        ? "Foundry rate limit reached for this connector. Wait a minute and retry."
        : "Foundry connector is temporarily unavailable. Try again shortly.",
    );
    this.name = "McpRateLimitedError";
  }
}

export type McpToolAnnotations = {
  readOnlyHint: true;
  destructiveHint: false;
  openWorldHint: false;
};

export type McpTool = {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodObject<z.ZodRawShape>;
  annotations: McpToolAnnotations;
  run: (args: unknown, principal: McpPrincipal) => Promise<unknown>;
};

type DefineToolSpec<S extends z.ZodObject<z.ZodRawShape>, R extends object> = {
  name: string;
  title: string;
  description: string;
  inputSchema: S;
  /** Deep-link target for the response. Omit for book-scoped tools. */
  page?: FoundryPage;
  handler: (args: z.infer<S>, ctx: McpToolContext) => Promise<R>;
};

/**
 * Wrap a tool body with everything that must never be forgotten: the rate
 * limit, the per-client authorization check, output sanitization, the deep
 * link, and the audit row. A tool author writes only the handler.
 *
 * Order matters. The rate limit runs FIRST so a denied caller cannot use tool
 * calls to probe which client ids exist.
 *
 * Whether a per-client check runs is driven by the SCHEMA (`"clientId" in
 * spec.inputSchema.shape`), never by duck-typing the parsed value. A schema
 * that declares `clientId` (required, optional, or nullable) always gets
 * checked; if the key is declared but the parsed value isn't a string —
 * omitted, null, or any other shape — that raises the SAME
 * `McpForbiddenError` a denied client raises, rather than silently skipping
 * the check and letting the handler run. A schema that declares no
 * `clientId` at all (a book-scoped, discovery-style tool) never triggers a
 * check, same as before.
 *
 * A handler must wrap a list result in an object (e.g. `{ accounts: [...] }`)
 * — every one of the 17 Task 8-11 tools already does this. `sanitizeRow`
 * preserves an array's shape, and spreading one into
 * `{ ...sanitized, foundryUrl }` would silently renumber it into
 * `{0: ..., 1: ..., foundryUrl}`. As a second line of defence this wrapper
 * detects that case at runtime and returns the array unchanged — dropping the
 * deep link rather than corrupting the payload; a missing link is the right
 * failure direction for a read-only tool.
 */
export function defineTool<S extends z.ZodObject<z.ZodRawShape>, R extends object>(
  spec: DefineToolSpec<S, R>,
): McpTool {
  return {
    name: spec.name,
    title: spec.title,
    description: spec.description,
    inputSchema: spec.inputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    run: async (rawArgs: unknown, principal: McpPrincipal) => {
      const rl = await checkMcpRateLimit(`${principal.orgId}:${principal.userId}`);
      if (!rl.allowed) throw new McpRateLimitedError(rl.reason);

      const args = spec.inputSchema.parse(rawArgs) as z.infer<S>;

      // Driven by the SCHEMA, not the parsed value's runtime type: a tool
      // that declares `clientId` must always be checked, even when the
      // model omits it or sends something that isn't a string. Duck-typing
      // the value instead (`typeof args.clientId === "string" ? ... : null`)
      // fails OPEN for `.optional()` / `.nullable()` clientId fields — the
      // check would silently skip and the handler would run unauthorized.
      const declaresClientId = "clientId" in spec.inputSchema.shape;
      let clientId: string | null = null;
      if (declaresClientId) {
        const rawClientId = (args as Record<string, unknown>).clientId;
        if (typeof rawClientId !== "string") {
          throw new McpForbiddenError(CLIENT_UNREADABLE_MESSAGE);
        }
        clientId = rawClientId;
        await assertClientReadableForPrincipal(principal, clientId);
      }

      const ctx: McpToolContext = { principal, firmId: principal.orgId };
      const result = await spec.handler(args, ctx);

      const sanitized = sanitizeRow(result);
      const withLink =
        clientId && spec.page && !Array.isArray(sanitized)
          ? { ...(sanitized as Record<string, unknown>), foundryUrl: foundryUrl(clientId, spec.page) }
          : sanitized;

      await recordAudit({
        action: "mcp.tool_call",
        resourceType: "mcp_tool",
        resourceId: spec.name,
        clientId,
        firmId: principal.orgId,
        actorId: principal.userId,
        actorKind: "advisor",
        metadata: { tool: spec.name, argKeys: Object.keys(args as object) },
      });

      return withLink;
    },
  };
}
