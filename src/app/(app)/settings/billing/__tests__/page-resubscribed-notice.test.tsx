// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@clerk/nextjs", () => ({ SignOutButton: () => null }));
vi.mock("@/lib/authz", () => ({
  requireBillingContact: vi.fn().mockResolvedValue(undefined),
  ForbiddenError: class ForbiddenError extends Error {},
}));
vi.mock("@/lib/billing/subscription-state", async (orig) => ({
  ...((await orig()) as object),
  getSubscriptionState: vi.fn().mockResolvedValue({ kind: "comp_ended" }),
}));
vi.mock("@/db", () => ({ db: { select: vi.fn() } }));
vi.mock("../actions", () => ({ startResubscribeCheckout: vi.fn() }));

import BillingSettingsPage from "../page";
import { auth } from "@clerk/nextjs/server";

/**
 * Both cases below run the FOUNDER branch on purpose. That is not a shortcut:
 * it is the exact shape of the regression — Clerk's org metadata is cleared by
 * the checkout webhook, but the buyer's JWT keeps `is_founder: true` until it
 * refreshes, so the visit Stripe redirects them to renders the founder panel.
 * (It is also the only branch RTL can render here: the non-founder panel is an
 * async server component, which React cannot resolve as a nested child.)
 */
function withStaleFounderToken() {
  vi.mocked(auth).mockResolvedValue({
    orgId: "org_abc",
    sessionClaims: { org_public_metadata: { is_founder: true } },
  } as never);
}

beforeEach(() => vi.clearAllMocks());

describe("the ?resubscribed=1 confirmation", () => {
  it("shows even while the session token still says is_founder", async () => {
    withStaleFounderToken();
    render(
      await BillingSettingsPage({ searchParams: Promise.resolve({ resubscribed: "1" }) }),
    );
    expect(screen.getByRole("status")).not.toBeNull();
    expect(screen.getByText(/payment received/i)).not.toBeNull();
  });

  it("stays hidden on a normal visit to the same branch", async () => {
    withStaleFounderToken();
    render(await BillingSettingsPage({ searchParams: Promise.resolve({}) }));
    // Anchored on something that DID render, so an empty tree cannot pass this
    // the way a bare queryBy(...).toBeNull() would.
    expect(screen.getByText(/Founder Plan/i)).not.toBeNull();
    expect(screen.queryByText(/payment received/i)).toBeNull();
  });
});
