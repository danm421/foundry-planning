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
vi.mock("@/lib/billing/plan-switch", () => ({ readPlanSwitchState: vi.fn() }));
vi.mock("@/db", () => ({ db: { select: vi.fn() } }));
vi.mock("../actions", () => ({
  startResubscribeCheckout: vi.fn(),
  confirmPlanSwitchAction: vi.fn(),
  cancelPlanSwitchAction: vi.fn(),
}));

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

/**
 * The portal route answers a native form POST, so every refusal it returns is
 * a page the customer lands on. Before this, they landed on the raw JSON body
 * — `{"error":"portal_unavailable"}` on a blank white page.
 */
describe("the ?billing_error= explanation", () => {
  it("explains a switch that Stripe would not open", async () => {
    withStaleFounderToken();
    render(
      await BillingSettingsPage({
        searchParams: Promise.resolve({ billing_error: "portal_unavailable" }),
      }),
    );
    expect(screen.getByRole("alert")).not.toBeNull();
    expect(screen.getByText(/couldn.t open Stripe/i)).not.toBeNull();
  });

  /**
   * Not an error and deliberately not styled as one: the change the customer
   * asked for is already coming, and the only thing wrong is that they cannot
   * queue a second one on top of it. They can cancel it themselves on the
   * billing page — "contact support" was our policy, never Stripe's.
   */
  it("reads as information, not failure, when a change is already pending", async () => {
    withStaleFounderToken();
    render(
      await BillingSettingsPage({
        searchParams: Promise.resolve({ billing_error: "plan_change_pending_exists" }),
      }),
    );
    expect(screen.getByRole("status")).not.toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText(/already have a change scheduled/i)).not.toBeNull();
  });

  it("says nothing was altered when a cancellation fails", async () => {
    withStaleFounderToken();
    render(
      await BillingSettingsPage({
        searchParams: Promise.resolve({ billing_error: "cancel_failed" }),
      }),
    );
    expect(screen.getByRole("alert").textContent).toMatch(/nothing was altered/i);
  });

  it.each(["<script>", "constructor", "toString", "__proto__"])("ignores an unknown code: %s", async (code) => {
    withStaleFounderToken();
    render(
      await BillingSettingsPage({
        searchParams: Promise.resolve({ billing_error: code }),
      }),
    );
    // Anchored on something that DID render, so an empty tree cannot pass.
    expect(screen.getByText(/Founder Plan/i)).not.toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

});
