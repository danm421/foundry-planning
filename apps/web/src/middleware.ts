import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { impersonationSessionRepo } from "./lib/impersonation-session-repo-singleton";

const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/",
]);

const COOKIE = "foundry_impersonation";

/**
 * ARCHITECTURE DECISION — fallback path (header-based, not ALS).
 *
 * Next.js 16 docs (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md)
 * explicitly state: "Proxy is meant to be invoked separately of your render code...
 * you should not attempt relying on shared modules or globals. To pass information
 * from Proxy to your application, use headers, cookies, rewrites, redirects, or the URL."
 *
 * Even though proxy/middleware now runs in the Node.js runtime by default (stable since v15.5),
 * it runs as a separate process/async context from route handlers. AsyncLocalStorage set here
 * will NOT propagate into route handlers — store.getStore() would return undefined there.
 * Additionally, the `runtime` config key is NOT permitted in proxy files (throws a build error).
 *
 * Chosen approach: attach x-impersonation-session-id as a request header so that
 * Task 10's Clerk fallback can read it and build the AdvisorContext on demand.
 */
export default clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request)) {
    await auth.protect();
  }

  const cookie = request.cookies.get(COOKIE);
  if (!cookie) return NextResponse.next();

  const session = await impersonationSessionRepo.loadActive(cookie.value);
  if (!session) {
    // Session expired or invalid — clear the stale cookie.
    const res = NextResponse.next();
    res.cookies.delete(COOKIE);
    return res;
  }

  // Attach session id as request header so route handlers/server components
  // can reconstruct AdvisorContext without relying on ALS propagation.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-impersonation-session-id", session.sessionId);
  return NextResponse.next({
    request: { headers: requestHeaders },
  });
});

// NOTE: `runtime` is NOT a valid config key in Next.js 16 proxy/middleware files.
// The proxy runtime is always nodejs and cannot be configured.
export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
