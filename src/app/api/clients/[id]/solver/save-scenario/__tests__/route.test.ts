import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db-helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db-helpers")>();
  return { ...actual, requireOrgId: vi.fn() };
});
vi.mock("@/lib/db-scoping", () => ({ findClientInFirm: vi.fn() }));
vi.mock("@/lib/scenario/loader", () => ({
  loadEffectiveTree: vi.fn(),
}));
vi.mock("@/lib/scenario/changes", () => ({
  loadScenarioChanges: vi.fn().mockResolvedValue([]),
  loadScenarioToggleGroups: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/scenario/changes-writer", () => ({
  applyEntityEdit: vi.fn().mockResolvedValue(undefined),
  applyEntityAdd: vi.fn().mockResolvedValue({ targetId: "x" }),
  applyEntityRemove: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/authz", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authz")>();
  return { ...actual, requireActiveSubscriptionForFirm: vi.fn().mockResolvedValue(undefined) };
});

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn().mockResolvedValue({ userId: "user_test" }),
}));
// requireClientEditAccess is now the gate. Delegate to the already-mocked
// findClientInFirm so tests that set findClientInFirm → null exercise the 403 path.
vi.mock("@/lib/clients/authz", () => ({
  requireClientEditAccess: vi.fn().mockImplementation(async (clientId: string) => {
    const { findClientInFirm } = await import("@/lib/db-scoping");
    const { ForbiddenError } = await import("@/lib/authz");
    const client = await findClientInFirm(clientId, "00000000-0000-4000-8000-000000000099");
    if (!client) throw new ForbiddenError("Client not found or no access");
    return { firmId: "00000000-0000-4000-8000-000000000099", access: "own" as const };
  }),
}));

const insertedScenarios: unknown[] = [];
const insertedChanges: unknown[] = [];
const insertedGroups: unknown[] = [];
// PUT-path fixtures: the scenario lookup result and any seed updates.
let scenarioLookup: unknown[] = [];
const seedUpdates: unknown[] = [];
vi.mock("@/db", () => ({
  db: {
    // Used by PUT to verify the scenario belongs to the client + isn't base.
    select: (_cols?: unknown) => ({
      from: (_table: unknown) => ({
        where: async () => scenarioLookup,
      }),
    }),
    transaction: vi.fn(async (fn) => {
      const tx = {
        insert: (_table: unknown) => ({
          values: (rows: unknown) => ({
            returning: async () => {
              if (Array.isArray(rows)) {
                const first = rows[0] as Record<string, unknown> | undefined;
                if (first && "opType" in first) {
                  insertedChanges.push(...rows);
                } else {
                  insertedGroups.push(...rows);
                }
                return rows;
              }
              insertedScenarios.push(rows);
              return [{ id: "new-scenario-id", ...(rows as object) }];
            },
          }),
        }),
        update: (_table: unknown) => ({
          set: (vals: unknown) => ({
            where: async () => {
              seedUpdates.push(vals);
            },
          }),
        }),
      };
      return await fn(tx);
    }),
  },
}));

import { POST, PUT } from "../route";
import { requireOrgId } from "@/lib/db-helpers";
import { findClientInFirm } from "@/lib/db-scoping";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { loadScenarioChanges, loadScenarioToggleGroups } from "@/lib/scenario/changes";
import {
  applyEntityEdit,
  applyEntityAdd,
  applyEntityRemove,
} from "@/lib/scenario/changes-writer";
import { recordAudit } from "@/lib/audit";

const CLIENT_ID = "00000000-0000-4000-8000-000000000001";
const FIRM_ID = "00000000-0000-4000-8000-000000000099";
const SCENARIO_ID = "11111111-1111-4111-8111-111111111111";

function makeRequest(body: unknown) {
  return new Request(
    `http://localhost/api/clients/${CLIENT_ID}/solver/save-scenario`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  ) as unknown as import("next/server").NextRequest;
}

const ctx = { params: Promise.resolve({ id: CLIENT_ID }) };

function makeUpdateRequest(body: unknown) {
  return new Request(
    `http://localhost/api/clients/${CLIENT_ID}/solver/save-scenario`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  ) as unknown as import("next/server").NextRequest;
}

