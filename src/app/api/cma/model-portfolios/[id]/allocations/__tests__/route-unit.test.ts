import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for the CMA model-portfolio allocations PUT route, focused on
 * the F10 fix: cross-firm asset-class FK injection.
 *
 * The route verifies the portfolio is in-firm but historically wrote
 * `assetClassId` straight from the body with no `assertAssetClassesInFirm`
 * check and no Zod parse. These tests prove the handler now:
 *   - 400s on a malformed body (Zod parse),
 *   - 400s when any assetClassId belongs to another firm,
 *   - proceeds (calls the assert with firmId + the body ids) when all FKs
 *     are in-firm.
 *
 * authz + db-scoping + db are mocked so this is a pure control-flow unit test.
 */

const h = vi.hoisted(() => {
  const portfolioRow = { id: "p1", firmId: "firm-1" };
  return {
    assertAssetClassesInFirm: vi.fn(),
    portfolioRow,
    // The route makes 3 db calls: select portfolio, delete, insert, select-back.
    // A chainable stub where every terminal resolves sensibly.
    db: {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn().mockResolvedValue([portfolioRow]),
        })),
      })),
      delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
      insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue(undefined) })),
    },
  };
});

vi.mock("@/lib/authz", () => ({
  requireOrgAdminOrOwner: vi.fn().mockResolvedValue(undefined),
  authErrorResponse: vi.fn().mockReturnValue(null),
}));
vi.mock("@/lib/db-helpers", () => ({
  requireOrgId: vi.fn().mockResolvedValue("firm-1"),
}));
vi.mock("@/lib/db-scoping", () => ({
  assertAssetClassesInFirm: h.assertAssetClassesInFirm,
}));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/db", () => ({ db: h.db }));

import { PUT } from "../route";

function makeReq(body: unknown) {
  return new Request("http://localhost/api/cma/model-portfolios/p1/allocations", {
    method: "PUT",
    body: JSON.stringify(body),
  }) as unknown as import("next/server").NextRequest;
}

const params = Promise.resolve({ id: "p1" });
// Valid RFC-4122 v4 UUIDs (version nibble 4, variant nibble 8/9) — Zod v4's
// `.uuid()` validates version/variant, so all-same-digit ids would be rejected
// by the parse before the assert ever runs.
const AC1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AC2 = "bbbbbbbb-bbbb-4bbb-9bbb-bbbbbbbbbbbb";

beforeEach(() => {
  h.assertAssetClassesInFirm.mockReset();
});

describe("CMA allocations PUT — asset-class FK guard (F10)", () => {
  it("400s when an assetClassId belongs to another firm", async () => {
    h.assertAssetClassesInFirm.mockResolvedValue({
      ok: false,
      reason: `Asset class ${AC2} not available to this firm`,
    });

    const res = await PUT(
      makeReq({
        allocations: [
          { assetClassId: AC1, weight: "0.5" },
          { assetClassId: AC2, weight: "0.5" },
        ],
      }),
      { params },
    );

    expect(res.status).toBe(400);
    expect(h.assertAssetClassesInFirm).toHaveBeenCalledWith("firm-1", [AC1, AC2]);
  });

  it("400s on a malformed body (Zod parse) before reaching the assert", async () => {
    h.assertAssetClassesInFirm.mockResolvedValue({ ok: true });

    const res = await PUT(
      makeReq({ allocations: [{ assetClassId: "not-a-uuid", weight: "1.0" }] }),
      { params },
    );

    expect(res.status).toBe(400);
    expect(h.assertAssetClassesInFirm).not.toHaveBeenCalled();
  });

  it("proceeds past the guard when all asset classes are in-firm", async () => {
    h.assertAssetClassesInFirm.mockResolvedValue({ ok: true });

    const res = await PUT(
      makeReq({
        allocations: [
          { assetClassId: AC1, weight: "0.6" },
          { assetClassId: AC2, weight: "0.4" },
        ],
      }),
      { params },
    );

    expect(res.status).toBe(200);
    expect(h.assertAssetClassesInFirm).toHaveBeenCalledWith("firm-1", [AC1, AC2]);
  });

  it("still rejects weights that do not sum to 1.0", async () => {
    h.assertAssetClassesInFirm.mockResolvedValue({ ok: true });

    const res = await PUT(
      makeReq({
        allocations: [
          { assetClassId: AC1, weight: "0.6" },
          { assetClassId: AC2, weight: "0.6" },
        ],
      }),
      { params },
    );

    expect(res.status).toBe(400);
  });
});
