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
    schema.ltcPolicies as unknown as Record<string, { name?: string }>,
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

vi.mock("@/lib/insurance-policies/load-ltc-policies", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/insurance-policies/load-ltc-policies")>();
  return { ...actual, loadRiderLifePolicy: vi.fn() };
});

import { GET, POST } from "../route";
import { PATCH, DELETE } from "../[policyId]/route";
import { requireOrgId } from "@/lib/db-helpers";
import { requireClientEditAccess, verifyClientAccess } from "@/lib/clients/authz";
import { recordAudit } from "@/lib/audit";
import { loadRiderLifePolicy } from "@/lib/insurance-policies/load-ltc-policies";
import { LTC_RIDER_DEFAULTS, LTC_STANDALONE_DEFAULTS } from "@/lib/schemas/ltc-policies";

const CLIENT_A = "10000000-0000-4000-8000-000000000001";
const CLIENT_B = "10000000-0000-4000-8000-000000000002";
const FIRM_A = "10000000-0000-4000-8000-000000000011";
const LIFE = "20000000-0000-4000-8000-000000000001";

const STANDALONE = { name: "Genworth", insured: "client", issueYear: 2018, ...LTC_STANDALONE_DEFAULTS, annualPremium: 2400 };
const RIDER = { name: "LTC rider", insured: "client", issueYear: 2018, ...LTC_RIDER_DEFAULTS, lifePolicyAccountId: LIFE };

const req = (body?: unknown) =>
  ({ json: async () => body }) as unknown as import("next/server").NextRequest;
const params = (id: string, policyId?: string) => ({
  params: Promise.resolve(policyId ? { id, policyId } : { id }),
}) as never;

beforeEach(() => {
  state.policies = [];
  vi.clearAllMocks();
  vi.mocked(requireOrgId).mockResolvedValue(FIRM_A);
  vi.mocked(requireClientEditAccess).mockResolvedValue({ firmId: FIRM_A, access: "own" } as never);
  vi.mocked(verifyClientAccess).mockResolvedValue({ ok: true } as never);
  vi.mocked(loadRiderLifePolicy).mockResolvedValue({ id: LIFE, category: "life_insurance", insuredPerson: "client" });
});

async function create(body: unknown, clientId = CLIENT_A) {
  return POST(req(body), params(clientId));
}

describe("POST /ltc-policies", () => {
  it("stores a standalone policy with decimal columns as strings, and audits it", async () => {
    const res = await create(STANDALONE);
    expect(res.status).toBe(201);
    expect(state.policies[0]).toMatchObject({
      clientId: CLIENT_A, kind: "standalone", benefitAmount: "6000", benefitPeriodYears: 3,
      inflationRate: "0.03", annualPremium: "2400", lifePolicyAccountId: null,
    });
    const { policy } = await res.json();
    expect(policy.benefitAmount).toBe(6000);
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "ltc_policy.create", clientId: CLIENT_A }));
  });

  it("checks a rider's life policy against THIS client and stores the link", async () => {
    const res = await create(RIDER);
    expect(res.status).toBe(201);
    expect(loadRiderLifePolicy).toHaveBeenCalledWith(CLIENT_A, LIFE);
    expect(state.policies[0]).toMatchObject({ kind: "life_rider", lifePolicyAccountId: LIFE, riderMonthlyPct: "0.02" });
  });

  it.each([
    [{ id: LIFE, category: "life_insurance", insuredPerson: "spouse" }, "The life policy must insure the same person as the rider."],
    [{ id: LIFE, category: "life_insurance", insuredPerson: "joint" }, "A rider can't sit on a joint (second-to-die) policy."],
    [null, "Pick one of this household's life insurance policies."],
  ])("refuses a rider on %j", async (account, message) => {
    vi.mocked(loadRiderLifePolicy).mockResolvedValue(account as never);
    const res = await create(RIDER);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(message);
    expect(state.policies).toHaveLength(0);
  });

  it("refuses a standalone policy with no benefit period", async () => {
    const res = await create({ ...STANDALONE, benefitPeriodMode: null });
    expect(res.status).toBe(400);
    expect(state.policies).toHaveLength(0);
  });

  // Ruling T2-a: the schema default "lifetime" must not reach a rider row.
  it("stores a rider sent without premiumPayMode as paid_up", async () => {
    const { premiumPayMode: _omit, ...body } = RIDER;
    void _omit;
    const res = await create(body);
    expect(res.status).toBe(201);
    expect(state.policies[0].premiumPayMode).toBe("paid_up");
  });
});

