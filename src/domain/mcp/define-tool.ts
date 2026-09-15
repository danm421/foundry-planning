import type { z } from "zod";
import { recordAudit } from "@/lib/audit";
import { checkMcpRateLimit, type RateLimitResult } from "@/lib/rate-limit";
import { sanitizeRow } from "@/lib/redaction/sanitize-row";
import { foundryUrl, type FoundryPage } from "@/lib/mcp/foundry-url";
import type { McpPrincipal } from "@/lib/mcp/principal";
import { assertClientReadableForPrincipal } from "./guards";
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

type DefineToolSpec<S extends z.ZodObject<z.ZodRawShape>, R> = {
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
 */
export function defineTool<S extends z.ZodObject<z.ZodRawShape>, R>(
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
      const clientId =
        typeof (args as Record<string, unknown>).clientId === "string"
          ? ((args as Record<string, unknown>).clientId as string)
          : null;

      if (clientId) await assertClientReadableForPrincipal(principal, clientId);

      const ctx: McpToolContext = { principal, firmId: principal.orgId };
      const result = await spec.handler(args, ctx);

      const sanitized = sanitizeRow(result) as Record<string, unknown>;
      const withLink =
        clientId && spec.page
          ? { ...sanitized, foundryUrl: foundryUrl(clientId, spec.page) }
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
