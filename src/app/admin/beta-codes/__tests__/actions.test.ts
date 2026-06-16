import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAuth = vi.fn();
const mockRequireOpsAdmin = vi.fn();
const mockMintCodes = vi.fn();
const mockRevokeCode = vi.fn();
const mockRecordAudit = vi.fn();
const mockRevalidatePath = vi.fn();

vi.mock("@clerk/nextjs/server", () => ({ auth: () => mockAuth() }));
vi.mock("@/lib/ops/ops-auth", () => ({ requireOpsAdmin: () => mockRequireOpsAdmin() }));
vi.mock("@/lib/billing/beta-codes", () => ({
  mintCodes: (...a: unknown[]) => mockMintCodes(...a),
  revokeCode: (...a: unknown[]) => mockRevokeCode(...a),
}));
vi.mock("@/lib/audit", () => ({ recordAudit: (...a: unknown[]) => mockRecordAudit(...a) }));
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => mockRevalidatePath(...a) }));

import { mintCodesAction, revokeCodeAction } from "../actions";

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ userId: "user_op", orgId: "org_op" });
  mockRequireOpsAdmin.mockResolvedValue({ clerkUserId: "user_op", email: "op@foundry", role: "superadmin" });
  mockMintCodes.mockResolvedValue(["FNDR-AAAA-BBBB"]);
  mockRevokeCode.mockResolvedValue({ id: "code_1" });
});

describe("mintCodesAction", () => {
  it("mints, audits, and returns plaintext codes", async () => {
    const res = await mintCodesAction({ count: 1, label: "x", expiresAt: null, entitlements: ["ai_import"] });
    expect(res).toEqual({ ok: true, codes: ["FNDR-AAAA-BBBB"] });
    expect(mockMintCodes).toHaveBeenCalledWith({ count: 1, label: "x", expiresAt: null, entitlements: ["ai_import"] });
    expect(mockRecordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "beta_code.minted", firmId: "org_op" }));
  });

  it("rejects an out-of-range count without minting", async () => {
    const res = await mintCodesAction({ count: 0, label: null, expiresAt: null, entitlements: [] });
    expect(res.ok).toBe(false);
    expect(mockMintCodes).not.toHaveBeenCalled();
  });

  it("rejects a malformed expiresAt without minting", async () => {
    const res = await mintCodesAction({ count: 1, label: null, expiresAt: "not-a-date", entitlements: ["ai_import"] });
    expect(res.ok).toBe(false);
    expect(mockMintCodes).not.toHaveBeenCalled();
  });

  it("returns forbidden when the gate throws", async () => {
    mockRequireOpsAdmin.mockRejectedValue(new Error("nope"));
    const res = await mintCodesAction({ count: 1, label: null, expiresAt: null, entitlements: ["ai_import"] });
    expect(res.ok).toBe(false);
    expect(mockMintCodes).not.toHaveBeenCalled();
  });
});

describe("revokeCodeAction", () => {
  it("revokes, audits, revalidates", async () => {
    const res = await revokeCodeAction("code_1");
    expect(res).toEqual({ ok: true });
    expect(mockRevokeCode).toHaveBeenCalledWith("code_1");
    expect(mockRecordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "beta_code.revoked", resourceId: "code_1" }));
    expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/beta-codes");
  });
});
