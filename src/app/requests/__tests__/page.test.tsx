// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const redirectMock = vi.fn((url: string) => {
  // Mirrors the real redirect(), which throws NEXT_REDIRECT rather than
  // returning — a page that kept rendering after it would be a bug here too.
  throw new Error(`NEXT_REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({ redirect: (url: string) => redirectMock(url) }));

const authMock = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({ auth: () => authMock() }));

// The list fetches on mount; this page test is about the gate in front of it.
vi.mock("@/components/portal/access-request-list", () => ({
  default: () => <div data-testid="access-request-list" />,
}));

import PortalAccessRequestsPage from "../page";

beforeEach(() => {
  redirectMock.mockClear();
  authMock.mockReset();
  authMock.mockResolvedValue({ userId: "user_client", orgId: null });
});

// /requests lives OUTSIDE the (portal) route group, so no layout gate stands in
// front of it — and none should: a Next 16 layout is not an auth gate. These
// three lines ARE the whole authorization decision for this screen, and the
// proxy deliberately passes an advisor through expecting the page to make it.
describe("/requests page gate", () => {
  it("sends an ADVISOR session to /clients", async () => {
    // An active Clerk org means an advisor. The proxy cannot turn them away
    // (see proxy-portal.test.ts) because /requests must not start with /portal.
    authMock.mockResolvedValue({ userId: "user_advisor", orgId: "org_advisor" });
    await expect(PortalAccessRequestsPage()).rejects.toThrow("NEXT_REDIRECT:/clients");
    expect(redirectMock).toHaveBeenCalledWith("/clients");
  });

  it("sends a signed-OUT visitor to /sign-in", async () => {
    // Defence in depth — the proxy has already run auth.protect() — but the
    // page must never render an access request to an anonymous visitor.
    authMock.mockResolvedValue({ userId: null, orgId: null });
    await expect(PortalAccessRequestsPage()).rejects.toThrow("NEXT_REDIRECT:/sign-in");
  });

  it("renders the requests for a signed-in person with no org", async () => {
    // The population this screen exists for: a real login, no advisor org, and
    // possibly no binding anywhere yet.
    render(await PortalAccessRequestsPage());
    expect(screen.getByTestId("access-request-list")).toBeTruthy();
    expect(redirectMock).not.toHaveBeenCalled();
  });
});
