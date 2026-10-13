// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const mockAuth = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({
  auth: () => mockAuth(),
}));
vi.mock("@clerk/nextjs", () => ({
  OrganizationProfile: () => <div data-testid="organization-profile" />,
}));

import TeamSettingsPage from "../page";

async function renderPage() {
  return render(await TeamSettingsPage());
}

describe("TeamSettingsPage", () => {
  it("renders Clerk's team management for the member themselves", async () => {
    mockAuth.mockResolvedValue({ userId: "user_adv", orgId: "org_1", orgRole: "org:admin", actor: null });
    await renderPage();
    expect(screen.queryByTestId("organization-profile")).not.toBeNull();
  });

  it("shows a read-only note instead while an operator is signed in as the member", async () => {
    mockAuth.mockResolvedValue({
      userId: "user_adv",
      orgId: "org_1",
      orgRole: "org:admin",
      actor: { sub: "user_op" },
    });
    await renderPage();
    expect(screen.queryByTestId("organization-profile")).toBeNull();
    expect(screen.getByText(/team management is turned off/i)).not.toBeNull();
  });
});
