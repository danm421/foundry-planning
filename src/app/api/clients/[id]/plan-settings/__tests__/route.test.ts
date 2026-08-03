/**
 * Unit tests for PUT /api/clients/[id]/plan-settings — capital loss
 * carryforward inputs (short-term / long-term).
 *
 * All dependencies are mocked (no live DB) — mirrors the pattern used in
 * sibling routes such as ../../life-insurance/settings/__tests__/route.test.ts
 * and ../../privacy/__tests__/route.test.ts.
 *
 * Covers:
 * 1. Negative capitalLossCarryforwardSt is rejected (400, no DB write).
 * 2. Negative capitalLossCarryforwardLt is rejected (400, no DB write).
 * 3. Negative / NaN sent as a string is rejected the same way (400, no DB
 *    write) — the sole production caller sends strings, not numbers.
 * 4. Positive values are persisted as decimal strings.
 * 5. Omitting both fields leaves them unset (undefined) in the update payload
 *    — a null-means-"not entered" column must never be silently zeroed by an
 *    unrelated save.
 * 6. An explicit null is accepted (not rejected by the non-negative guard)
 *    and persisted as a literal null, clearing a previously-entered value.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { updateCalls, CLIENT_ID, FIRM_ID, SCENARIO_ID } = vi.hoisted(() => ({
  updateCalls: [] as Record<string, unknown>[],
  CLIENT_ID: "10000000-0000-0000-0000-000000000001",
  FIRM_ID: "10000000-0000-0000-0000-000000000011",
  SCENARIO_ID: "20000000-0000-0000-0000-000000000002",
}));

// ---------------------------------------------------------------------------
// Minimal DB mock — the only db.select() call exercised by these tests is
// getBaseCaseScenarioId's scenario lookup (no selectedBenchmarkPortfolioId is
// passed in any test body, so the modelPortfolios select branch never runs).
// update(...).set(values) is captured so tests can assert on the exact
// payload the route builds.
//
// The route wraps its writes in db.transaction() — the planSettings update and
// the clients workplace-coverage update must commit together. The mock's tx
// therefore exposes the SAME update builder, so the captured payload is
// identical whether the route writes directly or inside the transaction.
// Without a transaction() the route throws TypeError and every write test
// fails 500 rather than asserting anything.
// ---------------------------------------------------------------------------
vi.mock("@/db", () => {
  const update = () => ({
    set: (values: Record<string, unknown>) => ({
      where: () => ({
        returning: () => {
          updateCalls.push(values);
          return Promise.resolve([{ id: "settings-1", ...values }]);
        },
      }),
    }),
  });
  const select = () => ({
    from: () => ({
      where: () => Promise.resolve([{ id: SCENARIO_ID }]),
    }),
  });
  return {
    db: {
      select,
      update,
      transaction: (fn: (tx: { select: typeof select; update: typeof update }) => unknown) =>
        Promise.resolve(fn({ select, update })),
    },
  };
});

vi.mock("@/lib/db-helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db-helpers")>();
  return { ...actual, requireOrgId: vi.fn() };
});

vi.mock("@/lib/authz", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authz")>();
  return {
    ...actual,
    requireActiveSubscriptionForFirm: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("@/lib/clients/authz", () => ({
  verifyClientAccess: vi.fn().mockResolvedValue({
    ok: true,
    permission: "edit",
    firmId: FIRM_ID,
    access: "own",
  }),
  requireClientEditAccess: vi.fn().mockResolvedValue({ firmId: FIRM_ID, access: "own" }),
}));

vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));

import { PUT } from "../route";
import { requireOrgId } from "@/lib/db-helpers";
import { recordAudit } from "@/lib/audit";

function makeRequest(body: unknown) {
  return new Request(`http://localhost/api/clients/${CLIENT_ID}/plan-settings`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as import("next/server").NextRequest;
}

const ctx: { params: Promise<{ id: string }> } = { params: Promise.resolve({ id: CLIENT_ID }) };

beforeEach(() => {
  vi.clearAllMocks();
  updateCalls.length = 0;
  vi.mocked(requireOrgId).mockResolvedValue(FIRM_ID);
});

describe("PUT /api/clients/[id]/plan-settings — capital loss carryforward", () => {
  it("rejects a negative capitalLossCarryforwardSt (400, no DB write)", async () => {
    const res = await PUT(makeRequest({ capitalLossCarryforwardSt: -100 }), ctx);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/capitalLossCarryforwardSt/);
    expect(updateCalls).toHaveLength(0);
  });

  it("rejects a negative capitalLossCarryforwardLt (400, no DB write)", async () => {
    const res = await PUT(makeRequest({ capitalLossCarryforwardLt: -1 }), ctx);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/capitalLossCarryforwardLt/);
    expect(updateCalls).toHaveLength(0);
  });

  // The sole production caller (tax-rates-form.tsx) sends these fields as
  // strings (`String(Number(raw))`), never as numbers — a `typeof x ===
  // "number"` guard never sees them. These two cases reproduce that wire
  // format.
  it("rejects a negative capitalLossCarryforwardSt sent as a string (400, no DB write)", async () => {
    const res = await PUT(makeRequest({ capitalLossCarryforwardSt: "-5000" }), ctx);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/capitalLossCarryforwardSt/);
    expect(updateCalls).toHaveLength(0);
  });

  it('rejects "NaN" sent as a string for capitalLossCarryforwardSt (400, no DB write)', async () => {
    const res = await PUT(makeRequest({ capitalLossCarryforwardSt: "NaN" }), ctx);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/capitalLossCarryforwardSt/);
    expect(updateCalls).toHaveLength(0);
  });

  it("saves positive values as decimal strings and records an audit entry", async () => {
    const res = await PUT(
      makeRequest({ capitalLossCarryforwardSt: 5000, capitalLossCarryforwardLt: 12000.5 }),
      ctx,
    );

    expect(res.status).toBe(200);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].capitalLossCarryforwardSt).toBe("5000");
    expect(updateCalls[0].capitalLossCarryforwardLt).toBe("12000.5");
    expect(recordAudit).toHaveBeenCalledOnce();
  });

  it("omitting both fields leaves them unset in the update payload", async () => {
    const res = await PUT(makeRequest({}), ctx);

    expect(res.status).toBe(200);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].capitalLossCarryforwardSt).toBeUndefined();
    expect(updateCalls[0].capitalLossCarryforwardLt).toBeUndefined();
  });

  // An explicit null means "clear the stored value back to not-entered" (as
  // opposed to omitting the key, which leaves the stored value untouched).
  // The non-negative guard above must not treat null as an invalid number —
  // it must pass through to the update payload as a literal null so the
  // Step 6 tax-return autofill can re-trigger on the next page load.
  it("accepts an explicit null and clears the stored value (200, literal null in payload)", async () => {
    const res = await PUT(
      makeRequest({ capitalLossCarryforwardSt: null, capitalLossCarryforwardLt: null }),
      ctx,
    );

    expect(res.status).toBe(200);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].capitalLossCarryforwardSt).toBeNull();
    expect(updateCalls[0].capitalLossCarryforwardLt).toBeNull();
  });
});

describe("PUT /api/clients/[id]/plan-settings — surplusSpendAllUntilRetirement", () => {
  it("persists true", async () => {
    const res = await PUT(makeRequest({ surplusSpendAllUntilRetirement: true }), ctx);

    expect(res.status).toBe(200);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].surplusSpendAllUntilRetirement).toBe(true);
  });

  // The setting must be turnable back OFF. `false` is not "absent".
  it("persists an explicit false", async () => {
    const res = await PUT(makeRequest({ surplusSpendAllUntilRetirement: false }), ctx);

    expect(res.status).toBe(200);
    expect(updateCalls[0].surplusSpendAllUntilRetirement).toBe(false);
  });

  it("leaves it untouched when the key is absent", async () => {
    const res = await PUT(makeRequest({ surplusSpendPct: 0.4 }), ctx);

    expect(res.status).toBe(200);
    expect(updateCalls[0].surplusSpendAllUntilRetirement).toBeUndefined();
  });

  it("ignores a non-boolean rather than coercing it", async () => {
    const res = await PUT(makeRequest({ surplusSpendAllUntilRetirement: "yes" }), ctx);

    expect(res.status).toBe(200);
    expect(updateCalls[0].surplusSpendAllUntilRetirement).toBeUndefined();
  });
});
