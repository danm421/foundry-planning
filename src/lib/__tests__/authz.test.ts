import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAuth = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({
  auth: () => mockAuth(),
}));

import {
  requireOrgOwner,
  requireOrgAdminOrOwner,
  requireActiveSubscription,
  ForbiddenError,
} from "@/lib/authz";
import { UnauthorizedError } from "@/lib/db-helpers";

beforeEach(() => {
  mockAuth.mockReset();
});

describe("requireOrgOwner", () => {
  it("throws UnauthorizedError when no userId", async () => {
    mockAuth.mockResolvedValue({ userId: null, orgRole: null });
    await expect(requireOrgOwner()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("throws ForbiddenError for org:admin", async () => {
    mockAuth.mockResolvedValue({ userId: "u1", orgRole: "org:admin" });
    await expect(requireOrgOwner()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws ForbiddenError for org:member", async () => {
    mockAuth.mockResolvedValue({ userId: "u1", orgRole: "org:member" });
    await expect(requireOrgOwner()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("passes for org:owner", async () => {
    mockAuth.mockResolvedValue({ userId: "u1", orgRole: "org:owner" });
    await expect(requireOrgOwner()).resolves.toBeUndefined();
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

  it("passes for org:owner", async () => {
    mockAuth.mockResolvedValue({ userId: "u1", orgRole: "org:owner" });
    await expect(requireOrgAdminOrOwner()).resolves.toBeUndefined();
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

  it("passes for subscription_status=past_due (dunning window mutations allowed)", async () => {
    mockAuth.mockResolvedValue({
      userId: "u1",
      sessionClaims: {
        org_public_metadata: { subscription_status: "past_due" },
      },
    });
    await expect(requireActiveSubscription()).resolves.toBeUndefined();
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