beforeEach(() => {
  insertedScenarios.length = 0;
  insertedChanges.length = 0;
  insertedGroups.length = 0;
  seedUpdates.length = 0;
  scenarioLookup = [{ id: SCENARIO_ID, isBaseCase: false }];
  vi.mocked(requireOrgId).mockResolvedValue(FIRM_ID);
  vi.mocked(findClientInFirm).mockResolvedValue({ id: CLIENT_ID } as never);
  vi.mocked(loadScenarioChanges).mockResolvedValue([]);
  vi.mocked(loadScenarioToggleGroups).mockResolvedValue([]);
  vi.mocked(applyEntityEdit).mockClear();
  vi.mocked(applyEntityAdd).mockClear();
  vi.mocked(applyEntityRemove).mockClear();
  vi.mocked(loadEffectiveTree).mockResolvedValue({
    effectiveTree: {
      client: {
        firstName: "Cooper",
        lastName: "Smith",
        dateOfBirth: "1965-03-15",
        retirementAge: 65,
        retirementMonth: 1,
        planEndAge: 95,
        lifeExpectancy: 95,
        filingStatus: "single",
      },
      accounts: [],
      incomes: [],
      expenses: [],
      liabilities: [],
      savingsRules: [],
      withdrawalStrategy: [],
      planSettings: {} as never,
    },
    warnings: [],
  } as never);
});

describe("POST /api/clients/[id]/solver/save-scenario", () => {
  it("inserts a scenarios row and matching change rows for a single mutation", async () => {
    const res = await POST(
      makeRequest({
        source: "base",
        mutations: [{ kind: "retirement-age", person: "client", age: 67 }],
        name: "Retire at 67",
      }),
      ctx as never,
    );
    expect(res.status).toBe(200);
    expect(insertedScenarios).toHaveLength(1);
    expect(insertedChanges).toHaveLength(1);
    expect(insertedChanges[0]).toMatchObject({
      targetKind: "client",
      opType: "edit",
      payload: { retirementAge: { from: 65, to: 67 } },
    });
  });

  it("records an audit row with source: solver", async () => {
    await POST(
      makeRequest({
        source: "base",
        mutations: [{ kind: "retirement-age", person: "client", age: 67 }],
        name: "Retire at 67",
      }),
      ctx as never,
    );
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "scenario.create",
        metadata: expect.objectContaining({ source: "solver", mutationCount: 1 }),
      }),
    );
  });

  it("returns 400 when name is empty", async () => {
    const res = await POST(
      makeRequest({
        source: "base",
        mutations: [{ kind: "retirement-age", person: "client", age: 67 }],
        name: "",
      }),
      ctx as never,
    );
    expect(res.status).toBe(400);
  });

  it("returns 403 when the client is not in the caller's firm", async () => {
    vi.mocked(findClientInFirm).mockResolvedValue(null as never);
    const res = await POST(
      makeRequest({
        source: "base",
        mutations: [{ kind: "retirement-age", person: "client", age: 67 }],
        name: "x",
      }),
      ctx as never,
    );
    expect(res.status).toBe(403);
  });

  it("POST groups >=2 revocable-trust funding changes under one toggle group", async () => {
    const baseAccounts = [
      { id: "acct-1", category: "cash" as const, revocableTrustName: null, owners: [], name: "Checking", subType: "checking", value: 50000, basis: 0, growthRate: 0.02, rmdEnabled: false, titlingType: "jtwros" as const },
      { id: "acct-2", category: "real_estate" as const, revocableTrustName: null, owners: [], name: "Residence", subType: "primary", value: 500000, basis: 200000, growthRate: 0.03, rmdEnabled: false, titlingType: "jtwros" as const },
    ];
    vi.mocked(loadEffectiveTree).mockResolvedValue({
      effectiveTree: {
        client: {
          firstName: "Cooper",
          lastName: "Smith",
          dateOfBirth: "1965-03-15",
          retirementAge: 65,
          retirementMonth: 1,
          planEndAge: 95,
          lifeExpectancy: 95,
          filingStatus: "single",
        },
        accounts: baseAccounts,
        incomes: [], expenses: [], savingsRules: [], rothConversions: [],
        assetTransactions: [], reinvestments: [], gifts: [], externalBeneficiaries: [],
        entities: [],
        liabilities: [],
        withdrawalStrategy: [],
        planSettings: {} as never,
      },
    } as never);

    const res = await POST(
      makeRequest({
        source: "base",
        name: "Proposed Plan",
        mutations: [
          { kind: "account-upsert", id: "acct-1", value: { ...baseAccounts[0], revocableTrustName: "Family Trust" } },
          { kind: "account-upsert", id: "acct-2", value: { ...baseAccounts[1], revocableTrustName: "Family Trust" } },
        ],
      }),
      ctx,
    );

    expect(res.status).toBe(200);
    // One toggle group created with the brainstormed label.
    expect(insertedGroups).toHaveLength(1);
    expect((insertedGroups[0] as { name: string }).name).toBe("Move into Family Trust");
    const groupId = (insertedGroups[0] as { id: string }).id;
    expect((insertedGroups[0] as { defaultOn: boolean }).defaultOn).toBe(true);
    // Both account changes tagged with it.
    const tagged = insertedChanges.filter(
      (c) => (c as { targetKind: string }).targetKind === "account",
    );
    expect(tagged).toHaveLength(2);
    for (const c of tagged) {
      expect((c as { toggleGroupId: string }).toggleGroupId).toBe(groupId);
    }
  });
});

