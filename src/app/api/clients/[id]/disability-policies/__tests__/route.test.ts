import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Fake DB. Unlike most route fakes in this repo it EVALUATES the where clause
// (drizzle `eq`/`and` nodes carry the column + the bound param), because the
// security property under test IS the where clause: the item route must scope
// by `and(eq(id), eq(clientId))` so another client's policy id is a 404 and
// never a leak. A fake that ignored the condition could not tell the two apart.
// ---------------------------------------------------------------------------
type Row = Record<string, unknown>;
const state: { policies: Row[] } = { policies: [] };
let nextIdSeq = 0;

vi.mock("@/db", async () => {
  const schema = await vi.importActual<typeof import("@/db/schema")>("@/db/schema");

  // snake_case column name → camelCase row property, read off the real table.
  const colToProp = new Map<string, string>();
  for (const [prop, col] of Object.entries(
    schema.disabilityPolicies as unknown as Record<string, { name?: string }>,
  )) {
    if (col && typeof col.name === "string") colToProp.set(col.name, prop);
  }

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

  const matches = (row: Row, cond: unknown): boolean =>
    condPairs(cond).every(
      ([col, val]) => row[colToProp.get(col) ?? col] === val,
    );

  const makeResult = (rows: Row[]) => ({
    then: (r: (v: Row[]) => unknown) => Promise.resolve(rows).then(r),
    orderBy: () => makeResult(rows),
  });

  const db = {
    select: () => ({
      from: () => ({
        where: (cond: unknown) =>
          makeResult(state.policies.filter((r) => matches(r, cond))),
      }),
    }),
    insert: () => ({
      values: (v: Row) => ({
        returning: async () => {
          const row: Row = {
            id: `policy-${++nextIdSeq}`,
            createdAt: new Date(),
            updatedAt: new Date(),
            ...v,
          };
          state.policies.push(row);
          return [row];
        },
      }),
    }),
    update: () => ({
      set: (patch: Row) => ({
        where: (cond: unknown) => ({
          returning: async () => {
            const hit = state.policies.filter((r) => matches(r, cond));
            for (const r of hit) Object.assign(r, patch);
            return hit;
          },
        }),
      }),
    }),
    delete: () => ({
      where: (cond: unknown) => ({
        returning: async () => {
          const hit = state.policies.filter((r) => matches(r, cond));
          state.policies = state.policies.filter((r) => !hit.includes(r));
          return hit;
        },
      }),
    }),
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

import { GET, POST } from "../route";
import { PATCH, DELETE } from "../[policyId]/route";
import { requireOrgId, UnauthorizedError } from "@/lib/db-helpers";
import { requireClientEditAccess, verifyClientAccess } from "@/lib/clients/authz";
import { recordAudit } from "@/lib/audit";

const CLIENT_A = "10000000-0000-4000-8000-000000000001";
const CLIENT_B = "10000000-0000-4000-8000-000000000002";
const FIRM_A = "10000000-0000-4000-8000-000000000011";

const VALID_BODY = {
  name: "Group LTD",
  insured: "client" as const,
  coveredEarningsMode: "salary" as const,
  hasShortTerm: true,
  stdEliminationDays: 7,
  stdBenefitPct: 0.6,
  stdDurationWeeks: 13,
  stdMonthlyMax: null,
  hasLongTerm: true,
  ltdEliminationDays: 90,
  ltdBenefitPct: 0.6,
  ltdMonthlyMax: 10000,
  ltdBenefitPeriodMode: "to_age" as const,
  ltdBenefitPeriodAge: 65,
  benefitTaxable: true,
  colaRate: 0,
  annualPremium: 0,
  premiumPayer: "employer" as const,
};

function req(method: string, clientId: string, body?: unknown) {
  return new Request(
    `http://localhost/api/clients/${clientId}/disability-policies`,
    {
      method,
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
  ) as unknown as import("next/server").NextRequest;
}

const listCtx = (id: string) => ({ params: Promise.resolve({ id }) }) as never;
const itemCtx = (id: string, policyId: string) =>
  ({ params: Promise.resolve({ id, policyId }) }) as never;

/** Seed a persisted row directly, bypassing the route. */
function seedPolicy(clientId: string, over: Row = {}): Row {
  const row: Row = {
    id: `seed-${++nextIdSeq}`,
    clientId,
    name: "Seeded",
    insured: "client",
    carrier: null,
    coveredEarningsMode: "salary",
    coveredEarningsAmount: null,
    hasShortTerm: true,
    stdEliminationDays: 7,
    stdBenefitPct: "0.6000",
    stdDurationWeeks: 13,
    stdMonthlyMax: null,
    hasLongTerm: true,
    ltdEliminationDays: 90,
    ltdBenefitPct: "0.6000",
    ltdMonthlyMax: "10000.00",
    ltdBenefitPeriodMode: "to_age",
    ltdBenefitPeriodAge: 65,
    ltdBenefitPeriodYears: null,
    benefitTaxable: true,
    colaRate: "0.0000",
    annualPremium: "0",
    premiumPayer: "employer",
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
  state.policies.push(row);
  return row;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.policies = [];
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
});

describe("POST /api/clients/[id]/disability-policies", () => {
  it("returns 401 when the caller has no authenticated org", async () => {
    vi.mocked(requireOrgId).mockRejectedValue(new UnauthorizedError());
    const res = await POST(req("POST", CLIENT_A, VALID_BODY), listCtx(CLIENT_A));
    expect(res.status).toBe(401);
    expect(state.policies).toHaveLength(0);
  });

  it("creates the policy and returns 201 with it", async () => {
    const res = await POST(req("POST", CLIENT_A, VALID_BODY), listCtx(CLIENT_A));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.policy).toMatchObject({
      name: "Group LTD",
      insured: "client",
      benefitTaxable: true,
    });
    expect(body.policy.longTerm).toMatchObject({
      eliminationDays: 90,
      benefitPct: 0.6,
      monthlyMax: 10000,
      benefitPeriod: { mode: "to_age", age: 65 },
    });
    expect(state.policies).toHaveLength(1);
    expect(state.policies[0].clientId).toBe(CLIENT_A);
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "disability_policy.create",
        resourceType: "disability_policy",
        clientId: CLIENT_A,
        firmId: FIRM_A,
      }),
    );
  });

  it("keeps an uncapped monthly max NULL end to end (never 0)", async () => {
    const res = await POST(
      req("POST", CLIENT_A, {
        ...VALID_BODY,
        stdMonthlyMax: null,
        ltdMonthlyMax: null,
      }),
      listCtx(CLIENT_A),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    // Persisted column: null, not the string "0".
    expect(state.policies[0].ltdMonthlyMax).toBeNull();
    expect(state.policies[0].stdMonthlyMax).toBeNull();
    // And the mapped policy handed back to the caller.
    expect(body.policy.longTerm.monthlyMax).toBeNull();
    expect(body.policy.shortTerm.monthlyMax).toBeNull();
  });

  it("rejects a policy that covers neither short-term nor long-term with 400", async () => {
    const res = await POST(
      req("POST", CLIENT_A, {
        ...VALID_BODY,
        hasShortTerm: false,
        hasLongTerm: false,
      }),
      listCtx(CLIENT_A),
    );
    expect(res.status).toBe(400);
    expect(state.policies).toHaveLength(0);
  });
});

describe("GET /api/clients/[id]/disability-policies", () => {
  it("returns 404 for a client the caller cannot see, and leaks nothing", async () => {
    seedPolicy(CLIENT_B, { name: "Other firm's policy" });
    vi.mocked(verifyClientAccess).mockResolvedValue({ ok: false });
    const res = await GET(req("GET", CLIENT_B), listCtx(CLIENT_B));
    expect(res.status).toBe(404);
    expect(JSON.stringify(await res.json())).not.toContain("Other firm's policy");
  });

  it("lists only this client's policies", async () => {
    seedPolicy(CLIENT_A, { name: "Mine" });
    seedPolicy(CLIENT_B, { name: "Theirs" });
    const res = await GET(req("GET", CLIENT_A), listCtx(CLIENT_A));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.policies.map((p: { name: string }) => p.name)).toEqual(["Mine"]);
  });
});

