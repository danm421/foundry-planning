import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Fake DB. The security property under test in "scopes to the caller's org"
// IS the where clause on `accounts` — the route must scope by
// and(eq(id), eq(clientId), eq(category)) so another client's account id is a
// 404, never a leak. A fake that ignored the condition (or a real fake whose
// route dropped a predicate) could not tell that apart, so this genuinely
// EVALUATES drizzle's `eq`/`and` condition nodes rather than mocking them
// away. Same idiom as
// `src/app/api/clients/[id]/disability-policies/__tests__/route.test.ts`.
//
// The upsert test has the same shape of risk: `insert().values().
// onConflictDoUpdate()` genuinely performs the upsert against a keyed state
// bucket (looked up by the real target column(s), not hardcoded), so a route
// that dropped `.onConflictDoUpdate()` (or a fake that just pushed every
// insert) could not pass "a second PUT updates rather than duplicating" by
// accident.
// ---------------------------------------------------------------------------
type Row = Record<string, unknown>;
const state: { accounts: Row[]; annuityContracts: Row[] } = {
  accounts: [],
  annuityContracts: [],
};

vi.mock("@/db", async () => {
  const schema = await vi.importActual<typeof import("@/db/schema")>("@/db/schema");

  const colToPropCache = new WeakMap<object, Map<string, string>>();
  function colToPropFor(table: object): Map<string, string> {
    let map = colToPropCache.get(table);
    if (!map) {
      map = new Map();
      for (const [prop, col] of Object.entries(table as Record<string, { name?: string }>)) {
        if (col && typeof col.name === "string") map.set(col.name, prop);
      }
      colToPropCache.set(table, map);
    }
    return map;
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

  function rowsFor(table: unknown): Row[] {
    if (table === schema.accounts) return state.accounts;
    if (table === schema.annuityContracts) return state.annuityContracts;
    return [];
  }

  function matches(row: Row, table: unknown, cond: unknown): boolean {
    const colToProp = colToPropFor(table as object);
    return condPairs(cond).every(([col, val]) => row[colToProp.get(col) ?? col] === val);
  }

  const makeResult = (rows: Row[]) => ({
    [Symbol.iterator]: () => rows[Symbol.iterator](),
    then: (r: (v: Row[]) => unknown) => Promise.resolve(rows).then(r),
  });

  const db = {
    select: () => ({
      from: (t: unknown) => ({
        where: (cond: unknown) => makeResult(rowsFor(t).filter((r) => matches(r, t, cond))),
      }),
    }),
    insert: (t: unknown) => ({
      values: (v: Row) => ({
        onConflictDoUpdate: (opts: { target: unknown; set: Row }) => {
          const rows = rowsFor(t);
          const colToProp = colToPropFor(t as object);
          const targetCols = Array.isArray(opts.target) ? opts.target : [opts.target];
          const targetProps = targetCols.map(
            (c) => colToProp.get((c as { name: string }).name) ?? (c as { name: string }).name,
          );
          const existing = rows.find((r) => targetProps.every((p) => r[p] === v[p]));
          if (existing) {
            Object.assign(existing, opts.set);
          } else {
            rows.push({ ...v });
          }
          return Promise.resolve();
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

import { GET, PUT } from "../route";
import { verifyClientAccess, requireClientEditAccess } from "@/lib/clients/authz";
import { recordAudit } from "@/lib/audit";
import { requireOrgId, UnauthorizedError } from "@/lib/db-helpers";

const CLIENT_A = "10000000-0000-4000-8000-000000000001";
const CLIENT_B = "10000000-0000-4000-8000-000000000002";
const FIRM_A = "10000000-0000-4000-8000-000000000011";
const ACCOUNT_A = "10000000-0000-4000-8000-000000000021"; // annuity, client A
const ACCOUNT_B = "10000000-0000-4000-8000-000000000022"; // annuity, client B
const ACCOUNT_NON_ANNUITY = "10000000-0000-4000-8000-000000000023"; // brokerage, client A
const ACCOUNT_QLAC = "10000000-0000-4000-8000-000000000024"; // annuity, client A, $250k value

function resetState() {
  state.accounts = [
    { id: ACCOUNT_A, clientId: CLIENT_A, category: "annuity", value: "50000.00", name: "MYGA" },
    { id: ACCOUNT_B, clientId: CLIENT_B, category: "annuity", value: "75000.00", name: "SPIA" },
    {
      id: ACCOUNT_NON_ANNUITY,
      clientId: CLIENT_A,
      category: "brokerage",
      value: "100000.00",
      name: "Brokerage",
    },
    {
      id: ACCOUNT_QLAC,
      clientId: CLIENT_A,
      category: "annuity",
      value: "250000.00",
      name: "QLAC",
    },
  ];
  state.annuityContracts = [];
}

function req(body: unknown): NextRequest {
  return new Request("http://t/api/clients/x/annuity-contracts/y", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

function getReq(): NextRequest {
  return new Request("http://t/api/clients/x/annuity-contracts/y") as unknown as NextRequest;
}

function params(id: string, accountId: string) {
  return { params: Promise.resolve({ id, accountId }) };
}

beforeEach(() => {
  resetState();
  vi.mocked(verifyClientAccess).mockReset();
  vi.mocked(requireClientEditAccess).mockReset();
  vi.mocked(recordAudit).mockReset();
  vi.mocked(verifyClientAccess).mockResolvedValue({
    ok: true,
    permission: "edit",
    firmId: FIRM_A,
    access: "own",
  });
  vi.mocked(requireClientEditAccess).mockResolvedValue({
    client: { id: CLIENT_A } as never,
    firmId: FIRM_A,
    access: "own",
  });
});

describe("GET /api/clients/[id]/annuity-contracts/[accountId]", () => {
  it("returns the stored contract", async () => {
    state.annuityContracts.push({
      accountId: ACCOUNT_A,
      carrier: "Acme Life",
      contractNumberLast4: "1234",
      productType: "myga",
      taxTreatment: "non_qualified",
      costBasis: "50000.00",
      surrenderChargePct: "0.0700",
      surrenderEndYear: 2032,
      annualFeePct: "0.0000",
      incomeMode: "none",
      incomeStartYear: null,
      incomeStartYearRef: null,
      payoutStructure: null,
      survivorPct: null,
      periodCertainYears: null,
      benefitBase: null,
      rollupRate: null,
      rollupEndYear: null,
      rollupRatchets: true,
      riderFeePct: null,
      payoutPct: null,
      annuitizedPayment: null,
      expectedReturnYears: null,
    });
    const res = await GET(getReq(), params(CLIENT_A, ACCOUNT_A));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.carrier).toBe("Acme Life");
    expect(json.productType).toBe("myga");
    // Decimal columns come back as numbers, not drizzle's raw strings.
    expect(json.costBasis).toBe(50000);
    expect(json.surrenderChargePct).toBe(0.07);
  });

  it("returns null when no contract row exists", async () => {
    const res = await GET(getReq(), params(CLIENT_A, ACCOUNT_A));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toBeNull();
  });

  it("returns 401 (not 500) when requireOrgId rejects with a non-default message", async () => {
    // requireOrgId() throws UnauthorizedError("Organization context required")
    // on a missing org — a different message than the default "Unauthorized" —
    // so a string-equality catch misses it. authErrorResponse maps by
    // instanceof, not by message, so it must catch this too.
    vi.mocked(requireOrgId).mockRejectedValueOnce(
      new UnauthorizedError("Organization context required"),
    );
    const res = await GET(getReq(), params(CLIENT_A, ACCOUNT_A));
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Unauthorized");
  });

  it("round-trips: a GET response can be PUT straight back with no 400", async () => {
    state.annuityContracts.push({
      accountId: ACCOUNT_A,
      carrier: "Acme Life",
      contractNumberLast4: "1234",
      productType: "myga",
      taxTreatment: "non_qualified",
      costBasis: "50000.00",
      surrenderChargePct: "0.0700",
      surrenderEndYear: 2032,
      annualFeePct: "0.0125",
      incomeMode: "rider",
      incomeStartYear: 2030,
      incomeStartYearRef: null,
      payoutStructure: "single_life",
      survivorPct: null,
      periodCertainYears: null,
      benefitBase: "250000.00",
      rollupRate: "0.0500",
      rollupEndYear: 2028,
      rollupRatchets: true,
      riderFeePct: "0.0095",
      payoutPct: null,
      annuitizedPayment: null,
      expectedReturnYears: null,
    });
    const getRes = await GET(getReq(), params(CLIENT_A, ACCOUNT_A));
    expect(getRes.status).toBe(200);
    const body = await getRes.json();
    // Not part of the PUT body's schema — the caller already has it from the
    // URL, and the schema is `.strict()`, so an accountId key would 400.
    expect(body.accountId).toBeUndefined();

    const putRes = await PUT(req(body), params(CLIENT_A, ACCOUNT_A));
    expect(putRes.status).toBe(200);
  });
});

describe("PUT /api/clients/[id]/annuity-contracts/[accountId]", () => {
  it("rejects a contract on a non-annuity account", async () => {
    const res = await PUT(req({}), params(CLIENT_A, ACCOUNT_NON_ANNUITY));
    expect(res.status).toBe(404);
  });

  it("rejects income_mode=rider with no benefit base", async () => {
    const res = await PUT(
      req({ incomeMode: "rider", incomeStartYear: 2030 }),
      params(CLIENT_A, ACCOUNT_A),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.issues).toContainEqual(
      expect.objectContaining({ message: "An income rider needs a benefit base." }),
    );
  });

  it("rejects income_mode=annuitized with no payment", async () => {
    const res = await PUT(
      req({ incomeMode: "annuitized", incomeStartYear: 2030 }),
      params(CLIENT_A, ACCOUNT_A),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.issues).toContainEqual(
      expect.objectContaining({ message: "An annuitized contract needs an annual payment above zero." }),
    );
  });

  it("rejects income_mode != none with no start year", async () => {
    const res = await PUT(
      req({ incomeMode: "rider", benefitBase: 100000 }),
      params(CLIENT_A, ACCOUNT_A),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.issues).toContainEqual(
      expect.objectContaining({ message: "Set when the income starts." }),
    );
  });

  it("warns (does not block) when a QLAC premium exceeds $210,000", async () => {
    const res = await PUT(
      req({ productType: "qlac", incomeMode: "none" }),
      params(CLIENT_A, ACCOUNT_QLAC),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.warnings.some((w: string) => w.includes("210,000"))).toBe(true);
  });

  it("does not warn for a QLAC at or under the cap", async () => {
    // ACCOUNT_A is $50,000 — well under the cap.
    const res = await PUT(
      req({ productType: "qlac", incomeMode: "none" }),
      params(CLIENT_A, ACCOUNT_A),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.warnings).toEqual([]);
  });

  it("stores an empty cost basis as NULL, not 0", async () => {
    const res = await PUT(
      req({ costBasis: "", incomeMode: "none" }),
      params(CLIENT_A, ACCOUNT_A),
    );
    expect(res.status).toBe(200);
    const stored = state.annuityContracts.find((r) => r.accountId === ACCOUNT_A);
    expect(stored?.costBasis).toBeNull();
  });

  it("stores money and rate columns as DB-ready decimal strings, not numbers", async () => {
    // The fake accepts either — only a real `numeric` column would reject a
    // bare JS number — so this pins the `String(...)` conversion directly:
    // dropping it (e.g. `costBasis: input.costBasis`) keeps the fake and all
    // other tests green but silently breaks against real Postgres, and no
    // database in this branch has this table yet to catch it that way.
    const res = await PUT(
      req({ costBasis: 50000, surrenderChargePct: 0.07, incomeMode: "none" }),
      params(CLIENT_A, ACCOUNT_A),
    );
    expect(res.status).toBe(200);
    const stored = state.annuityContracts.find((r) => r.accountId === ACCOUNT_A);
    expect(stored?.costBasis).toBe("50000");
    expect(typeof stored?.costBasis).toBe("string");
    expect(stored?.surrenderChargePct).toBe("0.07");
    expect(typeof stored?.surrenderChargePct).toBe("string");
  });

  it("upserts: a second PUT updates rather than duplicating", async () => {
    const first = await PUT(
      req({ carrier: "Acme Life", incomeMode: "none" }),
      params(CLIENT_A, ACCOUNT_A),
    );
    expect(first.status).toBe(200);
    const second = await PUT(
      req({ carrier: "Zenith Annuities", incomeMode: "none" }),
      params(CLIENT_A, ACCOUNT_A),
    );
    expect(second.status).toBe(200);

    const rows = state.annuityContracts.filter((r) => r.accountId === ACCOUNT_A);
    expect(rows).toHaveLength(1);
    expect(rows[0].carrier).toBe("Zenith Annuities");
  });

  it("scopes to the caller's org: another client's account id is a 404", async () => {
    // CLIENT_A's caller tries to PUT to ACCOUNT_B, which belongs to CLIENT_B.
    const res = await PUT(req({}), params(CLIENT_A, ACCOUNT_B));
    expect(res.status).toBe(404);
    expect(state.annuityContracts).toHaveLength(0);
  });

  it("records an audit entry on a successful PUT", async () => {
    await PUT(req({ incomeMode: "none" }), params(CLIENT_A, ACCOUNT_A));
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "account.annuity.update",
        resourceType: "annuity_contract",
        resourceId: ACCOUNT_A,
        clientId: CLIENT_A,
      }),
    );
  });
});
