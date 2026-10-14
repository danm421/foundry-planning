import type { z } from "zod";
import { recordAudit } from "@/lib/audit";
import { firmClaudeWritesEnabled } from "@/lib/firm-settings";
import { checkMcpRateLimit, type RateLimitResult } from "@/lib/rate-limit";
import { sanitizeRow } from "@/lib/redaction/sanitize-row";
import { foundryUrl, type FoundryPage } from "@/lib/mcp/foundry-url";
import type { McpPrincipal } from "@/lib/mcp/principal";
import {
  assertClientReadableForPrincipal,
  assertHouseholdReadableForPrincipal,
  McpForbiddenError,
  CLIENT_UNREADABLE_MESSAGE,
} from "./guards";
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

export type McpReadAnnotations = {
  readOnlyHint: true;
  destructiveHint: false;
  openWorldHint: false;
};

export type McpWriteAnnotations = {
  readOnlyHint: false;
  destructiveHint: false;
  idempotentHint: false;
  openWorldHint: false;
};

export type McpToolAnnotations = McpReadAnnotations | McpWriteAnnotations;

export const WRITE_DISABLED_MESSAGE =
  "Your firm hasn't turned on changes from Claude. A firm admin can turn it on in Settings → Firm.";
export const VIEW_ONLY_MESSAGE = "You have view-only access to this household.";

/** The firm switch is off. A McpForbiddenError, so the route's allowlist already passes it. */
export class McpWriteDisabledError extends McpForbiddenError {
  constructor() {
    super(WRITE_DISABLED_MESSAGE);
    this.name = "McpWriteDisabledError";
  }
}

/** A dependency the tool cannot run without (the what-if job store) is missing or failing. */
export class McpUnavailableError extends Error {
  constructor() {
    super("Foundry connector is temporarily unavailable. Try again shortly.");
    this.name = "McpUnavailableError";
  }
}

/** An argument the model can fix and retry (an unknown page id, a template it can't use).
 *  The message is hand-written and model-safe; the route passes it through verbatim. */
export class McpInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpInputError";
  }
}

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
 * limit, the authorization check, output sanitization, the deep link, and the
 * audit row. A tool author writes only the handler.
 *
 * Order matters. The rate limit runs FIRST so a denied caller cannot use tool
 * calls to probe which ids exist.
 *
 * There are TWO id spaces and a gate for each: `clientId` (a planning client,
 * checked against `assertClientReadableForPrincipal`) and `householdId` (a CRM
 * household, checked against `assertHouseholdReadableForPrincipal`). A tool
 * declares one, the other, or neither; if one ever declares both, both checks
 * run.
 *
 * Whether either check runs is driven by the SCHEMA (`"clientId" in
 * spec.inputSchema.shape`, and the same for `"householdId"`), never by
 * duck-typing the parsed value. A schema that declares the key (required,
 * optional, or nullable) always gets checked; if the key is declared but the
 * parsed value isn't a string — omitted, null, or any other shape — that
 * raises the SAME `McpForbiddenError` a denial raises, rather than silently
 * skipping the check and letting the handler run. A schema that declares
 * neither (a book-scoped, discovery-style tool) never triggers a check, same
 * as before. Both denials, and a missing row, carry one message, so existence
 * never leaks.
 *
 * A handler must wrap a list result in an object (e.g. `{ accounts: [...] }`)
 * — every one of the 19 registered tools already does this. `sanitizeRow`
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
  return buildTool(spec, {
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    requireWrite: false,
    auditAction: "mcp.tool_call",
    auditMetadata: (args, _result, householdId) => ({
      tool: spec.name,
      argKeys: Object.keys(args as object),
      ...(householdId ? { householdId } : {}),
    }),
  });
}

type DefineWriteToolSpec<S extends z.ZodObject<z.ZodRawShape>, R extends object> = DefineToolSpec<S, R> & {
  /** Ids and counts for the audit row — never the change contents. */
  auditMetadata?: (args: z.infer<S>, result: R) => Record<string, unknown>;
};

/**
 * A tool that changes data. Same wrapper as `defineTool` (one shared runner —
 * rate limit, schema, sanitized output, deep link, audit) plus the write
 * gates: the firm switch (off by default) runs right after the schema parse,
 * before any client lookup, so a firm that never turned writes on cannot use
 * a write tool to probe household ids; edit permission runs after the
 * client-readable check.
 *
 * Annotated readOnlyHint:false so Claude asks the advisor before each call.
 * Every part A write is to one household, so the schema must declare `clientId`.
 */
