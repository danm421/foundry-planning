/**
 * GET / PUT /api/clients/[id]/entities/[entityId]/flow-overrides
 *
 * A trust that exists only in a scenario (a `scenario_changes` add row) has no
 * base `entities` row. GET answers an empty grid; PUT refuses with a clear
 * message instead of a bare "Entity not found".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/clients/authz", () => ({
  verifyClientAccess: vi.fn(),
  requireClientEditAccess: vi.fn(),
}));
vi.mock("@/lib/authz", () => ({
  requireActiveSubscriptionForFirm: vi.fn(),
  authErrorResponse: () => null,
}));
vi.mock("@/lib/db-helpers", () => ({
  requireOrgId: vi.fn(async () => "firm-1"),
  requireOrgAndUser: vi.fn(async () => ({ orgId: "firm-1", userId: "user-1" })),
}));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));

const selectQueue: unknown[][] = [];
const transaction = vi.fn();
vi.mock("@/db", () => {
  const result = (rows: unknown[]) => ({
    where: () => result(rows),
    limit: () => result(rows),
    then: (r: (v: unknown[]) => unknown) => Promise.resolve(rows).then(r),
  });
  return {
    db: {
      select: () => ({ from: () => result(selectQueue.shift() ?? []) }),
      transaction: (...a: unknown[]) => transaction(...a),
    },
  };
});

import { GET, PUT } from "../route";
import { verifyClientAccess, requireClientEditAccess } from "@/lib/clients/authz";

const CLIENT = "22222222-2222-2222-2222-222222222222";
const TRUST = "33333333-3333-3333-3333-333333333333";
const SCENARIO = "44444444-4444-4444-4444-444444444444";

const ctx = { params: Promise.resolve({ id: CLIENT, entityId: TRUST }) };
const url = (qs = "") => `http://t/flow-overrides${qs}`;
const getReq = (qs = "") => ({ method: "GET", nextUrl: new URL(url(qs)) }) as never;
const putReq = (qs = "") =>
  ({
    method: "PUT",
    nextUrl: new URL(url(qs)),
    json: async () => ({ overrides: [{ year: 2030, incomeAmount: 1 }] }),
  }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  selectQueue.length = 0;
  const ok = { ok: true, permission: "edit", firmId: "firm-1", access: "own" } as never;
  vi.mocked(requireClientEditAccess).mockResolvedValue(ok);
  vi.mocked(verifyClientAccess).mockResolvedValue(ok);
});

describe("flow-overrides — scenario-only trust", () => {
  it("GET returns an empty grid", async () => {
    // base entity miss, scenario in scope, scenario_changes add row found
    selectQueue.push([], [{ id: SCENARIO }], [{ id: "chg-1" }]);
    const res = await GET(getReq(`?scenarioId=${SCENARIO}`), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ overrides: [] });
  });

  it("GET 404s an id that is not a scenario add either", async () => {
    selectQueue.push([], [{ id: SCENARIO }], []);
    const res = await GET(getReq(`?scenarioId=${SCENARIO}`), ctx);
    expect(res.status).toBe(404);
  });

  it("GET without a scenario is still a plain 404 with no scenario lookup", async () => {
    selectQueue.push([], [{ id: "chg-1" }]);
    const res = await GET(getReq(), ctx);
    expect(res.status).toBe(404);
    expect(selectQueue).toHaveLength(1);
  });

  it("PUT 400s with the per-year-schedule message and writes nothing", async () => {
    selectQueue.push([], [{ id: SCENARIO }], [{ id: "chg-1" }]);
    const res = await PUT(putReq(`?scenarioId=${SCENARIO}`), ctx);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Per-year schedules aren't available for a trust that exists only in this scenario.",
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("PUT 404s an unknown id", async () => {
    selectQueue.push([], [{ id: SCENARIO }], []);
    const res = await PUT(putReq(`?scenarioId=${SCENARIO}`), ctx);
    expect(res.status).toBe(404);
  });

  it("PUT without a scenario is still a plain 404", async () => {
    selectQueue.push([], [{ id: "chg-1" }]);
    const res = await PUT(putReq(), ctx);
    expect(res.status).toBe(404);
    expect(selectQueue).toHaveLength(1);
  });
});