describe("PATCH /ltc-policies/[policyId]", () => {
  it("writes only the key that was sent", async () => {
    const { policy } = await (await create(STANDALONE)).json();
    const res = await PATCH(req({ annualPremium: 3000 }), params(CLIENT_A, policy.id));
    expect(res.status).toBe(200);
    expect(state.policies[0]).toMatchObject({ annualPremium: "3000", benefitAmount: "6000", benefitPeriodYears: 3 });
  });

  // Review Focus 4: the body alone parses, but the merged row would be a rider
  // with no life policy — validated on the MERGE, it is refused.
  it("refuses a one-key change that would leave the stored row invalid", async () => {
    const { policy } = await (await create(STANDALONE)).json();
    const res = await PATCH(req({ kind: "life_rider" }), params(CLIENT_A, policy.id));
    expect(res.status).toBe(400);
    expect(state.policies[0].kind).toBe("standalone");
  });

  it("re-checks the rider link when the insured person changes", async () => {
    const { policy } = await (await create(RIDER)).json();
    const res = await PATCH(req({ insured: "spouse" }), params(CLIENT_A, policy.id));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("The life policy must insure the same person as the rider.");
  });

  it("is a 404, never a leak, for another client's policy", async () => {
    const { policy } = await (await create(STANDALONE)).json();
    const res = await PATCH(req({ annualPremium: 1 }), params(CLIENT_B, policy.id));
    expect(res.status).toBe(404);
    expect(state.policies[0].annualPremium).toBe("2400");
  });

  // Ruling T2-a: a kind switch clears the other kind's leftovers.
  it("clears rider leftovers when a rider becomes standalone", async () => {
    const { policy } = await (await create(RIDER)).json();
    const res = await PATCH(
      req({
        kind: "standalone", lifePolicyAccountId: null, benefitAmount: 6000, benefitPeriodMode: "years",
        benefitPeriodYears: 3, premiumPayMode: "lifetime", annualPremium: 2400,
      }),
      params(CLIENT_A, policy.id),
    );
    expect(res.status).toBe(200);
    expect(state.policies[0]).toMatchObject({
      kind: "standalone", riderBenefitMode: null, riderMonthlyPct: null, riderMaxPct: null,
    });
  });

  // Validated on the merge BEFORE normalizing: refused, never silently zeroed.
  it("refuses a premium on a rider instead of zeroing it", async () => {
    const { policy } = await (await create(RIDER)).json();
    const res = await PATCH(req({ annualPremium: 500 }), params(CLIENT_A, policy.id));
    expect(res.status).toBe(400);
    expect(state.policies[0].annualPremium).toBe("0");
  });
});

describe("DELETE /ltc-policies/[policyId]", () => {
  it("deletes the client's own policy and audits it; another client's id is a 404", async () => {
    const { policy } = await (await create(STANDALONE)).json();
    expect((await DELETE(req(), params(CLIENT_B, policy.id))).status).toBe(404);
    expect((await DELETE(req(), params(CLIENT_A, policy.id))).status).toBe(200);
    expect(state.policies).toHaveLength(0);
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "ltc_policy.delete" }));
  });
});

describe("GET /ltc-policies", () => {
  it("is a 404 when the caller cannot see the client", async () => {
    vi.mocked(verifyClientAccess).mockResolvedValue({ ok: false } as never);
    expect((await GET(req(), params(CLIENT_A))).status).toBe(404);
  });
});
