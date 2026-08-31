// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const redirectMock = vi.fn((url: string) => {
  // Mirrors the real redirect(), which throws NEXT_REDIRECT rather than
  // returning — so a page that keeps rendering after it would be a bug here too.
  throw new Error(`NEXT_REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({ redirect: (url: string) => redirectMock(url) }));
vi.mock("@clerk/nextjs", () => ({
  SignUp: () => <div data-testid="clerk-sign-up" />,
}));
vi.mock("@clerk/themes", () => ({ dark: {} }));

import SignUpPage from "../[[...sign-up]]/page";

type Query = Record<string, string | string[] | undefined>;

async function visit(query: Query, segments?: string[]) {
  return SignUpPage({
    searchParams: Promise.resolve(query),
    params: Promise.resolve({ "sign-up": segments }),
  });
}

async function redirectTargetFor(query: Query): Promise<string> {
  await expect(visit(query)).rejects.toThrow(/NEXT_REDIRECT/);
  return redirectMock.mock.calls.at(-1)![0];
}

describe("/sign-up", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sends a visitor with no invitation to checkout instead of minting an orphan account", async () => {
    // A bare Clerk account has no firm and no subscription, and org creation is
    // disabled — it dead-ends at /select-organization. Checkout is the way in.
    expect(await redirectTargetFor({})).toBe("/api/checkout/start?plan=annual");
  });

  it("defaults to the annual plan, matching the price the storefront shows", async () => {
    expect(await redirectTargetFor({ plan: "annual" })).toBe(
      "/api/checkout/start?plan=annual",
    );
  });

  it("carries a monthly choice through to checkout", async () => {
    expect(await redirectTargetFor({ plan: "monthly" })).toBe(
      "/api/checkout/start?plan=monthly",
    );
  });

  it("ignores an unrecognized plan rather than forwarding it", async () => {
    expect(await redirectTargetFor({ plan: "lifetime" })).toBe(
      "/api/checkout/start?plan=annual",
    );
  });

  it("still shows the sign-up form to someone holding a Clerk invitation ticket", async () => {
    // Portal-client invites and the firm-admin invite the Stripe webhook sends
    // both land here as `${APP_URL}/sign-up?__clerk_ticket=…`. Redirecting them
    // to checkout would make every invitation in the product unredeemable.
    render(await visit({ __clerk_ticket: "tkt_abc" }));
    expect(redirectMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("clerk-sign-up")).toBeInTheDocument();
  });

  it("shows the form for any Clerk hand-off param, not just the ticket", async () => {
    render(await visit({ __clerk_status: "sign_up" }));
    expect(redirectMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("clerk-sign-up")).toBeInTheDocument();
  });

  it.each([["verify-email-address"], ["continue"], ["sso-callback"]])(
    "keeps rendering the form at /sign-up/%s, mid-flow",
    async (step) => {
      // Clerk walks its own sign-up through child segments of this catch-all,
      // and carries no query params doing it. Bouncing those steps to checkout
      // would strand every invited user halfway through creating their account.
      render(await visit({}, [step]));
      expect(redirectMock).not.toHaveBeenCalled();
      expect(screen.getByTestId("clerk-sign-up")).toBeInTheDocument();
    },
  );
});
