import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAuth = vi.fn();
const mockGetOrganization = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({
  auth: () => mockAuth(),
  clerkClient: () => Promise.resolve({ organizations: { getOrganization: (...a: unknown[]) => mockGetOrganization(...a) } }),
}));

const mockIsBillingContact = vi.fn();
vi.mock("@/lib/billing/billing-contact", () => ({
  currentUserIsBillingContact: () => mockIsBillingContact(),
}));

import {
  requireBillingContact,
  requireOrgAdminOrOwner,
  requireActiveSubscription,
  requireActiveSubscriptionForFirm,
  ForbiddenError,
} from "@/lib/authz";
import { UnauthorizedError } from "@/lib/db-helpers";

beforeEach(() => {
  mockAuth.mockReset();
  mockIsBillingContact.mockReset();
  mockGetOrganization.mockReset();
});

describe("requireBillingContact", () => {
  it("throws UnauthorizedError without a session", async () => {
    mockAuth.mockResolvedValue({ userId: null });
    await expect(requireBillingContact()).rejects.toBeInstanceOf(UnauthorizedError);
  });
  it("throws ForbiddenError when the user is not the billing contact", async () => {
    mockAuth.mockResolvedValue({ userId: "u1" });
    mockIsBillingContact.mockResolvedValue(false);
    await expect(requireBillingContact()).rejects.toBeInstanceOf(ForbiddenError);
  });
  it("passes when the user is the billing contact", async () => {
    mockAuth.mockResolvedValue({ userId: "u1" });
    mockIsBillingContact.mockResolvedValue(true);
    await expect(requireBillingContact()).resolves.toBeUndefined();
  });
});

