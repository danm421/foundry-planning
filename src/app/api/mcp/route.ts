import { ZodError } from "zod";
import { decodeJwt } from "jose";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import {
  resolveMcpPrincipal,
  McpUnauthorizedError,
  type McpPrincipal,
} from "@/lib/mcp/principal";
import { McpRateLimitedError, type McpTool } from "@/domain/mcp/define-tool";
import { McpForbiddenError } from "@/domain/mcp/guards";
import { recordAudit } from "@/lib/audit";
import { ALL_MCP_TOOLS } from "@/domain/mcp/tools";

// Solver and Monte Carlo tools run the engine. Matches the Forge compute
// routes; Vercel's function config already gives every route the large machine.
export const maxDuration = 300;

// The MCP endpoint IS the protected resource identifier — the same string
// `.well-known/oauth-protected-resource/route.ts` advertises as `resource`.
// Kept as an identical expression there rather than a shared import: this
// route already pulls in every tool (and everything they depend on), and
// making the tiny metadata route import from here — or vice versa — would
// tie a lightweight endpoint's bundle to the other's dependency graph for a
// one-line string.
export const MCP_RESOURCE_URL = `${process.env.NEXT_PUBLIC_APP_URL ?? "https://app.foundryplanning.com"}/api/mcp`;

/**
 * True when a token's `aud` claim (absent, one value, or several) permits
 * `resource`. Exported for direct unit coverage.
 *
 * D4: `aud_claim_enabled` is currently OFF on the production Clerk instance,
 * so today's tokens carry no `aud` claim at all — treating an absent claim as
 * a rejection would fail closed on every single MCP call before the account
 * owner flips that flag. Once flipped, a PRESENT claim that doesn't name this
 * resource is rejected, so a token minted for a different resource server can
 * never be replayed here.
 */
export function audienceIsAcceptable(aud: string | string[] | undefined, resource: string): boolean {
  if (aud === undefined) return true;
  return Array.isArray(aud) ? aud.includes(resource) : aud === resource;
}

/** Shape returned to the MCP client for both a successful and a failed tool call. */
type ToolCallOutcome = {
  content: [{ type: "text"; text: string }];
  isError?: boolean;
  structuredContent?: unknown;
};

/**
 * Turn a thrown tool failure into an actionable message — never a stack
 * trace, never a raw error dump — for the three failure shapes `defineTool`
 * can throw. Exported for direct unit coverage (D5).
 *
 * `McpRateLimitedError` and `McpForbiddenError` already carry a
 * hand-written, model-safe `.message` (see define-tool.ts / guards.ts), so
 * they fall through to the generic branch unchanged. Only `ZodError` needs
 * rewriting here: `inputSchema.parse` throws it directly, and its own
 * `.message` is a multi-line JSON blob naming internal Zod issue codes, not
 * a sentence.
 *
 * NOTE on the "map exceeded -> 429, else -> 503" instruction (D5): verified
 * against the installed `@modelcontextprotocol/server@2.0.0` source (the
 * package `mcp-handler` actually delegates to — NOT the unrelated, older
 * `@modelcontextprotocol/sdk` also present in node_modules) that this is not
 * reachable as a real HTTP status. Every completed JSON-RPC response for a
 * request — a successful tool result, an `isError: true` tool result, or
 * even a protocol-level error object — is sent back as HTTP 200:
 * node_modules/@modelcontextprotocol/server/dist/index.mjs:892-899 resolves
 * both `isJSONRPCResultResponse` and `isJSONRPCErrorResponse` through the
 * SAME `Response.json(..., { status: 200 })` call. There is no per-tool-call
 * hook to override that status from inside a `registerTool` callback. The
 * achievable equivalent is the message text itself, which
 * `McpRateLimitedError`'s constructor already tailors by reason ("wait a
 * minute and retry" for `exceeded`, "temporarily unavailable" for everything
 * else) — preserved here by letting it fall through unchanged rather than
 * flattening it.
 */
export function toolFailureResult(err: unknown): ToolCallOutcome {
  if (err instanceof ZodError) {
    const issue = err.issues[0];
    const field = issue && issue.path.length > 0 ? issue.path.join(".") : "input";
    const detail = issue?.message ?? "failed validation";
    return {
      content: [{ type: "text", text: `Invalid argument "${field}": ${detail}.` }],
      isError: true,
    };
  }
  const message = err instanceof Error ? err.message : "Foundry could not complete that request.";
  return { content: [{ type: "text", text: message }], isError: true };
}

