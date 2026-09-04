import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Fake DB that EVALUATES the where clause (drizzle `eq`/`and` nodes carry the
// column + the bound param) — same technique as the disability-policies
// route test. The property under test for PUT/DELETE is that the item route
// scopes by `and(eq(id), eq(clientId))`, so another client's row is a 404 and
// never touched; a fake that ignored the condition could not tell rows apart.
// ---------------------------------------------------------------------------
type Row = Record<string, unknown>;
const state: { scenarios: Row[]; adjustments: Row[] } = {
  scenarios: [],
  adjustments: [],
};
let nextIdSeq = 0;

vi.mock("@/db", async () => {
  const schema = await vi.importActual<typeof import("@/db/schema")>("@/db/schema");

  // snake_case column name → camelCase row property, read off the real table.
  const colToProp = (table: unknown): Map<string, string> => {
    const map = new Map<string, string>();
    for (const [prop, col] of Object.entries(
      table as unknown as Record<string, { name?: string }>,
    )) {
      if (col && typeof col.name === "string") map.set(col.name, prop);
    }
    return map;
  };

  /** Flatten a drizzle condition into [columnName, boundValue] pairs. */
  function condPairs(node: unknown): Array<[string, unknown]> {
    const pairs: Array<[string, unknown]> = [];
    let pendingCol: string | null = null;
    const walk = (n: unknown): void => {
      if (n == null || typeof n !== "object") return;
      const o = n as Record<string, unknown>;
      if (Array.isArray(o.queryChunks)) {
        for (const c of o.queryChunks as unknown[]) walk(c);
        return;
      }
      if (typeof o.name === "string" && "table" in o) {
        pendingCol = o.name;
        return;
      }
      if ("value" in o && "encoder" in o) {
        if (pendingCol) pairs.push([pendingCol, o.value]);
        pendingCol = null;
      }
    };
    walk(node);
    return pairs;
  }

  const rowsFor = (table: unknown): Row[] =>
    table === schema.scenarios ? state.scenarios : state.adjustments;

  const matches = (table: unknown, row: Row, cond: unknown): boolean => {
    const map = colToProp(table);
    return condPairs(cond).every(([col, val]) => row[map.get(col) ?? col] === val);
  };

  const makeResult = (rows: Row[]) => ({
    then: (r: (v: Row[]) => unknown) => Promise.resolve(rows).then(r),
  });

  const db = {
    select: () => ({
      from: (table: unknown) => ({
        where: (cond: unknown) =>
          makeResult(rowsFor(table).filter((r) => matches(table, r, cond))),
      }),
    }),
    insert: () => ({
      values: (v: Row) => ({
        returning: async () => {
          const row: Row = {
            id: `adj-${++nextIdSeq}`,
            createdAt: new Date(),
            updatedAt: new Date(),
            ...v,
          };
          state.adjustments.push(row);
          return [row];
        },
      }),
    }),
    update: () => ({
      set: (patch: Row) => ({
        where: (cond: unknown) => ({
          returning: async () => {
            const hit = state.adjustments.filter((r) =>
              matches(schema.clientTaxAdjustments, r, cond),
            );
            for (const r of hit) Object.assign(r, patch);
            return hit;
          },
        }),
      }),
    }),
    transaction: async (fn: (tx: unknown) => Promise<void>) => {
      const tx = {
        delete: (table: unknown) => ({
          where: (cond: unknown) => {
            const hit = state.adjustments.filter((r) => matches(table, r, cond));
            state.adjustments = state.adjustments.filter((r) => !hit.includes(r));
            return Promise.resolve(hit);
          },
        }),
      };
      return fn(tx);
    },
  };
  return { db };
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
  verifyClientAccess: vi.fn(),
  requireClientEditAccess: vi.fn(),
}));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/scenario/prune-changes", () => ({
  pruneOrphanScenarioChanges: vi.fn().mockResolvedValue(undefined),
}));

import { GET, POST } from "../route";
import { DELETE } from "../[adjustmentId]/route";
import { requireOrgId } from "@/lib/db-helpers";
import { requireClientEditAccess, verifyClientAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, ForbiddenError } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";
import { pruneOrphanScenarioChanges } from "@/lib/scenario/prune-changes";

const CLIENT_A = "10000000-0000-4000-8000-000000000001";
const FIRM_A = "10000000-0000-4000-8000-000000000011";
const SCENARIO_A = "10000000-0000-4000-8000-000000000021";

const VALID_BODY = {
  taxType: "ordinary_income" as const,
  name: "Completed Roth conversion",
  owner: "joint" as const,
  annualAmount: -5000,
  growthRate: 0,
  startYear: 2026,
  endYear: 2026,
};

function req(method: string, clientId: string, body?: unknown) {
  return new Request(`http://localhost/api/clients/${clientId}/tax-adjustments`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }) as unknown as import("next/server").NextRequest;
}

