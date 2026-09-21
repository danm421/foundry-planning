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
vi.mock("@/lib/billing/billing-plan", () => ({ getFirmBillingPlan: vi.fn() }));
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

describe("the ?plan_changed=1 confirmation", () => {
  it("shows after Stripe confirms a billing-cycle change", async () => {
    withStaleFounderToken();
    render(
      await BillingSettingsPage({ searchParams: Promise.resolve({ plan_changed: "1" }) }),
    );
    expect(screen.getByRole("status")).not.toBeNull();
    expect(screen.getByText(/billing cycle updated/i)).not.toBeNull();
  });

  /**
   * Stripe schedules a downgrade that has a paid period left to run, so the
   * cycle on screen will not move for weeks or months. Saying "updated" here
   * is what sent the customer back to the button to try again.
   */
  it("says the change is scheduled when Stripe deferred it", async () => {
    withStaleFounderToken();
    render(
      await BillingSettingsPage({
        searchParams: Promise.resolve({ plan_changed: "scheduled" }),
      }),
    );
    expect(screen.getByRole("status")).not.toBeNull();
    expect(screen.getByText(/takes effect at the end of/i)).not.toBeNull();
    expect(screen.queryByText(/billing cycle updated/i)).toBeNull();
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
   * queue a second one on top of it.
   */
  it("reads as information, not failure, when a change is already pending", async () => {
    withStaleFounderToken();
    render(
      await BillingSettingsPage({
        searchParams: Promise.resolve({ billing_error: "plan_change_scheduled" }),
      }),
    );
    expect(screen.getByRole("status")).not.toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText(/already scheduled/i)).not.toBeNull();
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

  it("explains the pending change before offering to replace it", async () => {
    withStaleFounderToken();
    render(await BillingSettingsPage({ searchParams: Promise.resolve({
      billing_error: "trial_change_scheduled", plan: "monthly", schedule: "sub_sched_1",
    }) }));

    expect(screen.getByText(/if you leave Stripe without confirming/i)).not.toBeNull();
    const button = screen.getByRole("button", { name: /replace scheduled change/i });
    const form = button.closest("form")!;
    expect(form.getAttribute("method")).toBe("post");
    expect(form.getAttribute("action")).toBe("/api/billing/portal");
    const data = new FormData(form);
    expect(data.get("plan")).toBe("monthly");
    expect(data.get("replace_schedule")).toBe("sub_sched_1");
    expect(screen.getByRole("link", { name: /keep scheduled change/i }).getAttribute("href"))
      .toBe("/settings/billing");
  });

  it("offers no replacement for an invalid target plan", async () => {
    withStaleFounderToken();
    render(await BillingSettingsPage({ searchParams: Promise.resolve({
      billing_error: "trial_change_scheduled", plan: "weekly", schedule: "sub_sched_1",
    }) }));
    expect(screen.queryByRole("button", { name: /replace scheduled change/i })).toBeNull();
  });

  it("explains when a removed schedule still needs a replacement", async () => {
    withStaleFounderToken();
    render(await BillingSettingsPage({ searchParams: Promise.resolve({
      billing_error: "plan_change_incomplete",
    }) }));
    expect(screen.getByRole("alert").textContent).toMatch(/previous scheduled change was removed/i);
    expect(screen.queryByText(/nothing changed/i)).toBeNull();
  });
});
