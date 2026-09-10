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

// `requireClientPortalAccess` reaches the household through
// `getPortalClientRef`, which now reads `portal_bindings` + the active-household
// cookie. Mock the two data sources it consults (plus the entitlement override
// lookup the gate finishes with) so the gate's own decision is what's measured.
const mockListBindingsForUser = vi.fn();
vi.mock("@/lib/portal/bindings", () => ({
  listBindingsForUser: (...a: unknown[]) => mockListBindingsForUser(...a),
}));

const mockLegacyPortalClientRef = vi.fn();
vi.mock("@/lib/portal/legacy-binding", () => ({
  legacyPortalClientRef: (...a: unknown[]) => mockLegacyPortalClientRef(...a),
}));

const mockCookies = vi.fn();
vi.mock("next/headers", () => ({ cookies: () => mockCookies() }));

const mockGetActiveUserOverrides = vi.fn();
vi.mock("@/lib/entitlements/user-overrides", () => ({
  getActiveUserOverrides: (...a: unknown[]) => mockGetActiveUserOverrides(...a),
}));

import {
  requireBillingContact,
  requireOrgAdminOrOwner,
  requireActiveSubscription,
  requireActiveSubscriptionForFirm,
  requireActiveSubscriptionForFirmNoSession,
  requireClientPortalAccess,
  ForbiddenError,
} from "@/lib/authz";
import { UnauthorizedError } from "@/lib/db-helpers";

