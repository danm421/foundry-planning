import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Mocks (must be declared before importing the route) ---

const mockAuth = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({
  auth: () => mockAuth(),
}));

const mockRequireOrgId = vi.fn();
vi.mock("@/lib/db-helpers", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/db-helpers")>("@/lib/db-helpers");
  return {
    ...actual,
    requireOrgId: () => mockRequireOrgId(),
  };
});

const mockCheckImportRateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  checkImportRateLimit: (...a: unknown[]) => mockCheckImportRateLimit(...a),
}));

const mockRequireImportAccess = vi.fn();
vi.mock("@/lib/imports/authz", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/imports/authz")>(
      "@/lib/imports/authz",
    );
  return {
    ...actual,
    requireImportAccess: (...a: unknown[]) => mockRequireImportAccess(...a),
  };
});

const mockCommitTabs = vi.fn();
vi.mock("@/lib/imports/commit/orchestrator", () => ({
  commitTabs: (...a: unknown[]) => mockCommitTabs(...a),
}));

const mockClaimAiImportCredit = vi.fn();
const mockSyncAiImportEntitlement = vi.fn();
vi.mock("@/lib/billing/ai-import-quota", () => ({
  claimAiImportCredit: (...a: unknown[]) => mockClaimAiImportCredit(...a),
  syncAiImportEntitlement: (...a: unknown[]) => mockSyncAiImportEntitlement(...a),
}));

const mockRecordAudit = vi.fn();
vi.mock("@/lib/audit", () => ({
  recordAudit: (...a: unknown[]) => mockRecordAudit(...a),
}));

vi.mock("@/db", () => ({
  db: {
    // db.transaction(callback) — invoke callback with a fake tx and return its result.
    transaction: async <T,>(fn: (tx: unknown) => Promise<T>) =>
      fn({ execute: vi.fn() } as unknown),
  },
}));

import { POST } from "../route";

// --- Helpers ---

function makeReq(body: unknown = { tabs: ["entities"] }): Request {
  return new Request("http://localhost/api/clients/c1/imports/i1/commit", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

const params = Promise.resolve({ id: "client-1", importId: "imp-1" });

const baseImp = {
  id: "imp-1",
  scenarioId: "scenario-1",
  payloadJson: {
    payload: {
      dependents: [],
      accounts: [],
      incomes: [],
      expenses: [],
      liabilities: [],
      lifePolicies: [],
      wills: [],
      entities: [],
      warnings: [],
    },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ userId: "user-1" });
  mockRequireOrgId.mockResolvedValue("firm-1");
  mockCheckImportRateLimit.mockResolvedValue({ allowed: true });
  mockRecordAudit.mockResolvedValue(undefined);
  mockClaimAiImportCredit.mockResolvedValue(1);
  mockSyncAiImportEntitlement.mockResolvedValue(undefined);
});

describe("POST commit — ai-import quota hook", () => {
  it("calls claim + sync when mode='onboarding' and firstTimeAllCommitted=true", async () => {
    mockRequireImportAccess.mockResolvedValue({ ...baseImp, mode: "onboarding" });
    mockCommitTabs.mockResolvedValue({
      results: {},
      allTabsCommitted: true,
      firstTimeAllCommitted: true,
    });

    const res = await POST(makeReq() as never, { params } as never);

    expect(res.status).toBe(200);
    expect(mockClaimAiImportCredit).toHaveBeenCalledTimes(1);
    expect(mockClaimAiImportCredit).toHaveBeenCalledWith(
      expect.anything(),
      "imp-1",
    );
    expect(mockSyncAiImportEntitlement).toHaveBeenCalledTimes(1);
    expect(mockSyncAiImportEntitlement).toHaveBeenCalledWith("firm-1");
  });

  it("does NOT call claim/sync when mode='updating'", async () => {
    mockRequireImportAccess.mockResolvedValue({ ...baseImp, mode: "updating" });
    mockCommitTabs.mockResolvedValue({
      results: {},
      allTabsCommitted: true,
      firstTimeAllCommitted: true,
    });

    const res = await POST(makeReq() as never, { params } as never);

    expect(res.status).toBe(200);
    expect(mockClaimAiImportCredit).not.toHaveBeenCalled();
    expect(mockSyncAiImportEntitlement).not.toHaveBeenCalled();
  });

  it("does NOT call claim/sync when firstTimeAllCommitted=false (re-commit)", async () => {
    mockRequireImportAccess.mockResolvedValue({ ...baseImp, mode: "onboarding" });
    mockCommitTabs.mockResolvedValue({
      results: {},
      allTabsCommitted: true,
      firstTimeAllCommitted: false,
    });

    const res = await POST(makeReq() as never, { params } as never);

    expect(res.status).toBe(200);
    expect(mockClaimAiImportCredit).not.toHaveBeenCalled();
    expect(mockSyncAiImportEntitlement).not.toHaveBeenCalled();
  });

  it("swallows claim/sync errors — commit still returns 200", async () => {
    mockRequireImportAccess.mockResolvedValue({ ...baseImp, mode: "onboarding" });
    mockCommitTabs.mockResolvedValue({
      results: {},
      allTabsCommitted: true,
      firstTimeAllCommitted: true,
    });
    mockClaimAiImportCredit.mockRejectedValue(new Error("db down"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(makeReq() as never, { params } as never);

    expect(res.status).toBe(200);
    // syncAiImportEntitlement is in the same try/catch — claim error short-circuits it.
    expect(mockSyncAiImportEntitlement).not.toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
