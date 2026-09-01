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
  SignUp: ({ forceRedirectUrl }: { forceRedirectUrl?: string }) => (
    <div data-testid="clerk-sign-up" data-force-redirect={forceRedirectUrl} />
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

  it("does NOT force-redirect inside a Clerk child step", async () => {
    const el = await visit({}, ["verify-email-address"]);
    render(el as React.ReactElement);
    expect(screen.getByTestId("clerk-sign-up")).not.toHaveAttribute("data-force-redirect");
  });
});
