// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const authMock = vi.fn();
const getOrganizationMembershipList = vi.fn();
const getOrganizationInvitationList = vi.fn();

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => authMock(),
  clerkClient: async () => ({
    users: { getOrganizationMembershipList, getOrganizationInvitationList },
  }),
}));
vi.mock("@clerk/nextjs", () => ({
  OrganizationList: () => <div data-testid="org-picker" />,
}));

import SelectOrganizationPage from "../page";

function withClerk({
  memberships,
  invitations = 0,
}: {
  memberships: number;
  invitations?: number;
}) {
  authMock.mockResolvedValue({ userId: "user_1" });
  getOrganizationMembershipList.mockResolvedValue({ totalCount: memberships });
  getOrganizationInvitationList.mockResolvedValue({ totalCount: invitations });
}

describe("/select-organization", () => {
  beforeEach(() => vi.clearAllMocks());

  it("offers a trial instead of a form that cannot succeed, when the user belongs to no firm", async () => {
    // Clerk org creation is disabled instance-wide, so the picker's "create
    // organization" form always errors with "not enabled for this user".
    //
    // The href is /welcome, not a fresh checkout link: a buyer who abandoned
    // at the card still has their profile and logo stashed, and /welcome
    // prefills both rather than starting them over.
    withClerk({ memberships: 0 });
    render(await SelectOrganizationPage());

    expect(screen.queryByTestId("org-picker")).not.toBeInTheDocument();
    const cta = screen.getByRole("link", { name: /set up your firm/i });
    expect(cta).toHaveAttribute("href", "/welcome");
  });

  it("tells the firmless visitor how to get in via their firm, or reach support", async () => {
    withClerk({ memberships: 0 });
    render(await SelectOrganizationPage());
    expect(screen.getByText(/invite/i)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /support@foundryplanning\.com/i }),
    ).toBeInTheDocument();
  });

  it("shows the picker to someone who already belongs to a firm", async () => {
    withClerk({ memberships: 1 });
    render(await SelectOrganizationPage());
    expect(screen.getByTestId("org-picker")).toBeInTheDocument();
  });

  it("shows the picker to someone holding a pending invitation, so they can accept it", async () => {
    // Zero memberships but an open invite: sending them to checkout would make
    // them buy a second seat for a firm that already invited them.
    withClerk({ memberships: 0, invitations: 1 });
    render(await SelectOrganizationPage());
    expect(screen.getByTestId("org-picker")).toBeInTheDocument();
  });

  it("counts only pending invitations, so a revoked one can't strand the user", async () => {
    withClerk({ memberships: 0 });
    await SelectOrganizationPage();
    expect(getOrganizationInvitationList).toHaveBeenCalledWith({
      userId: "user_1",
      status: "pending",
    });
  });

  it("falls back to the picker if Clerk cannot be reached", async () => {
    // Never strand a real member on a "buy a seat" page because of a lookup blip.
    vi.spyOn(console, "error").mockImplementation(() => {});
    authMock.mockResolvedValue({ userId: "user_1" });
    getOrganizationMembershipList.mockRejectedValue(new Error("clerk down"));
    getOrganizationInvitationList.mockResolvedValue({ totalCount: 0 });
    render(await SelectOrganizationPage());
    expect(screen.getByTestId("org-picker")).toBeInTheDocument();
  });
});