describe("PATCH /api/clients/[id]/disability-policies/[policyId]", () => {
  it("returns 404 for a policy id that belongs to another client", async () => {
    const foreign = seedPolicy(CLIENT_B, { name: "Theirs" });
    const res = await PATCH(
      req("PATCH", CLIENT_A, { name: "Hijacked" }),
      itemCtx(CLIENT_A, foreign.id as string),
    );
    expect(res.status).toBe(404);
    expect(foreign.name).toBe("Theirs");
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("writes only the fields present in the body", async () => {
    const mine = seedPolicy(CLIENT_A, { name: "Before", ltdBenefitPct: "0.7000" });
    const res = await PATCH(
      req("PATCH", CLIENT_A, { name: "After" }),
      itemCtx(CLIENT_A, mine.id as string),
    );
    expect(res.status).toBe(200);
    expect(mine.name).toBe("After");
    // Untouched by a one-key body — a mass-assigned or default-injected
    // patch would reset these to the schema's "typical" values.
    expect(mine.ltdBenefitPct).toBe("0.7000");
    expect(mine.stdDurationWeeks).toBe(13);
    expect((await res.json()).policy.longTerm.benefitPct).toBe(0.7);
  });
});

describe("DELETE /api/clients/[id]/disability-policies/[policyId]", () => {
  it("removes the policy and returns 200", async () => {
    const mine = seedPolicy(CLIENT_A);
    const res = await DELETE(
      req("DELETE", CLIENT_A),
      itemCtx(CLIENT_A, mine.id as string),
    );
    expect(res.status).toBe(200);
    expect(state.policies).toHaveLength(0);
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "disability_policy.delete",
        resourceType: "disability_policy",
        resourceId: mine.id,
      }),
    );
  });

  it("returns 404 for another client's policy and leaves it in place", async () => {
    const foreign = seedPolicy(CLIENT_B);
    const res = await DELETE(
      req("DELETE", CLIENT_A),
      itemCtx(CLIENT_A, foreign.id as string),
    );
    expect(res.status).toBe(404);
    expect(state.policies).toHaveLength(1);
  });
});
