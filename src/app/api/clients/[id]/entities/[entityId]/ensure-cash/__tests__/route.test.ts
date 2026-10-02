/**
 * POST /api/clients/[id]/entities/[entityId]/ensure-cash
 *
 * A trust that exists only in a scenario (a `scenario_changes` add row) has no
 * base `entities` row, so the self-heal used to 404 on it. With `?scenario=` it
 * now answers `200 { created: 0 }`; without it, or for an unknown id, nothing
 * changes.
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

// Each `select()` chain resolves to the next queued row set, in call order.
const selectQueue: unknown[][] = [];
const insert = vi.fn();
const transaction = vi.fn();
vi.mock("@/db", () => {
  const result = (rows: unknown[]) => ({
    where: () => result(rows),
    limit: () => result(rows),
    innerJoin: () => result(rows),
    then: (r: (v: unknown[]) => unknown) => Promise.resolve(rows).then(r),
  });
  return {
    db: {
      select: () => ({ from: () => result(selectQueue.shift() ?? []) }),
      insert: (...a: unknown[]) => insert(...a),
      transaction: (...a: unknown[]) => transaction(...a),
    },
  };
});

import { POST } from "../route";
import { verifyClientAccess, requireClientEditAccess } from "@/lib/clients/authz";

const CLIENT = "22222222-2222-2222-2222-222222222222";
const TRUST = "33333333-3333-3333-3333-333333333333";
const SCENARIO = "44444444-4444-4444-4444-444444444444";

const ctx = { params: Promise.resolve({ id: CLIENT, entityId: TRUST }) };
const req = (qs = "") =>
  ({ method: "POST", url: `http://t/ensure-cash${qs}`, nextUrl: new URL(`http://t/ensure-cash${qs}`) }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  selectQueue.length = 0;
  const ok = { ok: true, permission: "edit", firmId: "firm-1", access: "own" } as never;
  vi.mocked(requireClientEditAccess).mockResolvedValue(ok);
  vi.mocked(verifyClientAccess).mockResolvedValue(ok);
});

describe("POST ensure-cash — scenario-only trust", () => {
  it("200 { created: 0 } with no insert when the id is a scenario add", async () => {
    // base entity miss, scenario in scope, scenario_changes add row found
    selectQueue.push([], [{ id: SCENARIO }], [{ id: "chg-1" }]);
    const res = await POST(req(`?scenario=${SCENARIO}`), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ created: 0 });
    expect(insert).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it("404 when the id is neither a base entity nor a scenario add", async () => {
    selectQueue.push([], [{ id: SCENARIO }], []);
    const res = await POST(req(`?scenario=${SCENARIO}`), ctx);
    expect(res.status).toBe(404);
  });

  it("404 when the scenario is not the client's, before looking for the add row", async () => {
    selectQueue.push([], [], [{ id: "chg-1" }]);
    const res = await POST(req(`?scenario=${SCENARIO}`), ctx);
    expect(res.status).toBe(404);
    expect(selectQueue).toHaveLength(1); // the add-row lookup never ran
  });

  it("without ?scenario= a base miss is still a plain 404 with no scenario lookup", async () => {
    selectQueue.push([], [{ id: "chg-1" }]);
    const res = await POST(req(), ctx);
    expect(res.status).toBe(404);
    expect(selectQueue).toHaveLength(1);
  });
});