describe("PUT /api/clients/[id]/solver/save-scenario", () => {
  it("folds a mutation into the existing scenario via an entity edit", async () => {
    const res = await PUT(
      makeUpdateRequest({
        scenarioId: SCENARIO_ID,
        mutations: [{ kind: "retirement-age", person: "client", age: 67 }],
      }),
      ctx as never,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ scenarioId: SCENARIO_ID });
    expect(applyEntityEdit).toHaveBeenCalledWith(
      expect.objectContaining({
        scenarioId: SCENARIO_ID,
        firmId: FIRM_ID,
        targetKind: "client",
        targetId: CLIENT_ID,
        desiredFields: expect.objectContaining({ retirementAge: 67 }),
      }),
    );
  });

  it("preserves the scenario's already-edited sibling fields on a partial re-edit", async () => {
    // The scenario already overrides retirementAge AND lifeExpectancy; the
    // solver only re-touches retirementAge. The rewrite must still carry
    // lifeExpectancy (read off the working tree) so it isn't dropped.
    vi.mocked(loadScenarioChanges).mockResolvedValue([
      {
        id: "c1",
        scenarioId: SCENARIO_ID,
        opType: "edit",
        targetKind: "client",
        targetId: CLIENT_ID,
        payload: {
          retirementAge: { from: 65, to: 70 },
          lifeExpectancy: { from: 95, to: 90 },
        },
        toggleGroupId: null,
        orderIndex: 0,
      },
    ] as never);
    const res = await PUT(
      makeUpdateRequest({
        scenarioId: SCENARIO_ID,
        mutations: [{ kind: "retirement-age", person: "client", age: 67 }],
      }),
      ctx as never,
    );
    expect(res.status).toBe(200);
    const call = vi.mocked(applyEntityEdit).mock.calls[0][0];
    expect(Object.keys(call.desiredFields).sort()).toEqual([
      "lifeExpectancy",
      "retirementAge",
    ]);
    expect(call.desiredFields.retirementAge).toBe(67);
  });

  it("replaces the scenario's stored MC seed when one is supplied", async () => {
    await PUT(
      makeUpdateRequest({
        scenarioId: SCENARIO_ID,
        mutations: [{ kind: "retirement-age", person: "client", age: 67 }],
        seed: 42,
      }),
      ctx as never,
    );
    expect(seedUpdates).toContainEqual({ monteCarloSeed: 42 });
  });

  it("records a scenario_change.upsert audit with source: solver", async () => {
    await PUT(
      makeUpdateRequest({
        scenarioId: SCENARIO_ID,
        mutations: [{ kind: "retirement-age", person: "client", age: 67 }],
      }),
      ctx as never,
    );
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "scenario_change.upsert",
        resourceId: SCENARIO_ID,
        metadata: expect.objectContaining({ source: "solver", mutationCount: 1 }),
      }),
    );
  });

  it("returns 404 when the scenario isn't found for the client", async () => {
    scenarioLookup = [];
    const res = await PUT(
      makeUpdateRequest({
        scenarioId: SCENARIO_ID,
        mutations: [{ kind: "retirement-age", person: "client", age: 67 }],
      }),
      ctx as never,
    );
    expect(res.status).toBe(404);
    expect(applyEntityEdit).not.toHaveBeenCalled();
  });

  it("refuses to update the base case", async () => {
    scenarioLookup = [{ id: SCENARIO_ID, isBaseCase: true }];
    const res = await PUT(
      makeUpdateRequest({
        scenarioId: SCENARIO_ID,
        mutations: [{ kind: "retirement-age", person: "client", age: 67 }],
      }),
      ctx as never,
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when scenarioId is missing", async () => {
    const res = await PUT(
      makeUpdateRequest({
        mutations: [{ kind: "retirement-age", person: "client", age: 67 }],
      }),
      ctx as never,
    );
    expect(res.status).toBe(400);
  });

  it("returns 403 when the client is not in the caller's firm", async () => {
    vi.mocked(findClientInFirm).mockResolvedValue(null as never);
    const res = await PUT(
      makeUpdateRequest({
        scenarioId: SCENARIO_ID,
        mutations: [{ kind: "retirement-age", person: "client", age: 67 }],
      }),
      ctx as never,
    );
    expect(res.status).toBe(403);
  });

  it("PUT creates a toggle group and tags funding edits with it", async () => {
    const baseAccounts = [
      { id: "acct-1", category: "cash" as const, revocableTrustName: null, owners: [], name: "Checking", subType: "checking", value: 50000, basis: 0, growthRate: 0.02, rmdEnabled: false, titlingType: "jtwros" as const },
      { id: "acct-2", category: "real_estate" as const, revocableTrustName: null, owners: [], name: "Residence", subType: "primary", value: 500000, basis: 200000, growthRate: 0.03, rmdEnabled: false, titlingType: "jtwros" as const },
    ];
    vi.mocked(loadEffectiveTree).mockResolvedValue({
      effectiveTree: {
        client: {
          firstName: "Cooper",
          lastName: "Smith",
          dateOfBirth: "1965-03-15",
          retirementAge: 65,
          retirementMonth: 1,
          planEndAge: 95,
          lifeExpectancy: 95,
          filingStatus: "single",
        },
        accounts: baseAccounts,
        incomes: [], expenses: [], savingsRules: [], rothConversions: [],
        assetTransactions: [], reinvestments: [], gifts: [], externalBeneficiaries: [],
        entities: [],
        liabilities: [],
        withdrawalStrategy: [],
        planSettings: {} as never,
      },
    } as never);

    const res = await PUT(
      makeUpdateRequest({
        scenarioId: SCENARIO_ID,
        mutations: [
          { kind: "account-upsert", id: "acct-1", value: { ...baseAccounts[0], revocableTrustName: "Family Trust" } },
          { kind: "account-upsert", id: "acct-2", value: { ...baseAccounts[1], revocableTrustName: "Family Trust" } },
        ],
      }),
      ctx,
    );

    expect(res.status).toBe(200);
    expect(insertedGroups).toHaveLength(1);
    const groupId = (insertedGroups[0] as { id: string }).id;
    const editCalls = vi.mocked(applyEntityEdit).mock.calls.map((c) => c[0]);
    expect(editCalls).toHaveLength(2);
    for (const call of editCalls) {
      expect(call.toggleGroupId).toBe(groupId);
    }
  });

  it("PUT reuses an existing same-name group (idempotent re-save)", async () => {
    const baseAccounts = [
      { id: "acct-1", category: "cash" as const, revocableTrustName: null, owners: [], name: "Checking", subType: "checking", value: 50000, basis: 0, growthRate: 0.02, rmdEnabled: false, titlingType: "jtwros" as const },
      { id: "acct-2", category: "real_estate" as const, revocableTrustName: null, owners: [], name: "Residence", subType: "primary", value: 500000, basis: 200000, growthRate: 0.03, rmdEnabled: false, titlingType: "jtwros" as const },
    ];
    vi.mocked(loadEffectiveTree).mockResolvedValue({
      effectiveTree: {
        client: {
          firstName: "Cooper",
          lastName: "Smith",
          dateOfBirth: "1965-03-15",
          retirementAge: 65,
          retirementMonth: 1,
          planEndAge: 95,
          lifeExpectancy: 95,
          filingStatus: "single",
        },
        accounts: baseAccounts,
        incomes: [], expenses: [], savingsRules: [], rothConversions: [],
        assetTransactions: [], reinvestments: [], gifts: [], externalBeneficiaries: [],
        entities: [],
        liabilities: [],
        withdrawalStrategy: [],
        planSettings: {} as never,
      },
    } as never);
    vi.mocked(loadScenarioToggleGroups).mockResolvedValue([
      { id: "existing-gid", scenarioId: SCENARIO_ID, name: "Move into Family Trust", defaultOn: true, requiresGroupId: null, orderIndex: 0 },
    ] as never);

    await PUT(
      makeUpdateRequest({
        scenarioId: SCENARIO_ID,
        mutations: [
          { kind: "account-upsert", id: "acct-1", value: { ...baseAccounts[0], revocableTrustName: "Family Trust" } },
          { kind: "account-upsert", id: "acct-2", value: { ...baseAccounts[1], revocableTrustName: "Family Trust" } },
        ],
      }),
      ctx,
    );

    expect(insertedGroups).toHaveLength(0); // no duplicate created
    const editCalls = vi.mocked(applyEntityEdit).mock.calls.map((c) => c[0]);
    for (const call of editCalls) {
      expect(call.toggleGroupId).toBe("existing-gid");
    }
  });
});
