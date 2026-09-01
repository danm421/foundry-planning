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
  SignUp: ({
    forceRedirectUrl,
    signInUrl,
  }: {
    forceRedirectUrl?: string;
    signInUrl?: string;
  }) => (
    <div
      data-testid="clerk-sign-up"
      data-force-redirect={forceRedirectUrl}
      data-sign-in-url={signInUrl}
    />
  ),
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

describe("/sign-up", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows a visitor the account form — the account now comes first", async () => {
    const el = await visit({});
    render(el as React.ReactElement);
    expect(screen.getByTestId("clerk-sign-up")).toBeInTheDocument();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("points 'Already have an account?' at /sign-in for every visitor, invited ones included", async () => {
    const el = await visit({});
    render(el as React.ReactElement);
    expect(screen.getByTestId("clerk-sign-up")).toHaveAttribute(
      "data-sign-in-url",
      "/sign-in",
    );
  });

  it("sends a visitor on to the setup step after they sign up", async () => {
    const el = await visit({});
    render(el as React.ReactElement);
    expect(screen.getByTestId("clerk-sign-up")).toHaveAttribute(
      "data-force-redirect",
      "/welcome?plan=annual",
    );
  });

  it("carries the plan the storefront chose", async () => {
    const el = await visit({ plan: "monthly" });
    render(el as React.ReactElement);
    expect(screen.getByTestId("clerk-sign-up")).toHaveAttribute(
      "data-force-redirect",
      "/welcome?plan=monthly",
    );
  });

  it("does NOT force-redirect an invited user — they belong to a firm already", async () => {
    // A portal client or a sales-path firm admin arrives with a Clerk ticket.
    // Forcing them to /welcome would drop them into a signup they aren't in.
    const el = await visit({ __clerk_ticket: "tkt_1" });
    render(el as React.ReactElement);
    expect(screen.getByTestId("clerk-sign-up")).not.toHaveAttribute("data-force-redirect");
  });

  it("does NOT force-redirect for any Clerk hand-off param, not just the ticket", async () => {
    // isClerkFlow matches the whole __clerk_ prefix, not one literal key — a
    // narrower check would let a __clerk_status/__clerk_handshake hand-off
    // through to /welcome and strand an invited user in a signup they aren't in.
    const el = await visit({ __clerk_status: "sign_up" });
    render(el as React.ReactElement);
    expect(screen.getByTestId("clerk-sign-up")).not.toHaveAttribute("data-force-redirect");
  });

  it("promises the trial only to the buyer who is actually starting one", async () => {
    const el = await visit({ plan: "monthly" });
    render(el as React.ReactElement);
    expect(screen.getByText(/14-day free trial/i)).toBeInTheDocument();
  });

  it("does not tell an invited portal client they are starting a trial", async () => {
    // An advisor's client arrives on a ticket to read their plan. They are
    // buying nothing and have nothing to cancel; the trial line is simply untrue
    // for them, and it is the first thing under the heading.
    const el = await visit({ __clerk_ticket: "tkt_1" });
    render(el as React.ReactElement);
    expect(screen.queryByText(/14-day free trial/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/cancel anytime/i)).not.toBeInTheDocument();
  });

  it("does NOT force-redirect inside a Clerk child step", async () => {
    // An invited user's ticket is gone from the URL by the time Clerk has
    // walked them into a child step, so a bare segment must keep deferring to
    // Clerk's own destination — forcing THEM to /welcome is the worse failure.
    const el = await visit({}, ["verify-email-address"]);
    render(el as React.ReactElement);
    expect(screen.getByTestId("clerk-sign-up")).not.toHaveAttribute("data-force-redirect");
  });

  it("keeps sending the buyer to /welcome when a child step still names their plan", async () => {
    // The other half of the same call. A child step that still carries `?plan=`
    // could only have come from the storefront — no invitation link sets it —
    // so dropping the destination there sends a paying buyer to /clients, out
    // through the org picker's "not linked to a firm" screen, and back round.
    const el = await visit({ plan: "monthly" }, ["verify-email-address"]);
    render(el as React.ReactElement);
    expect(screen.getByTestId("clerk-sign-up")).toHaveAttribute(
      "data-force-redirect",
      "/welcome?plan=monthly",
    );
  });

  it("still defers to Clerk for a ticketed user, plan in the URL or not", async () => {
    const el = await visit({ __clerk_ticket: "tkt_1", plan: "monthly" }, ["verify-email-address"]);
    render(el as React.ReactElement);
    expect(screen.getByTestId("clerk-sign-up")).not.toHaveAttribute("data-force-redirect");
  });
});
