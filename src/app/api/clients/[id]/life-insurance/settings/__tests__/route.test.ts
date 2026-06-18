import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db-helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db-helpers")>();
  return { ...actual, requireOrgId: vi.fn() };
});
vi.mock("@/lib/authz", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authz")>();
  return { ...actual, requireActiveSubscriptionForFirm: vi.fn().mockResolvedValue(undefined) };
});
vi.mock("@/lib/db-scoping", () => ({
  findClientInFirm: vi.fn(),
  assertModelPortfoliosInFirm: vi.fn(),
}));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/life-insurance/settings", () => ({
  saveLifeInsuranceSettings: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn().mockResolvedValue({ userId: "user_test" }),
}));
// requireClientEditAccess is now the gate. Delegate to the already-mocked
// findClientInFirm so tests that set findClientInFirm → null exercise the 403 path.
vi.mock("@/lib/clients/authz", () => ({
  requireClientEditAccess: vi.fn().mockImplementation(async (clientId: string) => {
    const { findClientInFirm } = await import("@/lib/db-scoping");
    const { ForbiddenError } = await import("@/lib/authz");
    const client = await findClientInFirm(clientId, "00000000-0000-4000-8000-000000000099");
    if (!client) throw new ForbiddenError("Client not found or no access");
    return { firmId: "00000000-0000-4000-8000-000000000099", access: "own" as const };
  }),
}));

import { PUT } from "../route";
import { requireOrgId } from "@/lib/db-helpers";
import { findClientInFirm, assertModelPortfoliosInFirm } from "@/lib/db-scoping";
import { saveLifeInsuranceSettings } from "@/lib/life-insurance/settings";

const CLIENT_ID = "00000000-0000-4000-8000-000000000001";
const FIRM_ID = "00000000-0000-4000-8000-000000000099";
const FOREIGN_MP = "00000000-0000-4000-8000-0000000000ff";

function makeRequest(body: unknown) {
  return new Request(
    `http://localhost/api/clients/${CLIENT_ID}/life-insurance/settings`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  ) as unknown as import("next/server").NextRequest;
}

const ctx = { params: Promise.resolve({ id: CLIENT_ID }) };

const BODY = (modelPortfolioId: string | null) => ({
  deathYear: 2030,
  modelPortfolioId,
  leaveToHeirsAmount: 1000000,
  livingExpenseAtDeath: 80000,
  payoffLiabilityIds: [],
  mcTargetScore: 0.8,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireOrgId).mockResolvedValue(FIRM_ID);
  vi.mocked(findClientInFirm).mockResolvedValue({ id: CLIENT_ID } as never);
});

describe("PUT /api/clients/[id]/life-insurance/settings — modelPortfolioId ownership (F14)", () => {
  it("rejects a modelPortfolioId from another firm and does not save", async () => {
    vi.mocked(assertModelPortfoliosInFirm).mockResolvedValue({
      ok: false,
      reason: `Model portfolio ${FOREIGN_MP} not available to this firm`,
    });
    const res = await PUT(makeRequest(BODY(FOREIGN_MP)), ctx as never);
    expect(res.status).toBe(400);
    expect(assertModelPortfoliosInFirm).toHaveBeenCalledWith(FIRM_ID, [
      FOREIGN_MP,
    ]);
    expect(saveLifeInsuranceSettings).not.toHaveBeenCalled();
  });

  it("saves when the modelPortfolioId belongs to the firm", async () => {
    vi.mocked(assertModelPortfoliosInFirm).mockResolvedValue({ ok: true });
    const res = await PUT(makeRequest(BODY("00000000-0000-4000-8000-0000000000aa")), ctx as never);
    expect(res.status).toBe(200);
    expect(saveLifeInsuranceSettings).toHaveBeenCalledTimes(1);
  });

  it("saves with a null modelPortfolioId (ownership check is a no-op)", async () => {
    vi.mocked(assertModelPortfoliosInFirm).mockResolvedValue({ ok: true });
    const res = await PUT(makeRequest(BODY(null)), ctx as never);
    expect(res.status).toBe(200);
    expect(saveLifeInsuranceSettings).toHaveBeenCalledTimes(1);
  });
});
