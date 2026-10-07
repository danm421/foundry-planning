import { describe, it, expect, vi, beforeEach } from "vitest";

// Unlike actions.test.ts, this file runs the REAL founder-init so the redeem
// action sees exactly which step of founder setup failed. Clerk and the
// database are mocked at their edges instead.

const mockAuth = vi.fn();
const mockHeaders = vi.fn();
const mockClaimCode = vi.fn();
const mockFinalizeCode = vi.fn();
const mockReleaseCode = vi.fn();
const mockReadPendingBeta = vi.fn();
const mockClearPendingBeta = vi.fn();
const mockCheckRateLimit = vi.fn();
const mockRecordAudit = vi.fn();

const mockCreateOrg = vi.fn();
const mockGetOrg = vi.fn();
const mockGetMembershipList = vi.fn();
const mockUpdateOrg = vi.fn();
const mockUpdateOrgMetadata = vi.fn();
const mockUpdateMembership = vi.fn();
const mockDeleteOrg = vi.fn();

const mockFirmsSelect = vi.fn();
const mockFirmsInsert = vi.fn();

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => mockAuth(),
  clerkClient: async () => ({
    organizations: {
      createOrganization: mockCreateOrg,
      getOrganization: mockGetOrg,
      getOrganizationMembershipList: mockGetMembershipList,
      updateOrganization: mockUpdateOrg,
      updateOrganizationMetadata: mockUpdateOrgMetadata,
      updateOrganizationMembership: mockUpdateMembership,
      deleteOrganization: mockDeleteOrg,
    },
  }),
}));
vi.mock("@/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => mockFirmsSelect() }) }),
    insert: () => ({ values: (row: unknown) => mockFirmsInsert(row) }),
  },
}));
vi.mock("next/headers", () => ({
  headers: () => mockHeaders(),
}));
vi.mock("@/lib/billing/beta-codes", () => ({
  claimCode: (...a: unknown[]) => mockClaimCode(...a),
  finalizeCode: (...a: unknown[]) => mockFinalizeCode(...a),
  releaseCode: (...a: unknown[]) => mockReleaseCode(...a),
}));
vi.mock("@/lib/billing/beta-cookie", () => ({
  readPendingBeta: (...a: unknown[]) => mockReadPendingBeta(...a),
  clearPendingBeta: (...a: unknown[]) => mockClearPendingBeta(...a),
}));
vi.mock("@/lib/rate-limit", () => ({
  checkBetaRedeemRateLimit: (...a: unknown[]) => mockCheckRateLimit(...a),
}));
vi.mock("@/lib/audit", () => ({
  recordAudit: (...a: unknown[]) => mockRecordAudit(...a),
}));

import { redeemBetaCode } from "../actions";

function databaseError(code: string): Error {
  return Object.assign(new Error("insert failed"), { code });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ userId: "u1", orgId: null });
  mockHeaders.mockResolvedValue({ get: () => null });
  mockCheckRateLimit.mockResolvedValue({ allowed: true });
  mockReadPendingBeta.mockResolvedValue(null);
  mockClaimCode.mockResolvedValue({ ok: true, id: "code_1", entitlements: ["ai_import"] });
  mockFinalizeCode.mockResolvedValue(undefined);
  mockReleaseCode.mockResolvedValue(undefined);
  mockClearPendingBeta.mockResolvedValue(undefined);

  mockCreateOrg.mockImplementation(async ({ name }: { name: string }) => ({ id: "org_x", name }));
  mockGetOrg.mockImplementation(async () => ({
    name: mockCreateOrg.mock.calls[0]?.[0]?.name,
    publicMetadata: {},
  }));
  mockGetMembershipList.mockResolvedValue({
    data: [{ publicUserData: { userId: "u1" }, role: "org:admin" }],
  });
  mockUpdateOrg.mockResolvedValue({});
  mockUpdateOrgMetadata.mockResolvedValue({});
  mockDeleteOrg.mockResolvedValue({});
  mockFirmsSelect.mockResolvedValue([]);
  mockFirmsInsert.mockResolvedValue(undefined);
});

describe("redeemBetaCode when founder setup fails part-way", () => {
  it("keeps the code spent once the workspace exists, and records it for follow-up", async () => {
    mockFirmsInsert.mockRejectedValue(databaseError("22021"));

    const result = await redeemBetaCode({ code: "FNDR-AAAA-BBBB", firmName: "Acme Advisors" });

    // The org was created and stamped as a founder before the firm row failed.
    expect(mockCreateOrg).toHaveBeenCalledTimes(1);
    expect(mockUpdateOrgMetadata.mock.calls[0][1].publicMetadata.is_founder).toBe(true);

    expect(mockReleaseCode).not.toHaveBeenCalled();
    expect(mockFinalizeCode).toHaveBeenCalledWith("code_1", "org_x");
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "beta_code.org_setup_failed",
        resourceType: "firm",
        resourceId: "org_x",
        firmId: "org_x",
        actorId: "u1",
        metadata: { betaCodeId: "code_1", entitlements: ["ai_import"] },
      }),
    );
    expect(mockDeleteOrg).not.toHaveBeenCalled();
    // The spent code is forgotten and the code form stays closed, so a refresh or
    // a retype can't bury the support message under "already used".
    expect(mockClearPendingBeta).toHaveBeenCalled();
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/contact support/i) });
    expect(result).not.toHaveProperty("needsManualEntry", true);
  });

  it("frees the code for another try when the workspace was never created", async () => {
    mockCreateOrg.mockRejectedValue(new Error("clerk unavailable"));

    const result = await redeemBetaCode({ code: "FNDR-AAAA-BBBB", firmName: "Acme Advisors" });

    expect(mockReleaseCode).toHaveBeenCalledWith("code_1");
    expect(mockFinalizeCode).not.toHaveBeenCalled();
    expect(mockRecordAudit).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      error: "Something went wrong creating your firm. Please try again.",
      needsManualEntry: true,
    });
  });

  it("creates the founder workspace for a firm name at the length limit", async () => {
    const result = await redeemBetaCode({ code: "FNDR-AAAA-BBBB", firmName: "A".repeat(80) });

    expect(result).toEqual({ ok: true, orgId: "org_x" });
    expect(mockFirmsInsert).toHaveBeenCalledWith(
      expect.objectContaining({ firmId: "org_x", isFounder: true }),
    );
    expect(mockReleaseCode).not.toHaveBeenCalled();
  });
});

describe("redeemBetaCode firm name checks", () => {
  it.each([
    ["a NUL character", `Acme${String.fromCharCode(0)}`],
    ["a tab", "Acme\tAdvisors"],
    ["more than 80 characters", "A".repeat(81)],
  ])("rejects a firm name with %s before claiming the code", async (_label, firmName) => {
    const result = await redeemBetaCode({ code: "FNDR-AAAA-BBBB", firmName });

    expect(mockCreateOrg).not.toHaveBeenCalled();
    expect(mockClaimCode).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: false, needsManualEntry: true });
  });

  it("checks the firm name carried over from the sign-up page too", async () => {
    mockReadPendingBeta.mockResolvedValue({
      code: "FNDR-AAAA-BBBB",
      firmName: `Acme${String.fromCharCode(0)}`,
    });

    const result = await redeemBetaCode();

    expect(mockCreateOrg).not.toHaveBeenCalled();
    expect(mockClaimCode).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: false, needsManualEntry: true });
  });
});
