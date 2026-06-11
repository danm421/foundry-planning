import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAuth = vi.fn();
const mockHeaders = vi.fn();
const mockClaimCode = vi.fn();
const mockFinalizeCode = vi.fn();
const mockReleaseCode = vi.fn();
const mockCreateFounderOrg = vi.fn();
const mockReadPendingBeta = vi.fn();
const mockClearPendingBeta = vi.fn();
const mockCheckRateLimit = vi.fn();
const mockRecordAudit = vi.fn();

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => mockAuth(),
}));
vi.mock("next/headers", () => ({
  headers: () => mockHeaders(),
}));
vi.mock("@/lib/billing/beta-codes", () => ({
  claimCode: (...a: unknown[]) => mockClaimCode(...a),
  finalizeCode: (...a: unknown[]) => mockFinalizeCode(...a),
  releaseCode: (...a: unknown[]) => mockReleaseCode(...a),
}));
vi.mock("@/lib/billing/founder-init", () => ({
  createFounderOrgForUser: (...a: unknown[]) => mockCreateFounderOrg(...a),
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

beforeEach(() => {
  vi.clearAllMocks();
  mockHeaders.mockResolvedValue({ get: () => null });
  mockCheckRateLimit.mockResolvedValue({ allowed: true });
  mockReadPendingBeta.mockResolvedValue({ code: "FOUNDER-1234", firmName: "Acme Advisors" });
  mockClaimCode.mockResolvedValue({ ok: true, id: "code_1", entitlements: ["ai_import"] });
  mockCreateFounderOrg.mockResolvedValue({ firmId: "org_new" });
  mockFinalizeCode.mockResolvedValue(undefined);
  mockClearPendingBeta.mockResolvedValue(undefined);
});

describe("redeemBetaCode single-org guard", () => {
  it("rejects a user who already belongs to an org without claiming a code", async () => {
    mockAuth.mockResolvedValue({ userId: "user_1", orgId: "org_existing" });

    const result = await redeemBetaCode();

    expect(result).toEqual({ ok: false, error: "You already have a workspace." });
    expect(mockClaimCode).not.toHaveBeenCalled();
    expect(mockCreateFounderOrg).not.toHaveBeenCalled();
  });

  it("proceeds past the guard for an org-less user with a valid code", async () => {
    mockAuth.mockResolvedValue({ userId: "user_1", orgId: null });

    const result = await redeemBetaCode();

    expect(result).toEqual({ ok: true, orgId: "org_new" });
    expect(mockCreateFounderOrg).toHaveBeenCalledTimes(1);
  });
});
