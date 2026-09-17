import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { OAuthError, OAuthErrorCode, bearerAuthChallengeResponse } from "@modelcontextprotocol/server";
import { stateFromMeta, type OrgMeta } from "@/lib/billing/subscription-state";
import { decideAccess, enforcementMode, isEnforced } from "@/lib/billing/access-policy";
import { recordAudit } from "@/lib/audit";
import { operationsBlocked } from "@/lib/operations-route-guard";
import { getPortalClientId } from "@/lib/portal/get-portal-client";
import { hasUnsubmittedPrefilledForm } from "@/lib/intake/queries";
import { claimPortalBinding } from "@/lib/portal/claim-portal-binding";
import { PORTAL_AS_CLIENT_HEADER } from "@/lib/portal/portal-as-client-header";

const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/beta",
  "/beta/signup(.*)",
  "/",
  "/checkout/(.*)",
  "/api/checkout/(.*)",
  // Vercel Cron hits these GET routes with no session cookie; each route
  // self-protects via a Bearer CRON_SECRET check (see reconcile-billing,
  // refresh-holding-prices). Without this, clerkMiddleware 307s the cron.
  "/api/cron/(.*)",
  // The MCP connector authenticates with an OAuth bearer token, not a Clerk
  // session cookie, so auth.protect() would reject it. It self-protects
  // inside the handler via withMcpAuth — same shape as /api/cron/*.
  "/api/mcp(.*)",
  // Browsers POST CSP violation reports here with no session cookie.
  "/api/csp-report",
  "/api/webhooks/clerk",
  "/api/webhooks/stripe",
  // Plaid webhook deliveries — authenticated by ES256 JWT verification inside
  // the route (webhook-verify.ts), not by session.
  "/api/webhooks/plaid",
  // Sentry tunnel route (configured in next.config.ts `tunnelRoute`).
  // Browser SDK POSTs error envelopes here without a session cookie.
  "/monitoring(.*)",
  // Public intake forms — reachable without a Clerk session.
  "/intake/(.*)",
  "/api/intake/(.*)",
  // Public risk-tolerance questionnaire — emailed link, token-authenticated,
  // reachable without a Clerk session.
  "/risk-questionnaire/(.*)",
  "/api/risk-questionnaire/(.*)",
  // AASA / assetlinks — Apple's universal-links crawler and Google's Digital
  // Asset Links fetcher hit these paths with no session cookie. The AASA file
  // has no extension (Apple requires that), so clerkMiddleware's
  // extension-based `config.matcher` below DOES run on it; without this
  // exemption auth.protect() 404s/redirects the crawler and iOS never trusts
  // the universal link (see src/app/__tests__/aasa.test.ts).
  "/.well-known/(.*)",
]);

// The org picker is the one authenticated route that signed-in-but-
// org-less users are allowed to reach without being bounced further —
// plus /welcome, the setup step, where a self-serve buyer names their firm
// before paying. They are org-less there BY DESIGN: creating the Clerk org
// before the payment lands would put them in the `missing` subscription state,
// which this middleware blocks unconditionally.
// The accept/decline screen an access-request email links to. Deliberately NOT
// under /portal: both (portal) layouts call requireClientPortalAccess(), which
// throws for a login that holds no binding — precisely the person this screen
// exists for. Nor may it be named /portal-something: isPortalRoute's "/portal(.*)"
// would swallow that too and apply the advisor block to it.
//
// One literal, two matchers, because the two org-less branches below reach it
// for different reasons: an UNBOUND requester is exempted via isOrgPickerRoute,
// a requester already BOUND to another firm via isAccessRequestRoute.
const ACCESS_REQUEST_ROUTE = "/requests(.*)";
const isAccessRequestRoute = createRouteMatcher([ACCESS_REQUEST_ROUTE]);

const isOrgPickerRoute = createRouteMatcher([
  "/select-organization(.*)",
  "/beta/redeem(.*)",
  "/welcome(.*)",
  // A person asked to grant a firm access has no org and, the first time, no
  // binding either. This is the one authenticated page they may reach before
  // deciding — without it they land on the org picker and can never answer.
  ACCESS_REQUEST_ROUTE,
]);

const isPortalRoute = createRouteMatcher(["/portal(.*)", "/api/portal(.*)"]);

// Billing access enforcement (AD-1) must never block the very surface a
// locked/blocked firm needs to fix billing — the billing settings page and
// the Customer Portal route. Exempting them prevents a redirect loop.
const isBillingExemptRoute = createRouteMatcher([
  "/settings/billing(.*)",
  "/api/billing/portal",
]);

// F6: narrow matcher just for the malformed-bearer-token catch below — never
// reuse `isPublicRoute` here, which covers many OTHER unauthenticated routes
// this fix must not touch.
const isMcpRoute = createRouteMatcher(["/api/mcp(.*)"]);

