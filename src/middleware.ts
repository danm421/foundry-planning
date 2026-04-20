import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/",
  // Browsers POST CSP violation reports here with no session cookie.
  "/api/csp-report",
]);

// The org picker is the one authenticated route that signed-in-but-
// org-less users are allowed to reach without being bounced further.
const isOrgPickerRoute = createRouteMatcher([
  "/select-organization(.*)",
]);

export default clerkMiddleware(async (auth, request) => {
  if (isPublicRoute(request)) return;

  const { userId, orgId } = await auth();

  if (!userId) {
    await auth.protect();
    return;
  }

  // Signed in but no active Clerk org. API routes use requireOrgId()
  // which would 401 — so for page navigation we push them to the org
  // picker instead of dead-ending on an empty workspace. API routes
  // skip the redirect so fetch()/XHR callers still get a clean 401.
  if (!orgId && !isOrgPickerRoute(request) && !request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.redirect(new URL("/select-organization", request.url));
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
