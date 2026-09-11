import type { ReactElement } from "react";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import AccessRequestList from "@/components/portal/access-request-list";

export const dynamic = "force-dynamic";

/**
 * Where a firm's access-request email lands: accept or decline being connected
 * to a household.
 *
 * OUTSIDE the (portal) route group, deliberately. Both portal layouts call
 * `requireClientPortalAccess()`, which throws ForbiddenError for a login that
 * holds no binding — exactly the person this screen exists for. A route group
 * could not rescue it either: groups don't change the URL, so a second group
 * rendering /portal/requests is a route collision, and the gate lives in the
 * group's layout regardless. The path also must not start with "/portal", or
 * `isPortalRoute`'s "/portal(.*)" would swallow it and apply the advisor block.
 *
 * The advisor case is therefore handled HERE, at the page, not in a layout —
 * an auth decision never lives in a layout (a forged router-state-tree skips
 * one). A session with an active Clerk org has no business on a client screen.
 * `!userId` is defence in depth; the proxy has already run auth.protect().
 */
export default async function PortalAccessRequestsPage(): Promise<ReactElement> {
  const { userId, orgId } = await auth();
  if (!userId) redirect("/sign-in");
  if (orgId) redirect("/clients");

  return (
    <div className="flex min-h-screen justify-center bg-paper p-6">
      <div className="w-full max-w-lg py-10">
        <header className="mb-6">
          <span className="font-mono text-[0.68rem] uppercase tracking-[0.18em] text-ink-3">
            Your account
          </span>
          <h1 className="mt-3 text-balance text-2xl font-semibold leading-[1.15] tracking-[-0.02em] text-ink">
            Access requests<span className="dot">.</span>
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-ink-2">
            A firm has asked to connect your Foundry account to one of their households.
            Nothing is shared until you accept.
          </p>
        </header>

        <AccessRequestList />

        <p className="mt-8 text-[13px] leading-relaxed text-ink-3">
          Didn&rsquo;t expect this? Decline it, or email{" "}
          <a
            href="mailto:support@foundryplanning.com"
            className="text-accent hover:text-accent-ink"
          >
            support@foundryplanning.com
          </a>
          .
        </p>
      </div>
    </div>
  );
}