const listCtx = (id: string) => ({ params: Promise.resolve({ id }) }) as never;
const itemCtx = (id: string, adjustmentId: string) =>
  ({ params: Promise.resolve({ id, adjustmentId }) }) as never;

/** Seed a persisted row directly, bypassing the route. */
function seedAdjustment(clientId: string, over: Row = {}): Row {
  const row: Row = {
    id: `seed-${++nextIdSeq}`,
    clientId,
    scenarioId: SCENARIO_A,
    taxType: "ordinary_income",
    name: "Seeded",
    owner: "joint",
    annualAmount: "1000.00",
    growthRate: "0.0000",
    startYear: 2026,
    endYear: 2026,
    startYearRef: null,
    endYearRef: null,
    withheldMode: "none",
    withheldValue: "0.0000",
    source: "manual",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
  state.adjustments.push(row);
  return row;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.scenarios = [{ id: SCENARIO_A, clientId: CLIENT_A, isBaseCase: true }];
  state.adjustments = [];
  vi.mocked(requireOrgId).mockResolvedValue(FIRM_A);
  vi.mocked(requireClientEditAccess).mockResolvedValue({
    firmId: FIRM_A,
    access: "own",
  } as never);
  vi.mocked(verifyClientAccess).mockResolvedValue({
    ok: true,
    permission: "edit",
    firmId: FIRM_A,
    access: "own",
  });
  vi.mocked(requireActiveSubscriptionForFirm).mockResolvedValue(undefined);
});

describe("POST /api/clients/[id]/tax-adjustments", () => {
  it("creates with a negative annualAmount — 0 and negative are both legal", async () => {
    const res = await POST(req("POST", CLIENT_A, VALID_BODY), listCtx(CLIENT_A));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.annualAmount).toBe("-5000");
    expect(state.adjustments).toHaveLength(1);
    expect(state.adjustments[0].annualAmount).toBe("-5000");
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "tax_adjustment.create",
        resourceType: "tax_adjustment",
        clientId: CLIENT_A,
        firmId: FIRM_A,
      }),
    );
  });

  it("defaults withheldMode to 'none' when the body omits it", async () => {
    // VALID_BODY carries no withheldMode/withheldValue — the route must fill them in.
    const res = await POST(req("POST", CLIENT_A, VALID_BODY), listCtx(CLIENT_A));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.withheldMode).toBe("none");
    expect(body.withheldValue).toBe("0");
    expect(state.adjustments[0].withheldMode).toBe("none");
  });

  it("returns the subscription gate's status when the firm has no active subscription", async () => {
    vi.mocked(requireActiveSubscriptionForFirm).mockRejectedValue(
      new ForbiddenError("Active subscription required"),
    );
    const res = await POST(req("POST", CLIENT_A, VALID_BODY), listCtx(CLIENT_A));
    expect(res.status).toBe(403);
    expect(state.adjustments).toHaveLength(0);
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("preserves a 0.225 withheldValue through the round trip — scale 4 must not round to 0.23", async () => {
    const res = await POST(
      req("POST", CLIENT_A, { ...VALID_BODY, withheldMode: "percent", withheldValue: 0.225 }),
      listCtx(CLIENT_A),
    );
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created.withheldValue).toBe("0.225");
    expect(created.withheldValue).not.toBe("0.23");

    const getRes = await GET(req("GET", CLIENT_A), listCtx(CLIENT_A));
    expect(getRes.status).toBe(200);
    const rows = await getRes.json();
    const round = rows.find((r: Row) => r.id === created.id);
    expect(round.withheldValue).toBe("0.225");
  });
});

describe("DELETE /api/clients/[id]/tax-adjustments/[adjustmentId]", () => {
  it("removes the row and prunes orphaned scenario changes", async () => {
    const mine = seedAdjustment(CLIENT_A);
    const res = await DELETE(req("DELETE", CLIENT_A), itemCtx(CLIENT_A, mine.id as string));
    expect(res.status).toBe(200);
    expect(state.adjustments).toHaveLength(0);
    expect(pruneOrphanScenarioChanges).toHaveBeenCalledWith(
      expect.anything(),
      mine.id,
    );
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "tax_adjustment.delete",
        resourceType: "tax_adjustment",
        resourceId: mine.id,
        clientId: CLIENT_A,
        firmId: FIRM_A,
      }),
    );
  });

  it("returns 404 for another client's adjustment and leaves it in place", async () => {
    const foreign = seedAdjustment("10000000-0000-4000-8000-000000000099");
    const res = await DELETE(req("DELETE", CLIENT_A), itemCtx(CLIENT_A, foreign.id as string));
    expect(res.status).toBe(404);
    expect(state.adjustments).toHaveLength(1);
    expect(recordAudit).not.toHaveBeenCalled();
  });
});
