/**
 * GET / PUT /api/clients/[id]/accounts/[accountId]/flow-overrides
 *
 * A business created inside a scenario (a `scenario_changes` add row) has no
 * base `accounts` row. GET answers an empty grid; PUT refuses with a clear
 * message instead of a bare "Account not found". Anything else stays a 404, and
 * a request with no scenario never looks at scenario changes.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

vi.mock("@/lib/clients/authz", () => ({
  verifyClientAccess: vi.fn(),
  requireClientEditAccess: vi.fn(),
}));
vi.mock("@/lib/authz", () => ({
  requireActiveSubscriptionForFirm: vi.fn(),
  authErrorResponse: () => null,
}));
vi.mock("@/lib/db-helpers", () => ({ requireOrgId: vi.fn(async () => "firm-1") }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));

// Each select takes the next queued result and records its table and `where`.
const { selectQueue, selects, transaction } = vi.hoisted(() => ({
  selectQueue: [] as unknown[][],
  selects: [] as { table: unknown; where?: unknown }[],
  transaction: vi.fn(),
}));
vi.mock("@/db", () => {
  const result = (rows: unknown[], rec: { where?: unknown }) => ({
    where: (w: unknown) => {
      rec.where = w;
      return result(rows, rec);
    },
    then: (r: (v: unknown[]) => unknown) => Promise.resolve(rows).then(r),
  });
  return {
    db: {
      select: () => ({
        from: (table: unknown) => {
          const rec: { table: unknown; where?: unknown } = { table };
          selects.push(rec);
          return result(selectQueue.shift() ?? [], rec);
        },
      }),
      transaction: (...a: unknown[]) => transaction(...a),
    },
  };
});

import { GET, PUT } from "../route";
import { verifyClientAccess, requireClientEditAccess } from "@/lib/clients/authz";
import { accountFlowOverrides, scenarioChanges, scenarios } from "@/db/schema";

const CLIENT = "22222222-2222-2222-2222-222222222222";
const BIZ = "33333333-3333-3333-3333-333333333333";
const SCENARIO = "44444444-4444-4444-4444-444444444444";

const ctx = { params: Promise.resolve({ id: CLIENT, accountId: BIZ }) };
const url = (qs = "") => `http://t/api/clients/${CLIENT}/accounts/${BIZ}/flow-overrides${qs}`;
const getReq = (qs = "") => ({ method: "GET", url: url(qs) }) as never;
const putReq = (qs = "") =>
  ({
    method: "PUT",
    url: url(qs),
    json: async () => ({ overrides: [{ year: 2030, incomeAmount: 1 }] }),
  }) as never;

const SCENARIO_ONLY = "Per-year schedules aren't available for a business that exists only in this scenario.";
const businessAdd = { payload: { id: BIZ, category: "business", parentAccountId: null } };

/** The rendered `where` of the select against `table`. */
function whereOf(table: unknown) {
  const rec = selects.find((s) => s.table === table);
  if (!rec) return undefined;
  const { sql, params } = new PgDialect().sqlToQuery(rec.where as SQL);
  return { sql, params };
}

beforeEach(() => {
  vi.clearAllMocks();
  selectQueue.length = 0;
  selects.length = 0;
  const ok = { ok: true, permission: "edit", firmId: "firm-1", access: "own" } as never;
  vi.mocked(requireClientEditAccess).mockResolvedValue(ok);
  vi.mocked(verifyClientAccess).mockResolvedValue(ok);
});

describe("account flow-overrides — scenario-only business", () => {
  it("GET returns an empty grid, after a scoped lookup of the scenario's add row", async () => {
    // base account miss, scenario in scope, scenario_changes add row found
    selectQueue.push([], [{ id: SCENARIO }], [businessAdd]);
    const res = await GET(getReq(`?scenarioId=${SCENARIO}`), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ overrides: [] });

    // The scenario is scoped to this client before its changes are read…
    expect(whereOf(scenarios)).toEqual({
      sql: '("scenarios"."id" = $1 and "scenarios"."client_id" = $2)',
      params: [SCENARIO, CLIENT],
    });
    // …and only this scenario's ADD of THIS account counts.
    expect(whereOf(scenarioChanges)).toEqual({
      sql:
        '("scenario_changes"."scenario_id" = $1 and "scenario_changes"."target_kind" = $2 ' +
        'and "scenario_changes"."target_id" = $3 and "scenario_changes"."op_type" = $4)',
      params: [SCENARIO, "account", BIZ, "add"],
    });
    expect(verifyClientAccess).toHaveBeenCalledWith(CLIENT);
  });

  it("PUT 400s with the per-year-schedule message and writes nothing", async () => {
    selectQueue.push([], [{ id: SCENARIO }], [businessAdd]);
    const res = await PUT(putReq(`?scenarioId=${SCENARIO}`), ctx);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: SCENARIO_ONLY });
    expect(transaction).not.toHaveBeenCalled();
  });

  it.each([
    ["a scenario-only account that is not a business", { payload: { category: "cash", parentAccountId: null } }],
    ["a scenario-only business held under another business", { payload: { category: "business", parentAccountId: "x" } }],
  ])("GET and PUT 404 %s", async (_label, add) => {
    selectQueue.push([], [{ id: SCENARIO }], [add]);
    expect((await GET(getReq(`?scenarioId=${SCENARIO}`), ctx)).status).toBe(404);
    selectQueue.length = 0;
    selectQueue.push([], [{ id: SCENARIO }], [add]);
    expect((await PUT(putReq(`?scenarioId=${SCENARIO}`), ctx)).status).toBe(404);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("an id that is not a scenario add either is still a 404", async () => {
    selectQueue.push([], [{ id: SCENARIO }], []);
    const res = await GET(getReq(`?scenarioId=${SCENARIO}`), ctx);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Account not found" });
  });

  it("a scenario outside this client 404s before any scenario change is read", async () => {
    selectQueue.push([], []);
    const res = await GET(getReq(`?scenarioId=${SCENARIO}`), ctx);
    expect(res.status).toBe(404);
    expect(selects.map((s) => s.table)).not.toContain(scenarioChanges);
  });

  it("without a scenario a missing account is a plain 404 with no scenario lookup", async () => {
    selectQueue.push([], [businessAdd]);
    expect((await GET(getReq(), ctx)).status).toBe(404);
    expect(selectQueue).toHaveLength(1);
    selectQueue.length = 0;
    selectQueue.push([], [businessAdd]);
    const res = await PUT(putReq(), ctx);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Account not found" });
    expect(selectQueue).toHaveLength(1);
  });

  it("a base business still reads its own base overrides", async () => {
    selectQueue.push(
      [{ id: BIZ, category: "business", parentAccountId: null }],
      [{ year: 2030, incomeAmount: "1000.00", expenseAmount: null, distributionPercent: "0.5" }],
    );
    const res = await GET(getReq(), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      overrides: [{ year: 2030, incomeAmount: 1000, expenseAmount: null, distributionPercent: 0.5 }],
    });
    expect(whereOf(accountFlowOverrides)?.params).toEqual([BIZ]);
  });
});