/** Short, closed label for the audit row's `metadata.reason` — never the raw error text. */
function denialReason(err: unknown): string {
  if (err instanceof McpRateLimitedError) return `rate_limited:${err.reason}`;
  if (err instanceof McpForbiddenError) return "forbidden";
  if (err instanceof ZodError) return "invalid_args";
  return "error";
}

/**
 * D6: `defineTool`'s own `recordAudit` call runs only on the success path
 * (src/domain/mcp/define-tool.ts), so a forbidden client, a rate-limit
 * denial, or a bad argument leaves NO trace — an advisor probing household
 * ids across firms would be invisible to the audit log. This is that missing
 * row for every other outcome.
 *
 * `clientId` is always `null` here, never the id the caller asked for and
 * was refused: writing it would put a household the caller was NOT cleared
 * to read into the same field `getPortalActivity` and
 * `src/lib/ops/growth/load.ts` read as "this actor touched this client."
 * `recordAudit` fails soft on its own (see src/lib/audit.ts), so a broken
 * audit write still returns the tool's real error to the model.
 */
export async function recordDenial(tool: McpTool, principal: McpPrincipal, err: unknown): Promise<void> {
  await recordAudit({
    action: "mcp.tool_call",
    resourceType: "mcp_tool",
    resourceId: tool.name,
    clientId: null,
    firmId: principal.orgId,
    actorId: principal.userId,
    actorKind: "advisor",
    metadata: { tool: tool.name, outcome: "denied", reason: denialReason(err) },
  });
}

const handler = createMcpHandler(
  (server) => {
    for (const tool of ALL_MCP_TOOLS) {
      server.registerTool(
        tool.name,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: tool.annotations,
        },
        async (args: unknown, ctx: { http?: { authInfo?: AuthInfo } }): Promise<ToolCallOutcome> => {
          const principal = ctx.http?.authInfo?.extra?.principal as McpPrincipal | undefined;
          if (!principal) {
            return {
              content: [{ type: "text", text: "Not authenticated. Reconnect Foundry in Claude." }],
              isError: true,
            };
          }
          try {
            const result = await tool.run(args, principal);
            return {
              content: [{ type: "text", text: JSON.stringify(result) }],
              structuredContent: result,
            };
          } catch (err) {
            await recordDenial(tool, principal, err);
            return toolFailureResult(err);
          }
        },
      );
    }
  },
  { serverInfo: { name: "foundry-planning", version: "1.0.0" } },
);

/**
 * Verify the bearer token and resolve the caller. `resolveMcpPrincipal` takes
 * the token alone (D2) — the request object is never passed in, so nothing
 * request-controlled can reach the verifier.
 */
export const verifyToken = async (_req: Request, bearerToken?: string): Promise<AuthInfo | undefined> => {
  if (!bearerToken) return undefined;
  try {
    const principal = await resolveMcpPrincipal(bearerToken);

    // D4 — decoding again here (no re-verification) is safe: the line above
    // already checked THIS token's signature. `decodeJwt` just reads the
    // claims back out so the audience check can run without threading a new
    // field through `resolveMcpPrincipal`'s return shape.
    const { aud } = decodeJwt(bearerToken);
    if (!audienceIsAcceptable(aud, MCP_RESOURCE_URL)) return undefined;

    return {
      token: bearerToken,
      clientId: principal.userId,
      scopes: principal.scopes,
      extra: { principal },
    };
  } catch (err) {
    if (err instanceof McpUnauthorizedError) return undefined;
    // Not a normal auth rejection — e.g. the Clerk org-membership lookup
    // inside resolveMcpPrincipal failed for a reason other than "this token
    // is bad" (a dependency outage). Rethrowing gets it logged by
    // `withMcpAuth` instead of silently collapsing into the same "reconnect"
    // 401 an actually-bad token gets.
    //
    // NOTE (D5, third bullet — "distinguish a JWKS outage from a bad
    // token"): verified against node_modules/mcp-handler/dist/index.js:150-160
    // that `withMcpAuth` itself catches every rejection here, logged or not,
    // and answers with the SAME bearerAuthChallengeResponse("Invalid token").
    // The advisor-facing response cannot be distinguished at that HTTP layer
    // with this dependency; rethrowing still buys the operational win of a
    // server-side log line instead of silence, which is what's implemented.
    throw err;
  }
};

const authHandler = withMcpAuth(handler, verifyToken, {
  required: true,
  resourceMetadataPath: "/.well-known/oauth-protected-resource",
});

export { authHandler as GET, authHandler as POST };