export function defineWriteTool<S extends z.ZodObject<z.ZodRawShape>, R extends object>(
  spec: DefineWriteToolSpec<S, R>,
): McpTool {
  if (!("clientId" in spec.inputSchema.shape)) {
    throw new Error(`write tool ${spec.name} must declare clientId in its input schema`);
  }
  return buildTool(spec, {
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    requireWrite: true,
    auditAction: "mcp.tool_write",
    auditMetadata: (args, result) => ({
      tool: spec.name,
      via: "claude",
      ...(spec.auditMetadata?.(args, result) ?? {}),
    }),
  });
}

type ToolVariant<S extends z.ZodObject<z.ZodRawShape>, R extends object> = {
  annotations: McpToolAnnotations;
  /** Write tools: firm switch before any lookup, edit permission after the client check. */
  requireWrite: boolean;
  auditAction: "mcp.tool_call" | "mcp.tool_write";
  auditMetadata: (args: z.infer<S>, result: R, householdId: string | null) => Record<string, unknown>;
};

/** The one runner behind defineTool and defineWriteTool. */
function buildTool<S extends z.ZodObject<z.ZodRawShape>, R extends object>(
  spec: DefineToolSpec<S, R>,
  variant: ToolVariant<S, R>,
): McpTool {
  return {
    name: spec.name,
    title: spec.title,
    description: spec.description,
    inputSchema: spec.inputSchema,
    annotations: variant.annotations,
    run: async (rawArgs: unknown, principal: McpPrincipal) => {
      const rl = await checkMcpRateLimit(`${principal.orgId}:${principal.userId}`);
      if (!rl.allowed) throw new McpRateLimitedError(rl.reason);

      const args = spec.inputSchema.parse(rawArgs) as z.infer<S>;

      if (variant.requireWrite && !(await firmClaudeWritesEnabled(principal.orgId))) {
        throw new McpWriteDisabledError();
      }

      // Driven by the SCHEMA, not the parsed value's runtime type: a tool
      // that declares `clientId` must always be checked, even when the
      // model omits it or sends something that isn't a string. Duck-typing
      // the value instead (`typeof args.clientId === "string" ? ... : null`)
      // fails OPEN for `.optional()` / `.nullable()` clientId fields — the
      // check would silently skip and the handler would run unauthorized.
      const declaresClientId = "clientId" in spec.inputSchema.shape;
      let clientId: string | null = null;
      let clientAccess: Awaited<ReturnType<typeof assertClientReadableForPrincipal>> | null = null;
      if (declaresClientId) {
        const rawClientId = (args as Record<string, unknown>).clientId;
        if (typeof rawClientId !== "string") {
          throw new McpForbiddenError(CLIENT_UNREADABLE_MESSAGE);
        }
        clientId = rawClientId;
        clientAccess = await assertClientReadableForPrincipal(principal, clientId);
      }

      // Same schema-driven rule as clientId above: a declared `householdId` is
      // ALWAYS checked. A tool may declare either, or neither; no tool today
      // declares both, and if one ever does, both checks run.
      const declaresHouseholdId = "householdId" in spec.inputSchema.shape;
      let householdId: string | null = null;
      if (declaresHouseholdId) {
        const rawHouseholdId = (args as Record<string, unknown>).householdId;
        if (typeof rawHouseholdId !== "string") {
          throw new McpForbiddenError(CLIENT_UNREADABLE_MESSAGE);
        }
        householdId = rawHouseholdId;
        await assertHouseholdReadableForPrincipal(principal, householdId);
      }

      // Last gate, after every readability check: a write needs edit permission.
      if (variant.requireWrite && clientAccess?.permission !== "edit") {
        throw new McpForbiddenError(VIEW_ONLY_MESSAGE);
      }

      const ctx: McpToolContext = { principal, firmId: principal.orgId };
      const result = await spec.handler(args, ctx);

      const sanitized = sanitizeRow(result);
      const withLink =
        clientId && spec.page && !Array.isArray(sanitized)
          ? { ...(sanitized as Record<string, unknown>), foundryUrl: foundryUrl(clientId, spec.page) }
          : sanitized;

      await recordAudit({
        action: variant.auditAction,
        resourceType: "mcp_tool",
        resourceId: spec.name,
        clientId,
        firmId: principal.orgId,
        actorId: principal.userId,
        actorKind: "advisor",
        metadata: variant.auditMetadata(args, result, householdId),
      });

      return withLink;
    },
  };
}
