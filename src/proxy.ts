import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { stateFromMeta, type OrgMeta } from "@/lib/billing/subscription-state";
import { decideAccess } from "@/lib/billing/access-policy";
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
  // Browsers POST CSP violation reports here with no session cookie.
  "/api/csp-report",
  "/api/webhooks/clerk",
  "/api/webhooks/stripe",
  // Sentry tunnel route (configured in next.config.ts `tunnelRoute`).
  // Browser SDK POSTs error envelopes here without a session cookie.
  "/monitoring(.*)",
  // Public intake forms — reachable without a Clerk session.
  "/intake/(.*)",
  "/api/intake/(.*)",
]);

// The org picker is the one authenticated route that signed-in-but-
// org-less users are allowed to reach without being bounced further.
const isOrgPickerRoute = createRouteMatcher([
  "/select-organization(.*)",
  "/beta/redeem(.*)",
]);

const isPortalRoute = createRouteMatcher(["/portal(.*)", "/api/portal(.*)"]);

// Billing access enforcement (AD-1) must never block the very surface a
// locked/blocked firm needs to fix billing — the billing settings page and
// the Customer Portal route. Exempting them prevents a redirect loop.
const isBillingExemptRoute = createRouteMatcher([
  "/settings/billing(.*)",
  "/api/billing/portal",
]);

type EnforcementMode = "log" | "enforce";
function enforcementMode(): EnforcementMode {
  return process.env.BILLING_ENFORCEMENT_MODE === "enforce" ? "enforce" : "log";
}

export default clerkMiddleware(async (auth, request) => {
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
      // Bound portal user: allow /portal/*; allow API routes (their handlers
      // gate via requireClientPortalAccess); bounce every other page to the
      // portal home.
      //
      // Soft first-run gate: redirect to /portal/intake when the client has
      // an unsubmitted prefilled form (draft-only — not after submission).
      // Excludes /portal/intake itself (no redirect loop) and /api/* so the
      // wizard's autosave/submit fetches pass through.
      const path = request.nextUrl.pathname;
      if (
        !path.startsWith("/api/") &&
        path !== "/portal/intake" &&
        (await hasUnsubmittedPrefilledForm(portalClientId))
      ) {
        return NextResponse.redirect(new URL("/portal/intake", request.url));
      }

      if (isPortalRoute(request)) return passthroughResponse;
      if (path.startsWith("/api/")) return passthroughResponse;
      return NextResponse.redirect(new URL("/portal/profile", request.url));
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

      // A `missing` state (signed-in, has an active org, but zero readable
      // subscription metadata) is an unprovisioned / broken account, not a
      // billing-rollout judgment call — block it regardless of mode. With
      // Clerk auto-org-creation disabled no real org reaches this state, so
      // this can never lock out a legitimately-provisioned firm. Other states
      // only block once BILLING_ENFORCEMENT_MODE is flipped to "enforce".
      const shouldBlock = mode === "enforce" || state.kind === "missing";
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

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