const clerkAuthMiddleware = clerkMiddleware(async (auth, request) => {
  // Surface the request pathname so server components (e.g. SettingsTabs)
  // can read it via `headers().get("x-pathname")` for active-tab highlight.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", request.nextUrl.pathname);
  const passthroughResponse = NextResponse.next({ request: { headers: requestHeaders } });

  if (isPublicRoute(request)) return passthroughResponse;

  const { userId, orgId, orgRole, sessionClaims } = await auth();

  if (!userId) {
    await auth.protect();
    return passthroughResponse;
  }

  // Advisor (has a Clerk org) trying to reach portal surfaces → send to /clients.
  // EXCEPTION: the interactive portal preview lets an advisor drive the real
  // portal API *as* a specific client. Those fetches carry the
  // x-portal-as-client header and are authorized in the route handler via
  // resolvePortalClient → requireClientEditAccess. The header rides XHR/fetch
  // only, never page navigations, so portal *pages* still redirect — only
  // act-as API calls pass through to be authorized downstream.
  if (
    orgId &&
    isPortalRoute(request) &&
    !request.headers.get(PORTAL_AS_CLIENT_HEADER)
  ) {
    return NextResponse.redirect(new URL("/clients", request.url));
  }

  // Signed in, no active Clerk org: could be a bound portal client, or an
  // org-less advisor who hasn't picked an org yet. Resolve the binding once
  // (React.cache'd). Only org-less requests pay this lookup; the hot advisor
  // path has an orgId and never enters this block.
  if (!orgId) {
    // Resolve an existing binding; if none, attempt a one-time self-heal from
    // the Clerk user's invitation metadata (fail-safe: returns null on error).
    const portalClientId =
      (await getPortalClientId(userId)) ?? (await claimPortalBinding(userId));
    if (portalClientId) {
      // Bound portal user: allow /portal/*; allow API routes; bounce every
      // other page to the portal home.
      //
      // Allowing API routes here is not the authorization decision: every
      // `/api/portal/*` handler re-checks the client_portal entitlement for
      // itself, via `resolvePortalClient` or `requireClientPortalAccess`
      // directly. An ops revoke closes the pages AND the API.
      //
      // THREE deliberate exceptions do neither, so an ops revoke does NOT close
      // them. `/api/portal/requests` cannot check an entitlement: it serves the
      // person being asked for their FIRST binding, who by definition holds
      // none. `/api/portal/connections` must not: it lists every firm holding
      // this login and ends any of them, so gating it on the ACTIVE household's
      // firm would let one firm switching the portal off take away the client's
      // ability to leave a different firm. `/api/portal/active-household` must
      // not either, for the same reason: it MOVES between those firms, so that
      // one firm could otherwise trap the client in the household it had just
      // switched off. All three are safe ungated because every row any of them
      // reads or writes is constrained by the `clerkUserId` predicate inside
      // `bindings.ts` — the caller can only ever see and settle their own
      // bindings, and no user id is accepted from the request body. Being
      // ungated is the design, not an oversight, and the three share one
      // named gate (`requirePortalSession`) so a fourth cannot appear by
      // copy-paste without meeting this list.
      //
      // Soft first-run gate: redirect to /portal/intake when the client has
      // an unsubmitted prefilled form (draft-only — not after submission).
      // Excludes /portal/intake itself (no redirect loop) and /api/* so the
      // wizard's autosave/submit fetches pass through.
      //
      // /requests is excluded from the intake bounce for the same reason
      // /portal/intake and /api/ are: a client mid-onboarding at firm A must
      // still be able to answer firm B. Checked before the query so this costs
      // no round trip.
      const path = request.nextUrl.pathname;
      if (
        !path.startsWith("/api/") &&
        path !== "/portal/intake" &&
        !isAccessRequestRoute(request) &&
        (await hasUnsubmittedPrefilledForm(portalClientId))
      ) {
        return NextResponse.redirect(new URL("/portal/intake", request.url));
      }

      if (isPortalRoute(request)) return passthroughResponse;
      // A client already bound to firm A, asked by firm B, takes THIS branch —
      // /requests is not a portal route, so without this they are bounced to
      // their own organizer and the request is unanswerable.
      if (isAccessRequestRoute(request)) return passthroughResponse;
      if (path.startsWith("/api/")) return passthroughResponse;
      // Organizer → Household: the surface the legacy /portal/profile used to
      // render, and what that path now redirects to. Target it directly — the
      // shim sits under the portal's streaming boundary, where
      // `permanentRedirect()` lands as a `<meta http-equiv="refresh">` inside a
      // 200 rather than a 308, i.e. a second full page load.
      return NextResponse.redirect(new URL("/portal/organizer", request.url));
    }
    // Unbound + no org → existing org-picker behavior.
    if (!isOrgPickerRoute(request) && !request.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.redirect(new URL("/select-organization", request.url));
    }
  }

  // Role gate: operations is CRM + Tasks only. Block any other authenticated
  // surface (planning, CMA, admin settings) at the chokepoint — authoritative
  // for both pages and API routes by path. Pages redirect to the Tasks home;
  // API calls get a clean 403 so fetch()/XHR callers don't follow a redirect.
  // NB: target /tasks, NOT /crm — /crm just `redirect("/clients")`s, and /clients
  // is itself blocked here, so /crm would bounce ops into an infinite loop.
  if (orgId && operationsBlocked(orgRole, request.nextUrl.pathname)) {
    if (request.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "forbidden_role" }, { status: 403 });
    }
    return NextResponse.redirect(new URL("/tasks", request.url));
  }

  // Billing access enforcement (AD-1). Reads subscription state from session
  // claims only — no DB / no Clerk API on the hot path. Shipped in log-only
  // mode (BILLING_ENFORCEMENT_MODE unset/"log"): audits the would-be denial
  // without blocking. Flip to "enforce" to start blocking.
  if (orgId && !isBillingExemptRoute(request)) {
    const meta = (sessionClaims as { org_public_metadata?: OrgMeta } | null)
      ?.org_public_metadata;
    const state = stateFromMeta(meta);
    const method = request.method;
    const path = request.nextUrl.pathname;
    const decision = decideAccess(state, method, path);

    if (decision !== "allow") {
      const mode = enforcementMode();
      // Audit every (would-be) denial — evidence the control operated.
      await recordAudit({
        action: "billing.access_denied",
        resourceType: "firm",
        resourceId: orgId,
        firmId: orgId,
        actorId: userId,
        metadata: { decision, mode, method, path, status: state.kind },
      });

      // Which states ignore the rollout flag lives in access-policy.ts beside
      // `decideAccess`, so this and the MCP connector cannot drift (R74/R85).
      // Note `comp_ended` decides to `block_mutation`, never `lock_out`, so it
      // only ever blocks WRITES — a GET returns "allow" above and never reaches
      // here. Those firms keep reading their book, and /settings/billing is
      // billing-exempt, so the route to checkout stays open.
      const shouldBlock = isEnforced(state, decision);
      if (shouldBlock) {
        if (path.startsWith("/api/")) {
          return NextResponse.json(
            { error: "subscription_inactive" },
            { status: 403 },
          );
        }
        return NextResponse.redirect(new URL("/settings/billing", request.url));
      }
    }
  }

  return passthroughResponse;
});

