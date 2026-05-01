import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/",
  // Browsers POST CSP violation reports here with no session cookie.
  "/api/csp-report",
  "/api/webhooks/clerk",
  "/api/webhooks/stripe",
  // Sentry tunnel route (configured in next.config.ts `tunnelRoute`).
  // Browser SDK POSTs error envelopes here without a session cookie.
  "/monitoring(.*)",
]);

// The org picker is the one authenticated route that signed-in-but-
// org-less users are allowed to reach without being bounced further.
const isOrgPickerRoute = createRouteMatcher([
  "/select-organization(.*)",
]);

export default clerkMiddleware(async (auth, request) => {
  // Surface the request pathname so server components (e.g. SettingsTabs)
  // can read it via `headers().get("x-pathname")` for active-tab highlight.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", request.nextUrl.pathname);
  const passthroughResponse = NextResponse.next({ request: { headers: requestHeaders } });

  if (isPublicRoute(request)) return passthroughResponse;

  const { userId, orgId } = await auth();

  if (!userId) {
    await auth.protect();
    return passthroughResponse;
  }

  // Signed in but no active Clerk org. API routes use requireOrgId()
  // which would 401 — so for page navigation we push them to the org
  // picker instead of dead-ending on an empty workspace. API routes
  // skip the redirect so fetch()/XHR callers still get a clean 401.
  if (!orgId && !isOrgPickerRoute(request) && !request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.redirect(new URL("/select-organization", request.url));
  }

  return passthroughResponse;
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
