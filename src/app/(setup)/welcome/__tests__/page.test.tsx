// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const redirectMock = vi.fn((url: string) => {
  // Mirrors the real redirect(), which throws NEXT_REDIRECT rather than
  // returning — a page that kept rendering after it would be a bug here too.
  throw new Error(`NEXT_REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({ redirect: (url: string) => redirectMock(url) }));

const mockAuth = vi.fn();
const mockCurrentUser = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({
  auth: () => mockAuth(),
  currentUser: () => mockCurrentUser(),
}));

const mockRead = vi.fn();
vi.mock("@/lib/billing/pending-signup", () => ({
  readPendingSignup: (...a: unknown[]) => mockRead(...a),
}));

// The plan is never rendered on the real form (the buyer's first sight of the
// price is the Stripe page), so surface it here — it is the value
// startSignupCheckout prices off, and the only thing this page decides.
vi.mock("../setup-form", () => ({
  SetupForm: ({ plan, initial }: { plan: string; initial: { firmName: string } }) => (
    <div data-testid="setup-form" data-plan={plan} data-firm-name={initial.firmName} />
  ),
}));

import WelcomePage from "../page";

async function visit(plan?: string | string[]) {
  return WelcomePage({
    searchParams: Promise.resolve(plan === undefined ? {} : { plan }),
  });
}

const SAVED_ANNUAL = {
  firmName: "Acme Wealth",
  advisorName: "Dana Reed",
  plan: "annual" as const,
  primaryColor: null,
  logoUrl: null,
  updatedAt: "2026-08-31T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ userId: "user_buyer", orgId: null });
  mockCurrentUser.mockResolvedValue({ firstName: "Dana", lastName: "Reed" });
  mockRead.mockResolvedValue(null);
});

describe("/welcome plan precedence", () => {
  it("charges the plan in the URL, not the one stashed on an earlier visit", async () => {
    // The reachable path: start annual → fill this form (stash records annual)
    // → balk at $1,788 on Stripe → back to the storefront → choose MONTHLY →
    // Start trial → /welcome?plan=monthly. If the stash wins, the buyer is
    // charged the annual price and no screen ever names it.
    mockRead.mockResolvedValue(SAVED_ANNUAL);
    render((await visit("monthly")) as React.ReactElement);
    expect(screen.getByTestId("setup-form")).toHaveAttribute("data-plan", "monthly");
  });

  it("keeps the stashed plan when the URL says nothing", async () => {
    // /select-organization's "Set up your firm" links to a bare /welcome, and a
    // returning monthly buyer must not be silently moved onto annual.
    mockRead.mockResolvedValue({ ...SAVED_ANNUAL, plan: "monthly" as const });
    render((await visit()) as React.ReactElement);
    expect(screen.getByTestId("setup-form")).toHaveAttribute("data-plan", "monthly");
  });

  it("defaults to annual when neither the URL nor the stash names a plan", async () => {
    render((await visit()) as React.ReactElement);
    expect(screen.getByTestId("setup-form")).toHaveAttribute("data-plan", "annual");
  });

  it("still restores the rest of the saved profile alongside the URL's plan", async () => {
    // Guards the fix's blast radius: only the PLAN's precedence changed.
    mockRead.mockResolvedValue(SAVED_ANNUAL);
    render((await visit("monthly")) as React.ReactElement);
    expect(screen.getByTestId("setup-form")).toHaveAttribute(
      "data-firm-name",
      "Acme Wealth",
    );
  });
});

describe("/welcome guards", () => {
  it("forwards the chosen plan through the sign-up bounce", async () => {
    // A monthly buyer sent to a plan-less /sign-up comes back defaulted to
    // annual and pays the wrong price.
    mockAuth.mockResolvedValue({ userId: null, orgId: null });
    await expect(visit("monthly")).rejects.toThrow("NEXT_REDIRECT:/sign-up?plan=monthly");
  });

  it("bounces a signed-out visitor to a bare /sign-up when no plan was chosen", async () => {
    mockAuth.mockResolvedValue({ userId: null, orgId: null });
    await expect(visit()).rejects.toThrow("NEXT_REDIRECT:/sign-up");
  });

  it("never shows the setup step to someone who already has a firm", async () => {
    mockAuth.mockResolvedValue({ userId: "user_buyer", orgId: "org_1" });
    await expect(visit("monthly")).rejects.toThrow("NEXT_REDIRECT:/home");
  });
});
