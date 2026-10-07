// The sale-to-trust route writes a note receivable, so its term is held to the
// same 12,000-month limit as every other note. A body past the limit is a 400
// before anything is read; a body inside it goes on to look up the account
// (here: not found, so 404).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/db-helpers", () => ({
  requireOrgAndUser: async () => ({ orgId: "org-1", userId: "user-1" }),
}));
vi.mock("@/lib/clients/authz", () => ({
  requireClientEditAccess: async () => ({ firmId: "org-1", access: "own" }),
}));
vi.mock("@/lib/authz", () => ({
  requireActiveSubscriptionForFirm: async () => {},
  authErrorResponse: () => null,
}));
vi.mock("@/lib/scenario/route-scope", () => ({
  assertScenarioRouteScope: async () => ({ kind: "ok", scenario: { id: "s1" } }),
}));
vi.mock("@/lib/scenario/changes-writer", () => ({ applyEntityEdit: vi.fn() }));
vi.mock("@/lib/db-scoping", () => ({ assertEntitiesInClient: vi.fn() }));
vi.mock("@/lib/clients/cross-firm-audit", () => ({ crossFirmAuditMeta: vi.fn() }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));

const selectRows = vi.fn();
vi.mock("@/db", () => ({
  db: { select: () => ({ from: () => ({ where: async () => selectRows() }) }) },
}));

import { POST } from "../route";

function post(noteTermMonths: number) {
  const req = new NextRequest("http://localhost/api/clients/c1/scenarios/s1/sale-to-trust", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      accountId: "11111111-1111-4111-8111-111111111111",
      trustEntityId: "22222222-2222-4222-8222-222222222222",
      noteInterestRate: 0.045,
      noteTermMonths,
      noteStartYear: 2026,
      notePaymentType: "amortizing",
    }),
  });
  return POST(req, { params: Promise.resolve({ id: "c1", sid: "s1" }) });
}

beforeEach(() => {
  selectRows.mockReset();
  selectRows.mockResolvedValue([]);
});

describe("POST sale-to-trust note term", () => {
  it.each([12_001, Number.MAX_SAFE_INTEGER])("rejects a %d-month note", async (t) => {
    const res = await post(t);
    expect(res.status).toBe(400);
    expect(selectRows).not.toHaveBeenCalled();
  });

  it.each([3_240, 12_000])("accepts a %d-month note", async (t) => {
    const res = await post(t);
    expect(res.status).toBe(404);
    expect(selectRows).toHaveBeenCalled();
  });
});
