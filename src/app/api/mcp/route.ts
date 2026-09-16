import { decodeJwt } from "jose";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import {
  resolveMcpPrincipal,
  McpUnauthorizedError,
  MCP_RESOURCE_URL,
  type McpPrincipal,
} from "@/lib/mcp/principal";
import { McpRateLimitedError, type McpTool } from "@/domain/mcp/define-tool";
import { McpForbiddenError } from "@/domain/mcp/guards";
import { recordAudit } from "@/lib/audit";
import { ALL_MCP_TOOLS } from "@/domain/mcp/tools";

// Solver and Monte Carlo tools run the engine. Matches the Forge compute
// routes; Vercel's function config already gives every route the large machine.
export const maxDuration = 300;

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
 * trace, never a raw error dump — for the model. Exported for direct unit
 * coverage (D5).
 *
 * F4 (Task 12 fix round 1): a DEFAULT-DENY allowlist, not a default-pass
 * with special cases. Only `McpRateLimitedError` and `McpForbiddenError` may
 * pass their `.message` through, because those two are the only error
 * shapes in this codebase with a hand-written, model-safe message
 * (define-tool.ts / guards.ts). Everything else — including a raw Postgres
 * `22P02 invalid input syntax for type uuid` from a malformed `clientId`
 * that reached the driver (every household-id schema is a bare
 * `z.string()`, not `.uuid()` — see the deferred whole-branch minor) — gets
 * one generic sentence, with the real error logged server-side so it isn't
 * simply lost.
 *
 * F6 (Task 12 fix round 1): this function used to also rewrite a raw
 * `ZodError` into a short sentence, and a comment here claimed
 * `inputSchema.parse` throws it directly. Traced to the branch actually
 * taken in the installed `@modelcontextprotocol/server@2.0.0` (the package
 * `mcp-handler` delegates to — NOT the unrelated, unused, transitive
 * `@modelcontextprotocol/sdk` also in node_modules): `validateToolInput`
 * validates every tool call against the SAME schema BEFORE our callback
 * ever runs (mcp-DXXb3Vv3.mjs:1399-1400) and turns a failure into a
 * `ProtocolError(InvalidParams, ...)` answered from `formatIssue`
 * (src-CX2iR2pK.mjs:5339-5341) as `"<path>: <message>"` — already a
 * readable sentence, not a JSON blob. `defineTool`'s own re-parse
 * (define-tool.ts:95) therefore re-validates data the SDK already accepted
 * against the identical schema, and no tool schema uses
 * `transform`/`default`/`preprocess`, so it can never throw. The `ZodError`
 * branch that used to live here was dead code proving a path the product
 * never executes; deleted along with the two tests that exercised it. The
 * one thing this means, and cannot be fixed from this callback (the SDK
 * throws before it runs): a bad-argument call writes NO audit row (see
 * `denialReason`/`recordDenial` below). A workaround of registering a
 * looser schema so our own parse becomes the throwing one was considered
 * and rejected — it would strip the tool's real schema from `tools/list`
 * and make the model worse at calling it correctly in the first place.
 */
export function toolFailureResult(err: unknown): ToolCallOutcome {
  if (err instanceof McpRateLimitedError || err instanceof McpForbiddenError) {
    return { content: [{ type: "text", text: err.message }], isError: true };
  }
  console.error("MCP tool call failed with an unexpected error:", err);
  return {
    content: [{ type: "text", text: "Foundry could not complete that request." }],
    isError: true,
  };
}

/**
 * Short, closed label for the audit row's `metadata.reason` — never the raw
 * error text. (F6: the `ZodError` → `"invalid_args"` case that used to live
 * here was dead — see `toolFailureResult`'s comment — and is removed with
 * its test.)
 */
function denialReason(err: unknown): string {
  if (err instanceof McpRateLimitedError) return `rate_limited:${err.reason}`;
  if (err instanceof McpForbiddenError) return "forbidden";
  return "error";
}

/**
 * D6: `defineTool`'s own `recordAudit` call runs only on the success path
 * (src/domain/mcp/define-tool.ts), so a forbidden client, a rate-limit
 * denial, or a bad argument leaves NO trace — an advisor probing household
 * ids across firms would be invisible to the audit log. This is that missing
 * row for every other outcome.
 *
 * F9 (Task 12 fix round 1, Ruling R87): EXCEPT a plain over-budget refusal.
 * D6's purpose is to make cross-firm PROBING visible — a forbidden client or
 * a malformed argument. A caller hammering past the rate limit is already
 * counted by the Upstash limiter, which is the better record and costs no
 * row; without this skip, the limiter's whole job of damping load would
 * instead amplify into one `audit_log` INSERT per refused call.
 * `"unconfigured"` and `"redis_error"` are NOT skipped — those are rare
 * server-side faults worth a trace, not caller-side throttling.
 *
 * The TYPED `clientId` column is always `null` here, never the id the caller
 * asked for and was refused: writing it would put a household the caller was
 * NOT cleared to read into the same field `getPortalActivity` and
 * `src/lib/ops/growth/load.ts` read as "this actor touched this client."
 * `recordAudit` fails soft on its own (see src/lib/audit.ts), so a broken
 * audit write still returns the tool's real error to the model.
 *
 * F7 (NEW — controller, measured over the wire, not in the original report): D6's stated
 * purpose was to make cross-firm PROBING visible, but with `clientId` always
 * `null` an admin reading the log sees THAT denials happened, never WHICH
 * household ids were probed — the one fact that tells a fat-fingered id
 * apart from someone sweeping ids across firms. `requestedClientId` restores
 * that, in `metadata` (jsonb), never the typed column: `audit_log.client_id`
 * is a `uuid` column with no FK, and a MALFORMED id (the `reason:"error"` row
 * — no household-id schema is `.uuid()`) cannot be cast to `uuid` and would
 * throw inside the audit write itself. Truncated defensively; a model can
 * send an arbitrarily long string as `clientId`.
 */
