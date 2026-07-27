// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

const mockGetBranding = vi.fn();
const mockGetAdvisorProfile = vi.fn();
const mockListAdvisorProfiles = vi.fn();
const mockListFirmMembers = vi.fn();

vi.mock("@/lib/branding/db", () => ({
  getBranding: (...a: unknown[]) => mockGetBranding(...a),
}));
vi.mock("@/lib/branding/advisor-profile", () => ({
  getAdvisorProfile: (...a: unknown[]) => mockGetAdvisorProfile(...a),
  listAdvisorProfiles: (...a: unknown[]) => mockListAdvisorProfiles(...a),
}));
vi.mock("@/lib/crm-tasks/members", () => ({
  listFirmMembers: (...a: unknown[]) => mockListFirmMembers(...a),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));
vi.mock("../branding-form", () => ({
  default: () => <div data-testid="firm-branding-form" />,
}));
vi.mock("../advisor-brand-form", () => ({
  default: ({
    canEdit,
    brandingEnabled,
    advisorUserId,
    subjectName,
  }: {
    canEdit: boolean;
    brandingEnabled: boolean;
    advisorUserId?: string;
    subjectName?: string;
  }) => (
    <div
      data-testid="advisor-brand-form"
      data-can-edit={String(canEdit)}
      data-branding-enabled={String(brandingEnabled)}
      data-advisor-user-id={advisorUserId ?? ""}
      data-subject-name={subjectName ?? ""}
    />
  ),
}));
vi.mock("../advisor-grant-list", () => ({
  default: ({ rows }: { rows: Array<{ userId: string; brandingEnabled: boolean }> }) => (
    <div data-testid="advisor-grant-list" data-rows={JSON.stringify(rows)} />
  ),
}));

import { BrandingContent } from "../branding-content";

const MEMBERS = [
  { userId: "user_self", displayName: "Self Admin", email: "self@x.com", imageUrl: null, role: "Admin" },
  { userId: "user_other", displayName: "Other Advisor", email: "other@x.com", imageUrl: null, role: "Member" },
  { userId: "user_no_profile", displayName: "No Profile Yet", email: "np@x.com", imageUrl: null, role: "Member" },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockGetBranding.mockResolvedValue(null);
  mockGetAdvisorProfile.mockResolvedValue(null);
  mockListAdvisorProfiles.mockResolvedValue([
    { advisorUserId: "user_other", brandingEnabled: true },
  ]);
  mockListFirmMembers.mockResolvedValue(MEMBERS);
});

describe("BrandingContent — member (non-admin) view", () => {
  it("renders the member's own form, never the admin single-advisor view, even when advisorUserId is (incorrectly) supplied", async () => {
    // Belt-and-suspenders: BrandingContent must not honor advisorUserId
    // unless isAdmin is also true, regardless of what page.tsx intended.
    const ui = await BrandingContent({
      orgId: "org_1",
      userId: "user_self",
      isAdmin: false,
      advisorUserId: "user_other",
    });
    const { container } = render(ui);

    // Only the caller's own profile was ever read — never the target's.
    expect(mockGetAdvisorProfile).toHaveBeenCalledTimes(1);
    expect(mockGetAdvisorProfile).toHaveBeenCalledWith("org_1", "user_self");
    expect(mockGetAdvisorProfile).not.toHaveBeenCalledWith("org_1", "user_other");
    // Admin-only lookups don't run at all for a non-admin caller.
    expect(mockListFirmMembers).not.toHaveBeenCalled();
    expect(mockListAdvisorProfiles).not.toHaveBeenCalled();

    const form = container.querySelector("[data-testid='advisor-brand-form']");
    expect(form).toBeTruthy();
    expect(form?.getAttribute("data-advisor-user-id")).toBe("");
    expect(form?.getAttribute("data-subject-name")).toBe("");
    expect(container.querySelector("[data-testid='advisor-grant-list']")).toBeNull();
    expect(container.querySelector("[data-testid='firm-branding-form']")).toBeNull();
  });
});

describe("BrandingContent — admin, own view (no advisorUserId)", () => {
  it("renders the firm form, the admin's own brand form, and a grant list excluding the caller", async () => {
    const ui = await BrandingContent({
      orgId: "org_1",
      userId: "user_self",
      isAdmin: true,
    });
    const { container } = render(ui);

    expect(container.querySelector("[data-testid='firm-branding-form']")).toBeTruthy();

    const grantList = container.querySelector("[data-testid='advisor-grant-list']");
    expect(grantList).toBeTruthy();
    const rows = JSON.parse(grantList!.getAttribute("data-rows") ?? "[]");
    const ids = rows.map((r: { userId: string }) => r.userId);
    expect(ids).not.toContain("user_self");
    expect(ids).toEqual(["user_other", "user_no_profile"]);

    // The advisor with no advisor_profiles row yet must render as OFF, not
    // be omitted from the list.
    const noProfileRow = rows.find((r: { userId: string }) => r.userId === "user_no_profile");
    expect(noProfileRow.brandingEnabled).toBe(false);
    const grantedRow = rows.find((r: { userId: string }) => r.userId === "user_other");
    expect(grantedRow.brandingEnabled).toBe(true);
  });
});

describe("BrandingContent — admin editing another advisor via advisorUserId", () => {
  it("reads the target's profile directly, sets canEdit true regardless of the target's grant, and passes third-person copy props", async () => {
    mockGetAdvisorProfile.mockResolvedValue({
      brandingEnabled: false,
      brandName: "Acme Advisor Co",
      logoUrl: null,
      faviconUrl: null,
      primaryColor: null,
      contactEmail: null,
      contactPhone: null,
      website: null,
      address: null,
      emailFromName: null,
      emailReplyTo: null,
    });

    const ui = await BrandingContent({
      orgId: "org_1",
      userId: "user_self",
      isAdmin: true,
      advisorUserId: "user_other",
    });
    const { container, getByText } = render(ui);

    expect(mockGetAdvisorProfile).toHaveBeenCalledWith("org_1", "user_other");

    const form = container.querySelector("[data-testid='advisor-brand-form']");
    expect(form?.getAttribute("data-advisor-user-id")).toBe("user_other");
    expect(form?.getAttribute("data-subject-name")).toBe("Other Advisor");
    // canEdit is true even though this target's own brandingEnabled is false —
    // an admin may always edit another advisor's brand.
    expect(form?.getAttribute("data-can-edit")).toBe("true");
    expect(form?.getAttribute("data-branding-enabled")).toBe("false");

    expect(getByText("Other Advisor's brand")).toBeInTheDocument();
    expect(getByText(/Back to advisor list/)).toBeInTheDocument();
    // Neither the firm form nor the grant list render in this single-advisor view.
    expect(container.querySelector("[data-testid='firm-branding-form']")).toBeNull();
    expect(container.querySelector("[data-testid='advisor-grant-list']")).toBeNull();
  });
});
