/**
 * Integration tests for /api/clients/[id]/accounts/[accountId]/flow-overrides.
 * Exercises real DB via Drizzle — requires DATABASE_URL; suite is skipped if
 * unavailable (mirrors the entities/assets route test harness).
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

// Load .env.local before anything that reads DATABASE_URL at module-init time.
try {
  const envPath = resolve(process.cwd(), ".env.local");
  const raw = readFileSync(envPath, "utf8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    const [, k, vRaw] = m;
    if (process.env[k]) continue;
    let v = vRaw.trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    process.env[k] = v;
  }
} catch {
  // .env.local not present — the skipIf below handles this.
}

const HAS_DB = !!process.env.DATABASE_URL;
const d = HAS_DB ? describe : describe.skip;

vi.mock("@/lib/db-helpers", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db-helpers")>(
    "@/lib/db-helpers",
  );
  return {
    ...actual,
    getOrgId: vi.fn(),
    requireOrgId: vi.fn(),
  };
});

vi.mock("@/lib/audit", () => ({
  recordAudit: vi.fn().mockResolvedValue(undefined),
  recordCreate: vi.fn().mockResolvedValue(undefined),
  recordUpdate: vi.fn().mockResolvedValue(undefined),
  recordDelete: vi.fn().mockResolvedValue(undefined),
}));

// Phase 1b: routes gate via verifyClientAccess → auth() from @clerk/nextjs/server.
// Mock it so the staff-scope check is a no-op (undefined orgRole ⇒ non-staff ⇒
// access turns purely on the firm-scoped clients query the test already drives).
vi.mock("@clerk/nextjs/server", () => ({
  // orgId = TEST_FIRM (inlined — vi.mock is hoisted) so the real verifyClientAccess
  // own-firm path matches for TEST_FIRM clients; OTHER_FIRM clients fall through to
  // the (empty) share resolver and are denied, preserving the cross-firm 404 test.
  auth: vi.fn().mockResolvedValue({ userId: "user_test", orgId: "firm_account_flow_overrides_route_test" }),
}));

const TEST_FIRM = "firm_account_flow_overrides_route_test";
const OTHER_FIRM = "firm_account_flow_overrides_other";

d("/api/clients/[id]/accounts/[accountId]/flow-overrides", () => {
  let dbMod: typeof import("@/db");
  let schema: typeof import("@/db/schema");
  let helpers: typeof import("@/lib/db-helpers");
  let drizzleOrm: typeof import("drizzle-orm");
  let GET: (typeof import("../route"))["GET"];
  let PUT: (typeof import("../route"))["PUT"];

  beforeAll(async () => {
    dbMod = await import("@/db");
    schema = await import("@/db/schema");
    helpers = await import("@/lib/db-helpers");
    drizzleOrm = await import("drizzle-orm");
    ({ GET, PUT } = await import("../route"));
  });

  async function cleanup() {
    const { db } = dbMod;
    const { clients, crmHouseholds } = schema;
    // accounts, scenarios, accountFlowOverrides all cascade from clients.
    // Delete clients before crmHouseholds (FK is ON DELETE RESTRICT).
    await db
      .delete(clients)
      .where(drizzleOrm.inArray(clients.firmId, [TEST_FIRM, OTHER_FIRM]));
    await db
      .delete(crmHouseholds)
      .where(drizzleOrm.inArray(crmHouseholds.firmId, [TEST_FIRM, OTHER_FIRM]));
  }

  /**
   * Seed minimal client + base scenario + business account (top-level by default).
   * Optionally also seeds a non-business account and a child business account
   * for the 400 cases.
   */
  async function setup(opts?: {
    firmId?: string;
    extraScenario?: boolean;
    nonBusinessAccount?: boolean;
    childBusinessAccount?: boolean;
  }) {
    const firmId = opts?.firmId ?? TEST_FIRM;
    const { db } = dbMod;
    const { clients, scenarios, accounts, crmHouseholds } = schema;

    const [household] = await db
      .insert(crmHouseholds)
      .values({
        firmId,
        advisorId: "advisor_account_flow_overrides_test",
        name: "Test Household",
      })
      .returning();

    const [client] = await db
      .insert(clients)
      .values({
        firmId,
        advisorId: "advisor_account_flow_overrides_test",
        crmHouseholdId: household.id,
        retirementAge: 65,
        planEndAge: 90,
        lifeExpectancy: 90,
        filingStatus: "single",
      })
      .returning();

    const [baseScenario] = await db
      .insert(scenarios)
      .values({ clientId: client.id, name: "base", isBaseCase: true })
      .returning();

    const [otherScenario] = opts?.extraScenario
      ? await db
          .insert(scenarios)
          .values({ clientId: client.id, name: "what-if", isBaseCase: false })
          .returning()
      : [undefined];

    const [businessAccount] = await db
      .insert(accounts)
      .values({
        clientId: client.id,
        scenarioId: baseScenario.id,
        name: "Test Business",
        category: "business",
        value: "1000000",
        distributionPolicyPercent: "1.0000",
      })
      .returning();

    const [nonBusiness] = opts?.nonBusinessAccount
      ? await db
          .insert(accounts)
          .values({
            clientId: client.id,
            scenarioId: baseScenario.id,
            name: "Test Brokerage",
            category: "taxable",
          })
          .returning()
      : [undefined];

    const [childBusiness] = opts?.childBusinessAccount
      ? await db
          .insert(accounts)
          .values({
            clientId: client.id,
            scenarioId: baseScenario.id,
            name: "Operating Account",
            category: "business",
            parentAccountId: businessAccount.id,
          })
          .returning()
      : [undefined];

    return {
      clientId: client.id,
      baseScenarioId: baseScenario.id,
      otherScenarioId: otherScenario?.id,
      businessAccountId: businessAccount.id,
      nonBusinessAccountId: nonBusiness?.id,
      childBusinessAccountId: childBusiness?.id,
    };
  }

  function makeReq(
    clientId: string,
    accountId: string,
    init?: { method?: string; body?: object; scenarioId?: string },
  ): Request {
    const qs = init?.scenarioId ? `?scenarioId=${init.scenarioId}` : "";
    return new Request(
      `http://localhost/api/clients/${clientId}/accounts/${accountId}/flow-overrides${qs}`,
      {
        method: init?.method ?? "GET",
        headers: init?.body
          ? { "content-type": "application/json" }
          : undefined,
        body: init?.body ? JSON.stringify(init.body) : undefined,
      },
    );
  }

  beforeEach(async () => {
    await cleanup();
    vi.mocked(helpers.requireOrgId).mockResolvedValue(TEST_FIRM);
    vi.mocked(helpers.getOrgId).mockResolvedValue(TEST_FIRM);
  });

  // ── GET ────────────────────────────────────────────────────────────────────

  it("GET with no rows returns empty array", async () => {
    const { clientId, businessAccountId } = await setup();
    const res = await GET(
      makeReq(clientId, businessAccountId) as never,
      { params: Promise.resolve({ id: clientId, accountId: businessAccountId }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ overrides: [] });
  });

  it("PUT then GET roundtrips overrides (decimals parsed back to numbers)", async () => {
    const { clientId, businessAccountId } = await setup();
    const putRes = await PUT(
      makeReq(clientId, businessAccountId, {
        method: "PUT",
        body: {
          overrides: [
            { year: 2030, incomeAmount: 50000, expenseAmount: 12000, distributionPercent: 0.5 },
            { year: 2031, incomeAmount: 60000, expenseAmount: null, distributionPercent: null },
          ],
        },
      }) as never,
      { params: Promise.resolve({ id: clientId, accountId: businessAccountId }) },
    );
    expect(putRes.status).toBe(200);
    const putBody = await putRes.json();
    expect(putBody).toEqual({ ok: true, count: 2 });

    const getRes = await GET(
      makeReq(clientId, businessAccountId) as never,
      { params: Promise.resolve({ id: clientId, accountId: businessAccountId }) },
    );
    expect(getRes.status).toBe(200);
    const body = await getRes.json();
    expect(body.overrides).toHaveLength(2);
    const byYear = Object.fromEntries(
      body.overrides.map((o: { year: number }) => [o.year, o]),
    );
    expect(byYear[2030]).toEqual({
      year: 2030,
      incomeAmount: 50000,
      expenseAmount: 12000,
      distributionPercent: 0.5,
    });
    expect(byYear[2031]).toEqual({
      year: 2031,
      incomeAmount: 60000,
      expenseAmount: null,
      distributionPercent: null,
    });
  });

  it("PUT replaces whole grid (rows missing from new body are deleted)", async () => {
    const { clientId, businessAccountId } = await setup();
    await PUT(
      makeReq(clientId, businessAccountId, {
        method: "PUT",
        body: { overrides: [{ year: 2030, incomeAmount: 1 }, { year: 2031, incomeAmount: 2 }] },
      }) as never,
      { params: Promise.resolve({ id: clientId, accountId: businessAccountId }) },
    );
    // Replace with a single row at a brand-new year.
    await PUT(
      makeReq(clientId, businessAccountId, {
        method: "PUT",
        body: { overrides: [{ year: 2040, incomeAmount: 99 }] },
      }) as never,
      { params: Promise.resolve({ id: clientId, accountId: businessAccountId }) },
    );

    const res = await GET(
      makeReq(clientId, businessAccountId) as never,
      { params: Promise.resolve({ id: clientId, accountId: businessAccountId }) },
    );
    const body = await res.json();
    expect(body.overrides).toHaveLength(1);
    expect(body.overrides[0]).toEqual({
      year: 2040,
      incomeAmount: 99,
      expenseAmount: null,
      distributionPercent: null,
    });
  });

  // ── Scenario scoping ──────────────────────────────────────────────────────

  it("PUT with ?scenarioId stores rows scoped to that scenario; base GET stays empty", async () => {
    const { clientId, businessAccountId, otherScenarioId } = await setup({
      extraScenario: true,
    });
    await PUT(
      makeReq(clientId, businessAccountId, {
        method: "PUT",
        scenarioId: otherScenarioId,
        body: { overrides: [{ year: 2032, incomeAmount: 77000 }] },
      }) as never,
      { params: Promise.resolve({ id: clientId, accountId: businessAccountId }) },
    );

    const baseGet = await GET(
      makeReq(clientId, businessAccountId) as never,
      { params: Promise.resolve({ id: clientId, accountId: businessAccountId }) },
    );
    expect((await baseGet.json()).overrides).toEqual([]);

    const scenarioGet = await GET(
      makeReq(clientId, businessAccountId, { scenarioId: otherScenarioId }) as never,
      { params: Promise.resolve({ id: clientId, accountId: businessAccountId }) },
    );
    const scenarioBody = await scenarioGet.json();
    expect(scenarioBody.overrides).toHaveLength(1);
    expect(scenarioBody.overrides[0].year).toBe(2032);
    expect(scenarioBody.overrides[0].incomeAmount).toBe(77000);
  });

  it("PUT with a non-existent scenarioId returns 404", async () => {
    const { clientId, businessAccountId } = await setup();
    const res = await PUT(
      makeReq(clientId, businessAccountId, {
        method: "PUT",
        scenarioId: "00000000-0000-0000-0000-000000000000",
        body: { overrides: [] },
      }) as never,
      { params: Promise.resolve({ id: clientId, accountId: businessAccountId }) },
    );
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/Scenario not found/);
  });

  // ── Validation & guard rails ──────────────────────────────────────────────

  it("non-business account returns 400", async () => {
    const { clientId, nonBusinessAccountId } = await setup({
      nonBusinessAccount: true,
    });
    const res = await GET(
      makeReq(clientId, nonBusinessAccountId!) as never,
      {
        params: Promise.resolve({
          id: clientId,
          accountId: nonBusinessAccountId!,
        }),
      },
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/top-level business/);
  });

  it("child business account (parentAccountId set) returns 400", async () => {
    const { clientId, childBusinessAccountId } = await setup({
      childBusinessAccount: true,
    });
    const res = await GET(
      makeReq(clientId, childBusinessAccountId!) as never,
      {
        params: Promise.resolve({
          id: clientId,
          accountId: childBusinessAccountId!,
        }),
      },
    );
    expect(res.status).toBe(400);
  });

  it("cross-firm access returns 404 (client not found)", async () => {
    // Seed under OTHER_FIRM, then call with TEST_FIRM auth — client lookup
    // misses, so the route returns 404 without leaking that the row exists.
    const { clientId, businessAccountId } = await setup({ firmId: OTHER_FIRM });
    const res = await GET(
      makeReq(clientId, businessAccountId) as never,
      { params: Promise.resolve({ id: clientId, accountId: businessAccountId }) },
    );
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/Client not found/);
  });

  it("PUT with malformed body returns 400", async () => {
    const { clientId, businessAccountId } = await setup();
    const res = await PUT(
      makeReq(clientId, businessAccountId, {
        method: "PUT",
        body: { overrides: [{ year: "not-a-year" }] } as never,
      }) as never,
      { params: Promise.resolve({ id: clientId, accountId: businessAccountId }) },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid body");
    expect(body.issues).toBeDefined();
  });

  it("PUT with duplicate years returns 400", async () => {
    const { clientId, businessAccountId } = await setup();
    const res = await PUT(
      makeReq(clientId, businessAccountId, {
        method: "PUT",
        body: {
          overrides: [
            { year: 2030, incomeAmount: 1 },
            { year: 2030, incomeAmount: 2 },
          ],
        },
      }) as never,
      { params: Promise.resolve({ id: clientId, accountId: businessAccountId }) },
    );
    expect(res.status).toBe(400);
  });

  it("PUT records audit row", async () => {
    const audit = await import("@/lib/audit");
    vi.mocked(audit.recordAudit).mockClear();

    const { clientId, businessAccountId } = await setup();
    await PUT(
      makeReq(clientId, businessAccountId, {
        method: "PUT",
        body: { overrides: [{ year: 2030, incomeAmount: 50 }] },
      }) as never,
      { params: Promise.resolve({ id: clientId, accountId: businessAccountId }) },
    );

    expect(audit.recordAudit).toHaveBeenCalledTimes(1);
    expect(audit.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "account_flow_overrides.replace",
        resourceType: "account_flow_overrides",
        resourceId: businessAccountId,
        clientId,
        firmId: TEST_FIRM,
        metadata: expect.objectContaining({ scenarioId: null, count: 1 }),
      }),
    );
  });
});