export async function recordDenial(
  tool: McpTool,
  principal: McpPrincipal,
  err: unknown,
  requestedClientId?: string | null,
): Promise<void> {
  if (err instanceof McpRateLimitedError && err.reason === "exceeded") return;

  await recordAudit({
    action: "mcp.tool_call",
    resourceType: "mcp_tool",
    resourceId: tool.name,
    clientId: null,
    firmId: principal.orgId,
    actorId: principal.userId,
    actorKind: "advisor",
    metadata: {
      tool: tool.name,
      outcome: "denied",
      reason: denialReason(err),
      ...(requestedClientId ? { requestedClientId: requestedClientId.slice(0, 200) } : {}),
    },
  });
}

/**
 * F7: pull the household id the caller asked for out of a tool call's raw
 * args, for the denial audit row above — best-effort and defensive, since
 * `args` here is whatever the SDK's own pre-callback validation accepted
 * against the tool's schema, not something this file has re-checked itself.
 * Every household-id schema across the 17 tools declares the field as
 * `clientId`, so one key name covers all of them.
 */
export function requestedClientIdFrom(args: unknown): string | null {
  if (!args || typeof args !== "object") return null;
  const raw = (args as Record<string, unknown>).clientId;
  return typeof raw === "string" ? raw : null;
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
            await recordDenial(tool, principal, err, requestedClientIdFrom(args));
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
    // NOTE (F7, Task 12 fix round 1, Ruling R79 — CORRECTS the comment this
    // replaces, which claimed both branches answer identically; they do
    // not): a THROW from this function reaches `withMcpAuth`'s own
    // try/catch (node_modules/mcp-handler/dist/index.js:155-163), which
    // logs "Unexpected error authenticating bearer token" and answers
    // `bearerAuthChallengeResponse("Invalid token")`. Returning `undefined`
    // instead (the `McpUnauthorizedError` branch above) takes
    // `withMcpAuth`'s `required && !authInfo` branch (:165-169), which
    // throws an `OAuthError` whose OWN catch (:190-194) suppresses the
    // `console.error` specifically because `OAuthError.isInstance` is true —
    // so THAT path is silent, and its message is "No authorization
    // provided", not "Invalid token". The two are neither the same log
    // behaviour nor the same message. Rethrowing here still buys a
    // server-side log line a dependency outage would otherwise never get;
    // the advisor-facing HTTP response still cannot be made to differ at
    // this layer with this dependency.
    throw err;
  }
};

/**
 * F5 (report I3, downgraded from Important — controller-refuted): the report
 * claimed a `scope: "profile"`-only token could reach household data. Refuted
 * against the real dev Clerk instance: a genuine DCR client registered with
 * that scope drove a full PKCE flow, got an EMPTY org selector, and its token
 * carried no `org_id` at all — sent to this server it 401'd on both
 * `tools/list` and `tools/call`, because `resolveMcpPrincipal` already throws
 * `McpUnauthorizedError` on a missing `org_id` (R20). So this is defence in
 * depth, not a hole: `requiredScopes` makes that guarantee explicit at the
 * `withMcpAuth` boundary instead of leaving it emergent from what Clerk
 * happens to mint today. Verified against `mcp-handler`'s own source
 * (node_modules/mcp-handler/dist/index.js:141,174-183) before wiring this:
 * it compares `requiredScopes` against `authInfo.scopes` (exactly what our
 * `verifyToken` populates from the token's `scope` claim) with `.every(...
 * .includes(...))`, and a missing scope throws `OAuthError(InsufficientScope)`
 * — caught by the SAME catch block as every other auth failure and answered
 * via `bearerAuthChallengeResponse`, i.e. refused (403) with the identical
 * `WWW-Authenticate` + `resource_metadata` challenge, never silently passed.
 */
const authHandler = withMcpAuth(handler, verifyToken, {
  required: true,
  resourceMetadataPath: "/.well-known/oauth-protected-resource",
  requiredScopes: ["user:org:read"],
});

export { authHandler as GET, authHandler as POST };