/**
 * F6 (controller, measured over the wire against a real `next dev`): a Bearer
 * header shaped like a JWT — three dot-separated segments — whose segments
 * are NOT valid base64url (e.g. `Bearer not.a.jwt`) makes Clerk's own
 * `decodeJwt` (`@clerk/backend`) throw a raw `SyntaxError` synchronously
 * inside `authenticateRequest`, which `clerkMiddleware` calls BEFORE the
 * callback above ever runs — so `isPublicRoute`'s `/api/mcp` exemption never
 * gets a chance to fire, and the client gets a bare 500 with no
 * `WWW-Authenticate` challenge to recover from. Every OTHER bad-token shape
 * (missing, a single segment, a real 3-segment JWT with a bad signature or
 * expiry) is already safe: `decodeJwt` either short-circuits before
 * `authenticateRequest` calls the base64 decoder (a non-3-segment string) or
 * fails INSIDE `resolveMcpPrincipal`'s own `jwtVerify(...).catch(...)`
 * (`src/lib/mcp/principal.ts`), which converts every such failure to a clean
 * `McpUnauthorizedError` → 401. This is the one shape neither of those
 * layers can reach, because it never gets past Clerk's own middleware to
 * reach either one.
 *
 * Scoped to `/api/mcp` and to this exact error class — for any other route,
 * or any other thrown error, this rethrows unchanged, so nothing about any
 * other route's behaviour moves. Reuses `bearerAuthChallengeResponse` (the
 * same builder `mcp-handler`'s `withMcpAuth` uses internally) rather than
 * hand-rolling the `WWW-Authenticate` header, so the challenge shape can't
 * drift from what a real MCP client already expects from every other bad
 * token.
 */
export default async function proxy(...args: Parameters<typeof clerkAuthMiddleware>) {
  const [request] = args;
  try {
    return await clerkAuthMiddleware(...args);
  } catch (err) {
    if (isMcpRoute(request) && err instanceof SyntaxError) {
      const resourceMetadataUrl = new URL(
        "/.well-known/oauth-protected-resource",
        request.url,
      ).toString();
      return bearerAuthChallengeResponse(
        new OAuthError(OAuthErrorCode.InvalidToken, "Invalid token"),
        { resourceMetadataUrl },
      );
    }
    throw err;
  }
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
