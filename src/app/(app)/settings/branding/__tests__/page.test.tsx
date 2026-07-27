// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

const mockAuth = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({
  auth: () => mockAuth(),
}));

// BrandingContent does real DB/Clerk work; replace it with a marker that
// records exactly what the page decided to pass down, so these tests
// verify the page's gate in isolation.
vi.mock("../branding-content", () => ({
  BrandingContent: ({
    orgId,
    userId,
    isAdmin,
    advisorUserId,
  }: {
    orgId: string;
    userId: string;
    isAdmin: boolean;
    advisorUserId?: string;
  }) => (
    <div
      data-testid="branding-content"
      data-org={orgId}
      data-user={userId}
      data-admin={String(isAdmin)}
      data-advisor={advisorUserId ?? ""}
    />
  ),
}));

import BrandingSettingsPage from "../page";

async function renderPage(searchParams: Record<string, string | string[]>) {
  const ui = await BrandingSettingsPage({ searchParams: Promise.resolve(searchParams) });
  return render(ui);
}

describe("BrandingSettingsPage — admin-mode advisorUserId gate (security)", () => {
  it("ignores ?advisorUserId= for an org:member — BrandingContent never receives it", async () => {
    mockAuth.mockResolvedValue({
      orgId: "org_1",
      userId: "user_member",
      orgRole: "org:member",
    });
    const { container } = await renderPage({ advisorUserId: "user_target" });
    const node = container.querySelector("[data-testid='branding-content']");
    expect(node).toBeTruthy();
    expect(node?.getAttribute("data-admin")).toBe("false");
    expect(node?.getAttribute("data-advisor")).toBe("");
  });

  it("ignores ?advisorUserId= for a caller with no org role at all", async () => {
    mockAuth.mockResolvedValue({ orgId: "org_1", userId: "user_1", orgRole: null });
    const { container } = await renderPage({ advisorUserId: "user_target" });
    const node = container.querySelector("[data-testid='branding-content']");
    expect(node?.getAttribute("data-advisor")).toBe("");
  });

  it("honors ?advisorUserId= for an org:admin", async () => {
    mockAuth.mockResolvedValue({
      orgId: "org_1",
      userId: "user_admin",
      orgRole: "org:admin",
    });
    const { container } = await renderPage({ advisorUserId: "user_target" });
    const node = container.querySelector("[data-testid='branding-content']");
    expect(node?.getAttribute("data-admin")).toBe("true");
    expect(node?.getAttribute("data-advisor")).toBe("user_target");
  });

  it("renders the admin's own form (no advisorUserId) when the querystring is absent", async () => {
    mockAuth.mockResolvedValue({
      orgId: "org_1",
      userId: "user_admin",
      orgRole: "org:admin",
    });
    const { container } = await renderPage({});
    const node = container.querySelector("[data-testid='branding-content']");
    expect(node?.getAttribute("data-advisor")).toBe("");
  });

  it("treats a blank ?advisorUserId= as absent, even for an admin", async () => {
    mockAuth.mockResolvedValue({
      orgId: "org_1",
      userId: "user_admin",
      orgRole: "org:admin",
    });
    const { container } = await renderPage({ advisorUserId: "   " });
    const node = container.querySelector("[data-testid='branding-content']");
    expect(node?.getAttribute("data-advisor")).toBe("");
  });

  it("takes the first value when advisorUserId is repeated in the querystring", async () => {
    mockAuth.mockResolvedValue({
      orgId: "org_1",
      userId: "user_admin",
      orgRole: "org:admin",
    });
    const { container } = await renderPage({ advisorUserId: ["user_a", "user_b"] });
    const node = container.querySelector("[data-testid='branding-content']");
    expect(node?.getAttribute("data-advisor")).toBe("user_a");
  });

  it("does not render BrandingContent at all when signed out", async () => {
    mockAuth.mockResolvedValue({ orgId: null, userId: null, orgRole: null });
    const { container, getByText } = await renderPage({ advisorUserId: "user_target" });
    expect(container.querySelector("[data-testid='branding-content']")).toBeNull();
    expect(getByText("Sign in to manage branding.")).toBeInTheDocument();
  });
});