beforeEach(() => {
  mockAuth.mockReset();
  mockIsBillingContact.mockReset();
  mockGetOrganization.mockReset();
  mockListBindingsForUser.mockReset();
  mockLegacyPortalClientRef.mockReset();
  mockGetActiveUserOverrides.mockReset();
  mockCookies.mockReset();
  mockCookies.mockResolvedValue({ get: () => undefined });
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

describe("requireActiveSubscriptionForFirmNoSession", () => {
  // The whole point of this variant: public token-authenticated routes have no
  // Clerk session, so it must never consult auth() and must never be able to
  // throw UnauthorizedError. Every case below leaves mockAuth unconfigured
  // (it would resolve `undefined` and destructuring it would TypeError), which
  // is what makes "auth() is not called" falsifiable rather than incidental.
  it("passes with NO session at all, and never calls auth()", async () => {
    mockGetOrganization.mockResolvedValue({
      publicMetadata: { subscription_status: "active" },
    });
    await expect(
      requireActiveSubscriptionForFirmNoSession("org_a"),
    ).resolves.toBeUndefined();
    expect(mockAuth).not.toHaveBeenCalled();
  });

  it("throws ForbiddenError for a lapsed firm — not UnauthorizedError", async () => {
    mockGetOrganization.mockResolvedValue({
      publicMetadata: { subscription_status: "canceled" },
    });
    await expect(
      requireActiveSubscriptionForFirmNoSession("org_a"),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(mockAuth).not.toHaveBeenCalled();
  });

  it("founder bypass — is_founder=true in the firm's Clerk org metadata", async () => {
    mockGetOrganization.mockResolvedValue({ publicMetadata: { is_founder: true } });
    await expect(
      requireActiveSubscriptionForFirmNoSession("org_a"),
    ).resolves.toBeUndefined();
  });

  it("reads the metadata of the firmId passed in, not of any caller org", async () => {
    mockGetOrganization.mockResolvedValue({
      publicMetadata: { subscription_status: "active" },
    });
    await requireActiveSubscriptionForFirmNoSession("org_a");
    expect(mockGetOrganization).toHaveBeenCalledWith({ organizationId: "org_a" });
  });

  it("fails closed when the firm has no publicMetadata", async () => {
    mockGetOrganization.mockResolvedValue({ publicMetadata: null });
    await expect(
      requireActiveSubscriptionForFirmNoSession("org_a"),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

/**
 * The active-household decision must be made INSIDE the gate. A Next 16 layout
 * is not an auth boundary — a forged router state tree skips it — so pinning
 * that `requireClientPortalAccess` itself resolves the cookie-selected binding
 * is the property that keeps a later refactor from moving it upward.
 *
 * Each case uses its own clerk user id: `getPortalClientRef` is React.cache'd,
 * and although `cache()` degrades to a pass-through outside a request scope,
 * a shared id would quietly become cross-test memoization if that changed.
 */
describe("requireClientPortalAccess", () => {
  function bind(
    bindingId: string,
    clientId: string,
    acceptedAt: string,
    status: "active" | "revoked" = "active",
    firm = { firmId: "org_portal", advisorId: "adv" },
  ) {
    return {
      bindingId,
      clientId,
      firmId: firm.firmId,
      advisorId: firm.advisorId,
      acceptedAt: new Date(acceptedAt),
      status,
    };
  }

  function firmHasPortal() {
    mockGetOrganization.mockResolvedValue({
      publicMetadata: { entitlements: ["client_portal"] },
    });
    mockGetActiveUserOverrides.mockResolvedValue([]);
  }

  it("resolves the cookie-selected household, inside the gate", async () => {
    mockAuth.mockResolvedValue({ userId: "user_gate_pick", orgId: null });
    mockListBindingsForUser.mockResolvedValue([
      bind("b1", "client-a", "2026-01-01T00:00:00Z"),
      bind("b2", "client-b", "2026-06-01T00:00:00Z"),
    ]);
    mockCookies.mockResolvedValue({ get: () => ({ value: "client-a" }) });
    firmHasPortal();

    const { clientId } = await requireClientPortalAccess();
    expect(clientId).toBe("client-a");
  });

  it("ignores a cookie naming a household the caller does not hold", async () => {
    mockAuth.mockResolvedValue({ userId: "user_gate_forged", orgId: null });
    mockListBindingsForUser.mockResolvedValue([
      bind("b1", "client-mine", "2026-01-01T00:00:00Z"),
    ]);
    mockCookies.mockResolvedValue({ get: () => ({ value: "client-theirs" }) });
    firmHasPortal();

    const { clientId } = await requireClientPortalAccess();
    expect(clientId).toBe("client-mine");
  });

  it("throws when the user holds no binding row and no legacy row", async () => {
    mockAuth.mockResolvedValue({ userId: "user_gate_unbound", orgId: null });
    mockListBindingsForUser.mockResolvedValue([]);
    mockLegacyPortalClientRef.mockResolvedValue(null);

    await expect(requireClientPortalAccess()).rejects.toBeInstanceOf(ForbiddenError);
  });

  // The gate is the surface a revoke has to actually close. A legacy fallback
  // keyed on "no ACTIVE bindings" would let this through, because
  // `clients.clerk_user_id` survives a revoke by design during Deploy 1.
  it("throws for a REVOKED binding even though the legacy column still names the household", async () => {
    mockAuth.mockResolvedValue({ userId: "user_gate_revoked", orgId: null });
    mockListBindingsForUser.mockResolvedValue([
      bind("b1", "client-gone", "2026-01-01T00:00:00Z", "revoked"),
    ]);
    mockLegacyPortalClientRef.mockResolvedValue({
      id: "client-gone",
      firmId: "org_portal",
      advisorId: "adv",
    });
    firmHasPortal();

    await expect(requireClientPortalAccess()).rejects.toBeInstanceOf(ForbiddenError);
    expect(mockLegacyPortalClientRef).not.toHaveBeenCalled();
  });

  // The entitlement tail must be checked against the SELECTED household's firm
  // and advisor, not another binding's.
  it("authorizes against the selected household's own firm and advisor", async () => {
    mockAuth.mockResolvedValue({ userId: "user_gate_twofirms", orgId: null });
    mockListBindingsForUser.mockResolvedValue([
      bind("b1", "client-acme", "2026-06-01T00:00:00Z", "active", {
        firmId: "org_acme",
        advisorId: "adv_acme",
      }),
      bind("b2", "client-globex", "2026-01-01T00:00:00Z", "active", {
        firmId: "org_globex",
        advisorId: "adv_globex",
      }),
    ]);
    mockCookies.mockResolvedValue({ get: () => ({ value: "client-globex" }) });
    firmHasPortal();

    const { clientId } = await requireClientPortalAccess();
    expect(clientId).toBe("client-globex");
    expect(mockGetOrganization).toHaveBeenCalledWith({ organizationId: "org_globex" });
    expect(mockGetActiveUserOverrides).toHaveBeenCalledWith("org_globex", "adv_globex");
  });

  it("still refuses an advisor session outright", async () => {
    mockAuth.mockResolvedValue({ userId: "user_gate_advisor", orgId: "org_portal" });
    await expect(requireClientPortalAccess()).rejects.toThrow(/Advisor session/);
    expect(mockListBindingsForUser).not.toHaveBeenCalled();
  });

  it("throws UnauthorizedError with no session at all", async () => {
    mockAuth.mockResolvedValue({ userId: null, orgId: null });
    await expect(requireClientPortalAccess()).rejects.toBeInstanceOf(UnauthorizedError);
  });
});
