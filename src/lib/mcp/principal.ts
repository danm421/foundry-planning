import { clerkClient } from "@clerk/nextjs/server";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Principal } from "@/lib/clients/authz";

/**
 * A verified MCP caller. `orgId` is non-nullable on purpose: Foundry's tenant
 * IS the Clerk org, and every tool reads client PII, so a token without an
 * organization is never good enough — the same bar `requireOrgId()` sets for
 * the session doorway in `src/lib/db-helpers.ts`.
 */
export type McpPrincipal = Principal & {
  orgId: string;
  /**
   * Non-nullable too, and for a sharper reason than `orgId`: the role is read
   * live from Clerk's membership list, and no membership means no principal at
   * all. A `null` here would be read downstream as a plain member, which in a
   * firm without book siloing widens to the whole firm's book — so the type
   * refuses to represent that state.
   */
  orgRole: string;
  scopes: string[];
  tokenSubject: string;
};

export class McpUnauthorizedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "McpUnauthorizedError";
  }
}

/** Passed explicitly: Clerk's own default page is smaller. See `resolveOrgRole`. */
const MEMBERSHIP_PAGE_SIZE = 100;

/**
 * Clerk's OAuth issuer, derived from the publishable key rather than read from
 * the token being verified.
 *
 * A publishable key is `pk_(test|live)_<base64(frontendApiHost + "$")>`, and the
 * instance's issuer is `https://<frontendApiHost>` — so this repo's own config
 * pins the issuer without needing a new env var.
 *
 * Taking `iss` out of the untrusted token instead would be a confused deputy:
 * the attacker would pick the issuer, therefore the JWKS, therefore the signing
 * keys, and could mint tokens we accept.
 *
 * Exported so the `.well-known/oauth-protected-resource` route can advertise
 * this exact issuer as the authorization server (Task 12 / Ruling R74) — one
 * derivation, one source of truth, instead of a second guess that can drift
 * from what this file actually enforces.
 */
export function deriveIssuer(): string {
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";
  const encodedHost = publishableKey.replace(/^pk_(test|live)_/, "");
  let host = "";
  if (encodedHost && encodedHost !== publishableKey) {
    try {
      host = atob(encodedHost).replace(/\$$/, "");
    } catch {
      host = "";
    }
  }
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host)) {
    throw new McpUnauthorizedError("this server is not configured for MCP access");
  }
  return `https://${host}`;
}

let verifier: { issuer: string; jwks: ReturnType<typeof createRemoteJWKSet> } | null = null;

/**
 * Built once per process. `createRemoteJWKSet` caches Clerk's signing keys
 * internally, so re-creating it per request would throw that cache away and
 * refetch the JWKS on every MCP call.
 */
function tokenVerifier() {
  if (!verifier) {
    const issuer = deriveIssuer();
    verifier = {
      issuer,
      jwks: createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`)),
    };
  }
  return verifier;
}

/**
 * The caller's role in `orgId`, read LIVE from Clerk — never from the token.
 *
 * A Clerk OAuth access token carries no role claim at all, so a principal built
 * from the token alone would always have `orgRole: null`. That is not a
 * harmless blank: `resolveVisibleAdvisorIds` treats a null role as a plain
 * member, and in a firm that has not enabled book siloing a plain member
 * resolves to VISIBLE_ALL. An `org:operations` or `org:planner` user who sees
 * only their mapped advisors on the web would read the whole firm's book over
 * MCP. Reading the role live also revokes a removed member immediately instead
 * of at the 24-hour token expiry.
 *
 * Returns null when the user holds no membership in that org; the caller fails
 * closed on that.
 */
async function resolveOrgRole(userId: string, orgId: string): Promise<string | null> {
  const clerk = await clerkClient();

  // The list is paginated and Clerk's default page is smaller than ours, so a
  // truncated first page would read as "no membership" and lock a legitimate
  // advisor out. Walk every page the total count says exists. `pageCount` is
  // re-read from the server each time but `page` only ever climbs, so a bad
  // total (including a non-numeric one) ends the loop rather than spinning it.
  let pageCount = 1;
  for (let page = 0; page < pageCount; page++) {
    const { data, totalCount } = await clerk.users.getOrganizationMembershipList({
      userId,
      limit: MEMBERSHIP_PAGE_SIZE,
      offset: page * MEMBERSHIP_PAGE_SIZE,
    });
    const role = data.find((m) => m.organization?.id === orgId)?.role;
    if (role) return role;
    pageCount = Math.ceil(totalCount / MEMBERSHIP_PAGE_SIZE);
  }
  return null;
}

/**
 * Verify an OAuth bearer token and resolve the caller's firm. This is the only
 * place an MCP bearer token is interpreted; everything downstream trusts what
 * it returns.
 *
 * Clerk is the authorization server. Its own `verifyToken` cannot read these
 * tokens (it demands `typ: "JWT"`, while an OAuth access token is `at+jwt` per
 * RFC 9068), and `authenticateRequest(...).toAuth()` declares only `userId` and
 * `clientId` for an `oauth_token` — no organization. So the token is verified
 * with `jose` against Clerk's JWKS and the firm is read from the token's
 * top-level, snake_case `org_id` claim.
 *
 * Throws `McpUnauthorizedError` on every rejection; there is no path that
 * returns a principal without a verified signature, a pinned issuer, a present
 * `org_id` and a confirmed live membership.
 */
export async function resolveMcpPrincipal(bearerToken: string): Promise<McpPrincipal> {
  if (!bearerToken) throw new McpUnauthorizedError("missing bearer token");

  const { issuer, jwks } = tokenVerifier();

  // `algorithms` is defence in depth: jose 6.2.3 already filters candidate keys
  // by algorithm before it looks one up, and Clerk's JWKS declares RS256, so
  // algorithm confusion is not reachable today. Pinning it keeps that true if
  // either side changes.
  const verifyOptions = { issuer, typ: "at+jwt", algorithms: ["RS256"] };
  const { payload } = await jwtVerify(bearerToken, jwks, verifyOptions).catch(() => {
    // Deliberately opaque: signature, issuer, type, algorithm and expiry
    // failures share one message, so a caller cannot probe which check it
    // tripped.
    throw new McpUnauthorizedError("token failed verification");
  });

  const userId = typeof payload.sub === "string" ? payload.sub : "";
  if (!userId) throw new McpUnauthorizedError("token carries no subject");

  const orgId = typeof payload.org_id === "string" ? payload.org_id : "";
  if (!orgId) {
    throw new McpUnauthorizedError(
      "token has no organization — reconnect Foundry in Claude and pick a firm when prompted",
    );
  }

  // `scope` is a space-delimited string, not an array.
  const scopes =
    typeof payload.scope === "string" ? payload.scope.split(/\s+/).filter(Boolean) : [];

  const orgRole = await resolveOrgRole(userId, orgId);
  if (!orgRole) {
    throw new McpUnauthorizedError(
      "this account is not a member of the connected organization — reconnect Foundry in Claude and pick a firm you belong to",
    );
  }

  return { userId, orgId, orgRole, scopes, tokenSubject: userId };
}
