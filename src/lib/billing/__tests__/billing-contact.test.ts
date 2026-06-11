import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetOrganization = vi.fn();
const mockGetMembershipList = vi.fn();
const mockGetUser = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: async () => ({
    organizations: {
      getOrganization: (...a: unknown[]) => mockGetOrganization(...a),
      getOrganizationMembershipList: (...a: unknown[]) => mockGetMembershipList(...a),
    },
    users: { getUser: (...a: unknown[]) => mockGetUser(...a) },
  }),
}));

import { resolveBillingContact } from "../billing-contact";

const org = (meta: Record<string, unknown>) => ({ publicMetadata: meta });
const member = (userId: string, role: string, createdAt: number, identifier?: string) => ({
  role,
  createdAt,
  publicUserData: { userId, identifier },
});

beforeEach(() => {
  mockGetOrganization.mockReset();
  mockGetMembershipList.mockReset();
  mockGetUser.mockReset();
});

describe("resolveBillingContact", () => {
  it("returns the pinned contact when it is still a member", async () => {
    mockGetOrganization.mockResolvedValue(org({ billing_contact_userId: "u_pin" }));
    mockGetMembershipList.mockResolvedValue({
      data: [member("u_admin", "org:admin", 1, "a@x.com"), member("u_pin", "org:member", 2, "pin@x.com")],
    });
    expect(await resolveBillingContact("org_1")).toEqual({ userId: "u_pin", email: "pin@x.com" });
  });

  it("falls back to the org:owner member (transitional) when no pin", async () => {
    mockGetOrganization.mockResolvedValue(org({}));
    mockGetMembershipList.mockResolvedValue({
      data: [member("u_admin", "org:admin", 2, "a@x.com"), member("u_owner", "org:owner", 1, "o@x.com")],
    });
    expect(await resolveBillingContact("org_1")).toEqual({ userId: "u_owner", email: "o@x.com" });
  });

  it("falls back to the earliest-joined admin when no pin and no owner", async () => {
    mockGetOrganization.mockResolvedValue(org({}));
    mockGetMembershipList.mockResolvedValue({
      data: [member("u_late", "org:admin", 5, "late@x.com"), member("u_early", "org:admin", 1, "early@x.com")],
    });
    expect(await resolveBillingContact("org_1")).toEqual({ userId: "u_early", email: "early@x.com" });
  });

  it("ignores a stale pin (user no longer a member) and falls through", async () => {
    mockGetOrganization.mockResolvedValue(org({ billing_contact_userId: "u_gone" }));
    mockGetMembershipList.mockResolvedValue({ data: [member("u_admin", "org:admin", 1, "a@x.com")] });
    expect(await resolveBillingContact("org_1")).toEqual({ userId: "u_admin", email: "a@x.com" });
  });

  it("looks up email via getUser when identifier is missing", async () => {
    mockGetOrganization.mockResolvedValue(org({ billing_contact_userId: "u_pin" }));
    mockGetMembershipList.mockResolvedValue({ data: [member("u_pin", "org:admin", 1, undefined)] });
    mockGetUser.mockResolvedValue({ emailAddresses: [{ emailAddress: "looked-up@x.com" }] });
    expect(await resolveBillingContact("org_1")).toEqual({ userId: "u_pin", email: "looked-up@x.com" });
  });

  it("returns null for an empty org", async () => {
    mockGetOrganization.mockResolvedValue(org({}));
    mockGetMembershipList.mockResolvedValue({ data: [] });
    expect(await resolveBillingContact("org_1")).toBeNull();
  });
});