describe("requireOrgAdminOrOwner", () => {
  it("throws UnauthorizedError when no userId", async () => {
    mockAuth.mockResolvedValue({ userId: null, orgRole: null });
    await expect(requireOrgAdminOrOwner()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("throws ForbiddenError for org:member", async () => {
    mockAuth.mockResolvedValue({ userId: "u1", orgRole: "org:member" });
    await expect(requireOrgAdminOrOwner()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("passes for org:admin", async () => {
    mockAuth.mockResolvedValue({ userId: "u1", orgRole: "org:admin" });
    await expect(requireOrgAdminOrOwner()).resolves.toBeUndefined();
  });

  it("throws ForbiddenError for org:owner (role retired)", async () => {
    mockAuth.mockResolvedValue({ userId: "u1", orgRole: "org:owner" });
    await expect(requireOrgAdminOrOwner()).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("requireActiveSubscription", () => {
  it("throws UnauthorizedError when no userId", async () => {
    mockAuth.mockResolvedValue({
      userId: null,
      sessionClaims: {},
    });
    await expect(requireActiveSubscription()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("passes for is_founder=true regardless of status", async () => {
    mockAuth.mockResolvedValue({
      userId: "u1",
      sessionClaims: {
        org_public_metadata: { is_founder: true, subscription_status: "canceled" },
      },
    });
    await expect(requireActiveSubscription()).resolves.toBeUndefined();
  });

  it("passes for subscription_status=trialing", async () => {
    mockAuth.mockResolvedValue({
      userId: "u1",
      sessionClaims: {
        org_public_metadata: { subscription_status: "trialing" },
      },
    });
    await expect(requireActiveSubscription()).resolves.toBeUndefined();
  });

  it("passes for subscription_status=active", async () => {
    mockAuth.mockResolvedValue({
      userId: "u1",
      sessionClaims: {
        org_public_metadata: { subscription_status: "active" },
      },
    });
    await expect(requireActiveSubscription()).resolves.toBeUndefined();
  });

  it("passes for subscription_status=past_due with no current_period_end (dunning window mutations allowed)", async () => {
    mockAuth.mockResolvedValue({
      userId: "u1",
      sessionClaims: {
        org_public_metadata: { subscription_status: "past_due" },
      },
    });
    await expect(requireActiveSubscription()).resolves.toBeUndefined();
  });

  it("passes for past_due within the 14-day grace window", async () => {
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    mockAuth.mockResolvedValue({
      userId: "u1",
      sessionClaims: {
        org_public_metadata: {
          subscription_status: "past_due",
          current_period_end: fiveDaysAgo,
        },
      },
    });
    await expect(requireActiveSubscription()).resolves.toBeUndefined();
  });

  it("throws ForbiddenError for past_due beyond the 14-day grace window (aligned with decideAccess)", async () => {
    const twentyDaysAgo = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
    mockAuth.mockResolvedValue({
      userId: "u1",
      sessionClaims: {
        org_public_metadata: {
          subscription_status: "past_due",
          current_period_end: twentyDaysAgo,
        },
      },
    });
    await expect(requireActiveSubscription()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws ForbiddenError for subscription_status=canceled", async () => {
    mockAuth.mockResolvedValue({
      userId: "u1",
      sessionClaims: {
        org_public_metadata: { subscription_status: "canceled" },
      },
    });
    await expect(requireActiveSubscription()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws ForbiddenError when subscription_status is missing", async () => {
    mockAuth.mockResolvedValue({
      userId: "u1",
      sessionClaims: { org_public_metadata: {} },
    });
    await expect(requireActiveSubscription()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws ForbiddenError when org_public_metadata is missing", async () => {
    mockAuth.mockResolvedValue({
      userId: "u1",
      sessionClaims: {},
    });
    await expect(requireActiveSubscription()).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("requireActiveSubscriptionForFirm", () => {
  it("own org active via session claims passes without calling getOrganization", async () => {
    mockAuth.mockResolvedValue({
      userId: "u1",
      orgId: "org_a",
      sessionClaims: { org_public_metadata: { subscription_status: "active" } },
    });
    await expect(requireActiveSubscriptionForFirm("org_a")).resolves.toBeUndefined();
    expect(mockGetOrganization).not.toHaveBeenCalled();
  });

  it("different (owning) firm active via Clerk passes and calls getOrganization", async () => {
    mockAuth.mockResolvedValue({
      userId: "u1",
      orgId: "org_b",
      sessionClaims: { org_public_metadata: { subscription_status: "canceled" } },
    });
    mockGetOrganization.mockResolvedValue({ publicMetadata: { subscription_status: "active" } });
    await expect(requireActiveSubscriptionForFirm("org_a")).resolves.toBeUndefined();
    expect(mockGetOrganization).toHaveBeenCalledWith({ organizationId: "org_a" });
  });

  it("lapsed owning firm throws ForbiddenError", async () => {
    mockAuth.mockResolvedValue({
      userId: "u1",
      orgId: "org_b",
      sessionClaims: {},
    });
    mockGetOrganization.mockResolvedValue({ publicMetadata: { subscription_status: "canceled" } });
    await expect(requireActiveSubscriptionForFirm("org_a")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("founder bypass — own path (is_founder=true in session claims)", async () => {
    mockAuth.mockResolvedValue({
      userId: "u1",
      orgId: "org_a",
      sessionClaims: { org_public_metadata: { is_founder: true } },
    });
    await expect(requireActiveSubscriptionForFirm("org_a")).resolves.toBeUndefined();
    expect(mockGetOrganization).not.toHaveBeenCalled();
  });

  it("founder bypass — cross-firm path (is_founder=true in Clerk org metadata)", async () => {
    mockAuth.mockResolvedValue({
      userId: "u1",
      orgId: "org_b",
      sessionClaims: {},
    });
    mockGetOrganization.mockResolvedValue({ publicMetadata: { is_founder: true } });
    await expect(requireActiveSubscriptionForFirm("org_a")).resolves.toBeUndefined();
  });

  it("no userId throws UnauthorizedError", async () => {
    mockAuth.mockResolvedValue({ userId: null });
    await expect(requireActiveSubscriptionForFirm("org_a")).rejects.toBeInstanceOf(UnauthorizedError);
  });
});
