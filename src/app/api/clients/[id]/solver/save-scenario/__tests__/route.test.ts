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
// `gift_series` is the one piece of the client's plan that is scenario-
// PARTITIONED, so a scenario this route creates must be seeded from the source
// scenario's partition or the saved scenario projects with the client's
// recurring gifts missing — and promoting it deletes them from the base plan.
// Spied, not exercised: the copy's own behaviour is pinned in
// src/lib/scenario/__tests__/create-with-clone.test.ts. What this route owes is
// the CALL, with the right source partition.
vi.mock("@/lib/scenario/create-with-clone", () => ({
  cloneGiftSeriesIntoScenario: vi.fn().mockResolvedValue(undefined),
  cloneEntityFlowOverridesIntoScenario: vi.fn().mockResolvedValue(undefined),
  findBaseScenarioId: vi.fn().mockResolvedValue("22222222-2222-4222-8222-222222222222"),
}));
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
const insertedOverrides: unknown[] = [];
const insertedNotes: unknown[] = [];
const insertedNoteOwners: unknown[] = [];
const insertedNoteExtras: unknown[] = [];
/** Every DELETE and UPDATE the transaction issued, with the table it hit and
 *  the WHERE it carried — a replace is only proven by the pair. */
const deletes: { table: string; where: unknown }[] = [];
const updates: { table: string; values: unknown }[] = [];
// PUT-path fixtures: the scenario lookup result and any seed updates.
let scenarioLookup: unknown[] = [];
// Rows the pre-flight `notes_receivable` lookup hands back.
let existingNoteRows: unknown[] = [];
const seedUpdates: unknown[] = [];

/** Drizzle stamps every table object with its SQL name under this well-known
 *  symbol. Reading it keeps the fake db honest about WHICH table each statement
 *  hit; the previous version guessed from row shape, which cannot tell a
 *  toggle-group insert from a note-owner one. */
const DRIZZLE_NAME = Symbol.for("drizzle:Name");
function tableName(t: unknown): string {
  return (t as Record<symbol, string> | null)?.[DRIZZLE_NAME] ?? "";
}

/** Capture array for a table, by SQL name. A function declaration (not a map
 *  literal) because `vi.mock` factories are hoisted above the `const` arrays —
 *  the lookup has to happen when a statement runs, not when the mock is built. */
function sinkFor(name: string): unknown[] | undefined {
  return {
    scenario_changes: insertedChanges,
    scenario_toggle_groups: insertedGroups,
    entity_flow_overrides: insertedOverrides,
    notes_receivable: insertedNotes,
    note_receivable_owners: insertedNoteOwners,
    note_extra_payments: insertedNoteExtras,
  }[name];
}

vi.mock("@/db", () => {
  const insert = (table: unknown) => ({
    values: (rows: unknown) => {
      const name = tableName(table);
      if (name === "scenarios") {
        insertedScenarios.push(rows);
        const returned = [{ id: "new-scenario-id", ...(rows as object) }];
        return Object.assign(Promise.resolve(returned), {
          returning: async () => returned,
        });
      }
      const list = Array.isArray(rows) ? rows : [rows];
      const sink = sinkFor(name);
      // Louder than silently dropping: a table nobody captures is a test that
      // asserts nothing about the write it was meant to prove.
      if (!sink) throw new Error(`fake db: no capture sink for insert into "${name}"`);
      sink.push(...list);
      return Object.assign(Promise.resolve(list), { returning: async () => list });
    },
  });
  return {
    db: {
      // Used by PUT to verify the scenario belongs to the client + isn't base,
      // and by both verbs to look up the notes a mutation names.
      // Zero-arg on purpose: the route calls select() with a column map and
      // the extra argument is simply ignored, while an unused named param is a
      // lint warning for no gain.
      select: () => ({
        from: (table: unknown) => ({
          where: async () => {
            const name = tableName(table);
            if (name === "scenarios") return scenarioLookup;
            if (name === "notes_receivable") return existingNoteRows;
            return [];
          },
        }),
      }),
      transaction: vi.fn(async (fn) => {
        const tx = {
          select: () => ({ from: () => ({ where: async () => [] }) }),
          insert,
          delete: (table: unknown) => ({
            where: async (where: unknown) => {
              deletes.push({ table: tableName(table), where });
            },
          }),
          update: (table: unknown) => ({
            set: (values: unknown) => ({
              where: async () => {
                const name = tableName(table);
                updates.push({ table: name, values });
                if (name === "scenarios") seedUpdates.push(values);
              },
            }),
          }),
        };
        return await fn(tx);
      }),
    },
  };
});

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
import {
  cloneGiftSeriesIntoScenario,
  cloneEntityFlowOverridesIntoScenario,
  findBaseScenarioId,
} from "@/lib/scenario/create-with-clone";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const CLIENT_ID = "00000000-0000-4000-8000-000000000001";
const FIRM_ID = "00000000-0000-4000-8000-000000000099";
const SCENARIO_ID = "11111111-1111-4111-8111-111111111111";
const BASE_SCENARIO_ID = "22222222-2222-4222-8222-222222222222";
const ENTITY_ID = "33333333-3333-4333-8333-333333333333";
const NOTE_ID = "44444444-4444-4444-8444-444444444444";
const FAMILY_MEMBER_ID = "55555555-5555-4555-8555-555555555555";

/** A captured WHERE rendered as its bound params. Comparing drizzle SQL objects
 *  with toEqual prints thousands of lines of column metadata and hides the one
 *  thing under test; this prints one line. */
const dialect = new PgDialect();
const paramsOf = (predicate: unknown): unknown[] =>
  dialect.sqlToQuery(predicate as SQL).params;

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

/** The smallest tree the route will accept. Shared so a test that needs one
 *  extra collection spreads it in rather than restating the client block. */
const minimalTree = () => ({
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
});

beforeEach(() => {
  insertedScenarios.length = 0;
  insertedChanges.length = 0;
  insertedGroups.length = 0;
  insertedOverrides.length = 0;
  insertedNotes.length = 0;
  insertedNoteOwners.length = 0;
  insertedNoteExtras.length = 0;
  deletes.length = 0;
  updates.length = 0;
  seedUpdates.length = 0;
  existingNoteRows = [];
  scenarioLookup = [{ id: SCENARIO_ID, isBaseCase: false }];
  vi.mocked(cloneEntityFlowOverridesIntoScenario).mockClear();
  vi.mocked(requireOrgId).mockResolvedValue(FIRM_ID);
  vi.mocked(findClientInFirm).mockResolvedValue({ id: CLIENT_ID } as never);
  vi.mocked(loadScenarioChanges).mockResolvedValue([]);
  vi.mocked(loadScenarioToggleGroups).mockResolvedValue([]);
  vi.mocked(applyEntityEdit).mockClear();
  vi.mocked(applyEntityAdd).mockClear();
  vi.mocked(applyEntityRemove).mockClear();
  vi.mocked(cloneGiftSeriesIntoScenario).mockClear();
  vi.mocked(findBaseScenarioId).mockClear().mockResolvedValue(BASE_SCENARIO_ID);
  vi.mocked(loadEffectiveTree).mockResolvedValue({
    effectiveTree: minimalTree(),
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

  it("seeds the new scenario's recurring gifts from the base partition when saving off base", async () => {
    await POST(
      makeRequest({
        source: "base",
        mutations: [{ kind: "retirement-age", person: "client", age: 67 }],
        name: "Retire at 67",
      }),
      ctx as never,
    );

    expect(cloneGiftSeriesIntoScenario).toHaveBeenCalledWith(
      expect.anything(),
      {
        clientId: CLIENT_ID,
        fromScenarioId: BASE_SCENARIO_ID,
        toScenarioId: "new-scenario-id",
      },
    );
  });

  it("seeds from the SOURCE scenario's partition when saving off a named scenario", async () => {
    await POST(
      makeRequest({
        source: SCENARIO_ID,
        mutations: [{ kind: "retirement-age", person: "client", age: 67 }],
        name: "Retire at 67",
      }),
      ctx as never,
    );

    // No base lookup — the source scenario carries its own partition.
    expect(findBaseScenarioId).not.toHaveBeenCalled();
    expect(cloneGiftSeriesIntoScenario).toHaveBeenCalledWith(
      expect.anything(),
      {
        clientId: CLIENT_ID,
        fromScenarioId: SCENARIO_ID,
        toScenarioId: "new-scenario-id",
      },
    );
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

// ── Scenario-PARTITIONED tables ─────────────────────────────────────────────
//
// `entity_flow_overrides` and `notes_receivable` carry their own scenario_id
// and are not modelled as scenario_changes, so the changes-writer never sees
// them. What the solver saves for them, this route writes directly — or the
// advisor's trust flow grid and IDGT note vanish from the saved scenario, the
// same way an unseeded `gift_series` partition loses the client's recurring
// gifts.

const OTHER_ENTITY_ID = "66666666-6666-4666-8666-666666666666";

/** An IDGT installment note as the trust dialog would emit it. */
const saleNote = () => ({
  id: NOTE_ID,
  name: "IDGT installment note",
  faceValue: 500_000,
  basis: 500_000,
  interestRate: 0.042,
  paymentType: "interest_only_balloon" as const,
  startYear: 2027,
  startMonth: 6,
  termMonths: 108,
  linkedTrustEntityId: ENTITY_ID,
  owners: [
    { kind: "family_member", familyMemberId: FAMILY_MEMBER_ID, percent: 1 },
  ],
  extraPayments: [{ year: 2030, type: "lump_sum", amount: 50_000 }],
});

function treeWith(extra: Record<string, unknown>) {
  vi.mocked(loadEffectiveTree).mockResolvedValue({
    effectiveTree: { ...minimalTree(), ...extra },
    warnings: [],
  } as never);
}

const overrideDeletes = () =>
  deletes.filter((d) => d.table === "entity_flow_overrides");

describe("POST save-scenario — scenario-partitioned tables", () => {
  it("clones the source scenario's entity flow overrides into the new scenario", async () => {
    await POST(
      makeRequest({
        source: SCENARIO_ID,
        mutations: [{ kind: "retirement-age", person: "client", age: 67 }],
        name: "Retire at 67",
      }),
      ctx as never,
    );

    // Same partition hazard gift_series has: without this the saved scenario
    // projects the trust on base+growth instead of the advisor's grid.
    expect(cloneEntityFlowOverridesIntoScenario).toHaveBeenCalledWith(
      expect.anything(),
      { fromScenarioId: SCENARIO_ID, toScenarioId: "new-scenario-id" },
    );
  });

  it("replaces the whole grid for each entity an override mutation touched", async () => {
    treeWith({
      entityFlowOverrides: [
        { entityId: ENTITY_ID, year: 2030, incomeAmount: 50_000, expenseAmount: null, distributionPercent: null },
        { entityId: ENTITY_ID, year: 2031, incomeAmount: 60_000, expenseAmount: null, distributionPercent: 0.045 },
        { entityId: OTHER_ENTITY_ID, year: 2030, incomeAmount: 10_000, expenseAmount: null, distributionPercent: null },
      ],
    });

    const res = await POST(
      makeRequest({
        source: SCENARIO_ID,
        name: "Bigger trust income",
        mutations: [
          {
            kind: "entity-flow-override-upsert",
            entityId: ENTITY_ID,
            year: 2030,
            value: { incomeAmount: 99_000, expenseAmount: null, distributionPercent: null },
          },
        ],
      }),
      ctx as never,
    );

    expect(res.status).toBe(200);
    // Per-ENTITY replace, because per-entity is the granularity the loader
    // inherits at: an entity with zero scenario rows takes base's whole grid.
    expect(overrideDeletes()).toHaveLength(1);
    expect(paramsOf(overrideDeletes()[0].where)).toEqual([
      "new-scenario-id",
      ENTITY_ID,
    ]);

    // The untouched year rides along — writing only 2030 would leave 2031
    // inherited from base and silently diverging from what the advisor saw.
    const rows = insertedOverrides as Record<string, unknown>[];
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.year).sort()).toEqual([2030, 2031]);
    for (const r of rows) expect(r.scenarioId).toBe("new-scenario-id");

    const y2030 = rows.find((r) => r.year === 2030)!;
    // decimal columns — Drizzle wants strings, and a number here round-trips
    // back out as one the engine concatenates.
    expect(y2030.incomeAmount).toBe("99000");
    expect(typeof y2030.incomeAmount).toBe("string");
    const y2031 = rows.find((r) => r.year === 2031)!;
    expect(y2031.incomeAmount).toBe("60000");
    expect(y2031.distributionPercent).toBe("0.045");
  });

  it("writes a note receivable to the base partition, gated by a group the new scenario owns", async () => {
    const res = await POST(
      makeRequest({
        source: SCENARIO_ID,
        name: "IDGT sale",
        mutations: [
          { kind: "note-receivable-upsert", id: NOTE_ID, value: saleNote() },
        ],
      }),
      ctx as never,
    );

    expect(res.status).toBe(200);

    // notes_receivable rows always live on the client's BASE partition — no
    // loader reads the table for a non-base scenario. Scenario visibility is
    // the toggle group's job.
    expect(findBaseScenarioId).toHaveBeenCalled();
    const notes = insertedNotes as Record<string, unknown>[];
    expect(notes).toHaveLength(1);
    expect(notes[0].scenarioId).toBe(BASE_SCENARIO_ID);
    expect(notes[0].clientId).toBe(CLIENT_ID);
    expect(notes[0].id).toBe(NOTE_ID);
    expect(notes[0].faceValue).toBe("500000");
    expect(notes[0].linkedTrustEntityId).toBe(ENTITY_ID);
    // `startYearRef` is a Postgres enum the wire schema never validates; a
    // producer that passes it through must not reach the column.
    expect(notes[0]).not.toHaveProperty("startYearRef");

    const groups = insertedGroups as Record<string, unknown>[];
    expect(groups).toHaveLength(1);
    expect(groups[0].scenarioId).toBe("new-scenario-id");
    expect(groups[0].defaultOn).toBe(true);
    expect(notes[0].toggleGroupId).toBe(groups[0].id);

    // Both child tables, which the sale-to-trust route never writes.
    expect(insertedNoteOwners).toEqual([
      {
        noteReceivableId: NOTE_ID,
        familyMemberId: FAMILY_MEMBER_ID,
        entityId: null,
        externalBeneficiaryId: null,
        percent: "1",
      },
    ]);
    expect(insertedNoteExtras).toEqual([
      {
        noteReceivableId: NOTE_ID,
        year: 2030,
        type: "lump_sum",
        amount: "50000",
      },
    ]);
  });

  it("refuses to rewrite a note the new scenario does not own", async () => {
    // A note already on the base partition with no gate is the BASE PLAN's.
    // Overwriting it here would change base and every other scenario.
    existingNoteRows = [{ id: NOTE_ID, toggleGroupId: null }];

    const res = await POST(
      makeRequest({
        source: SCENARIO_ID,
        name: "IDGT sale",
        mutations: [
          { kind: "note-receivable-upsert", id: NOTE_ID, value: saleNote() },
        ],
      }),
      ctx as never,
    );

    expect(res.status).toBe(400);
    expect(insertedScenarios).toHaveLength(0);
    expect(insertedNotes).toHaveLength(0);
  });
});

describe("PUT save-scenario — scenario-partitioned tables", () => {
  it("replaces the entity's grid in the scenario it folds into", async () => {
    treeWith({
      entityFlowOverrides: [
        { entityId: ENTITY_ID, year: 2030, incomeAmount: 50_000, expenseAmount: null, distributionPercent: null },
      ],
    });

    const res = await PUT(
      makeUpdateRequest({
        scenarioId: SCENARIO_ID,
        mutations: [
          {
            kind: "entity-flow-override-upsert",
            entityId: ENTITY_ID,
            year: 2031,
            value: { incomeAmount: 77_000, expenseAmount: null, distributionPercent: null },
          },
        ],
      }),
      ctx as never,
    );

    expect(res.status).toBe(200);
    expect(paramsOf(overrideDeletes()[0].where)).toEqual([SCENARIO_ID, ENTITY_ID]);
    const rows = insertedOverrides as Record<string, unknown>[];
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r.scenarioId).toBe(SCENARIO_ID);
    expect(rows.find((r) => r.year === 2031)!.incomeAmount).toBe("77000");
  });

  it("updates a note the scenario already owns instead of inserting a second one", async () => {
    vi.mocked(loadScenarioToggleGroups).mockResolvedValue([
      { id: "grp-1", scenarioId: SCENARIO_ID, name: "IDGT installment note", defaultOn: true, requiresGroupId: null, orderIndex: 0 },
    ] as never);
    existingNoteRows = [{ id: NOTE_ID, toggleGroupId: "grp-1" }];

    const res = await PUT(
      makeUpdateRequest({
        scenarioId: SCENARIO_ID,
        mutations: [
          {
            kind: "note-receivable-upsert",
            id: NOTE_ID,
            value: { ...saleNote(), faceValue: 600_000 },
          },
        ],
      }),
      ctx as never,
    );

    expect(res.status).toBe(200);
    // Re-save is idempotent: no duplicate note row, no second toggle group.
    expect(insertedNotes).toHaveLength(0);
    expect(insertedGroups).toHaveLength(0);
    const noteUpdate = updates.find((u) => u.table === "notes_receivable");
    expect(noteUpdate?.values).toMatchObject({ faceValue: "600000" });

    // Children are replaced wholesale, like the canonical note PATCH does.
    expect(deletes.map((d) => d.table)).toEqual(
      expect.arrayContaining(["note_receivable_owners", "note_extra_payments"]),
    );
    expect(insertedNoteOwners).toHaveLength(1);
    expect(insertedNoteExtras).toHaveLength(1);
  });

  it("refuses to remove a note that belongs to the base plan", async () => {
    existingNoteRows = [{ id: NOTE_ID, toggleGroupId: null }];

    const res = await PUT(
      makeUpdateRequest({
        scenarioId: SCENARIO_ID,
        mutations: [{ kind: "note-receivable-upsert", id: NOTE_ID, value: null }],
      }),
      ctx as never,
    );

    expect(res.status).toBe(400);
    expect(deletes.filter((d) => d.table === "notes_receivable")).toHaveLength(0);
  });
});

// ── Duplicate note mutations in one save ────────────────────────────────────
//
// The solver's mutation list is a keyed map flattened to an array, so it can
// legitimately carry two mutations for the same note id. apply-mutations.ts
// filters by id before pushing; the writer has to collapse the same way or an
// upsert+upsert pair inserts the same primary key twice and an upsert+delete
// pair persists a note the advisor removed.

const noteDeletes = () => deletes.filter((d) => d.table === "notes_receivable");
const noteUpdates = () => updates.filter((u) => u.table === "notes_receivable");

describe("save-scenario — duplicate note mutations collapse to the last", () => {
  it("POST writes one row carrying the LAST value when a note is upserted twice", async () => {
    const res = await POST(
      makeRequest({
        source: SCENARIO_ID,
        name: "IDGT sale",
        mutations: [
          { kind: "note-receivable-upsert", id: NOTE_ID, value: saleNote() },
          {
            kind: "note-receivable-upsert",
            id: NOTE_ID,
            value: { ...saleNote(), faceValue: 700_000 },
          },
        ],
      }),
      ctx as never,
    );

    expect(res.status).toBe(200);
    // Two inserts would both carry `id: NOTE_ID` and violate the PK, 500ing
    // the entire save.
    const notes = insertedNotes as Record<string, unknown>[];
    expect(notes).toHaveLength(1);
    expect(notes[0].faceValue).toBe("700000");
    expect(insertedGroups).toHaveLength(1);
    // Children are written once, for the surviving mutation only.
    expect(insertedNoteOwners).toHaveLength(1);
    expect(insertedNoteExtras).toHaveLength(1);
  });

  it("POST writes nothing when an upsert is followed by a delete of the same note", async () => {
    const res = await POST(
      makeRequest({
        source: SCENARIO_ID,
        name: "IDGT sale, undone",
        mutations: [
          { kind: "note-receivable-upsert", id: NOTE_ID, value: saleNote() },
          { kind: "note-receivable-upsert", id: NOTE_ID, value: null },
        ],
      }),
      ctx as never,
    );

    expect(res.status).toBe(200);
    // The delete is last, so the note never existed in this scenario. Nothing
    // to insert and nothing to delete — the row was never created.
    expect(insertedNotes).toHaveLength(0);
    expect(insertedGroups).toHaveLength(0);
    expect(noteDeletes()).toHaveLength(0);
  });

  it("PUT deletes the owned note when an upsert is followed by a delete", async () => {
    vi.mocked(loadScenarioToggleGroups).mockResolvedValue([
      { id: "grp-1", scenarioId: SCENARIO_ID, name: "IDGT installment note", defaultOn: true, requiresGroupId: null, orderIndex: 0 },
    ] as never);
    existingNoteRows = [{ id: NOTE_ID, toggleGroupId: "grp-1" }];

    const res = await PUT(
      makeUpdateRequest({
        scenarioId: SCENARIO_ID,
        mutations: [
          {
            kind: "note-receivable-upsert",
            id: NOTE_ID,
            value: { ...saleNote(), faceValue: 700_000 },
          },
          { kind: "note-receivable-upsert", id: NOTE_ID, value: null },
        ],
      }),
      ctx as never,
    );

    expect(res.status).toBe(200);
    // Without the collapse the upsert would run first and the delete second —
    // or worse, the delete would be skipped entirely. Only the delete may land.
    expect(noteDeletes()).toHaveLength(1);
    expect(paramsOf(noteDeletes()[0].where)).toEqual([NOTE_ID]);
    expect(noteUpdates()).toHaveLength(0);
    expect(insertedNoteOwners).toHaveLength(0);
  });

  it("PUT keeps the last value when a note is upserted twice", async () => {
    vi.mocked(loadScenarioToggleGroups).mockResolvedValue([
      { id: "grp-1", scenarioId: SCENARIO_ID, name: "IDGT installment note", defaultOn: true, requiresGroupId: null, orderIndex: 0 },
    ] as never);
    existingNoteRows = [{ id: NOTE_ID, toggleGroupId: "grp-1" }];

    await PUT(
      makeUpdateRequest({
        scenarioId: SCENARIO_ID,
        mutations: [
          { kind: "note-receivable-upsert", id: NOTE_ID, value: saleNote() },
          {
            kind: "note-receivable-upsert",
            id: NOTE_ID,
            value: { ...saleNote(), faceValue: 700_000 },
          },
        ],
      }),
      ctx as never,
    );

    expect(noteUpdates()).toHaveLength(1);
    expect(noteUpdates()[0].values).toMatchObject({ faceValue: "700000" });
  });
});

// ── Saving the same solver state as a scenario twice ────────────────────────

describe("POST save-scenario — a note another scenario already gates", () => {
  it("forks a fresh row under the new scenario instead of 400ing", async () => {
    // "Save as scenario" #1 created this row and gated it with ITS toggle
    // group. The solver's in-memory mutation list still names the same note id,
    // so "Save as scenario" a second time must work — it is a normal flow.
    existingNoteRows = [{ id: NOTE_ID, toggleGroupId: "grp-from-scenario-1" }];

    const res = await POST(
      makeRequest({
        source: SCENARIO_ID,
        name: "IDGT sale, take two",
        mutations: [
          { kind: "note-receivable-upsert", id: NOTE_ID, value: saleNote() },
        ],
      }),
      ctx as never,
    );

    expect(res.status).toBe(200);
    const notes = insertedNotes as Record<string, unknown>[];
    expect(notes).toHaveLength(1);
    // A FRESH row id — reusing NOTE_ID would collide with the existing PK.
    expect(notes[0].id).not.toBe(NOTE_ID);
    expect(notes[0].id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );

    // Gated by the NEW scenario's own group, so the fork shows here.
    const groups = insertedGroups as Record<string, unknown>[];
    expect(groups).toHaveLength(1);
    expect(groups[0].scenarioId).toBe("new-scenario-id");
    expect(notes[0].toggleGroupId).toBe(groups[0].id);

    // The original is left completely alone — it is still scenario 1's, and it
    // is invisible here because its group is not one of this scenario's.
    expect(noteUpdates()).toHaveLength(0);
    expect(noteDeletes()).toHaveLength(0);

    // Children hang off the fork, not the original.
    expect(insertedNoteOwners).toEqual([
      {
        noteReceivableId: notes[0].id,
        familyMemberId: FAMILY_MEMBER_ID,
        entityId: null,
        externalBeneficiaryId: null,
        percent: "1",
      },
    ]);
    expect((insertedNoteExtras as Record<string, unknown>[])[0].noteReceivableId)
      .toBe(notes[0].id);
  });

  it("still refuses an UNGATED note — that one really is the base plan's", async () => {
    // toggleGroupId null means the note is visible in every scenario. Rewriting
    // it from inside one would change all of them.
    existingNoteRows = [{ id: NOTE_ID, toggleGroupId: null }];

    const res = await POST(
      makeRequest({
        source: SCENARIO_ID,
        name: "IDGT sale",
        mutations: [
          { kind: "note-receivable-upsert", id: NOTE_ID, value: saleNote() },
        ],
      }),
      ctx as never,
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ noteIds: [NOTE_ID] });
    expect(insertedScenarios).toHaveLength(0);
    expect(insertedNotes).toHaveLength(0);
  });

  it("400s an owners array that does not sum to 1, before any write", async () => {
    // The wire schema rejects it (NOTE_RECEIVABLE_VALUE.owners), so the route
    // never reaches the point where `owners: []` could strip an existing note's
    // owner rows.
    const res = await POST(
      makeRequest({
        source: SCENARIO_ID,
        name: "IDGT sale",
        mutations: [
          {
            kind: "note-receivable-upsert",
            id: NOTE_ID,
            value: { ...saleNote(), owners: [] },
          },
        ],
      }),
      ctx as never,
    );

    expect(res.status).toBe(400);
    expect(insertedScenarios).toHaveLength(0);
  });
});

// ── A sale to trust is ONE toggleable unit ──────────────────────────────────
//
// `submitSaleToTrust` emits TWO mutations for one advisor action: the source
// account's owners flip to the trust, and a promissory note is created. Landing
// them under different toggle groups lets the advisor flip half a sale:
//   - note off   → the asset sits in the trust and nothing is owed for it;
//   - flip off   → the family keeps the asset AND collects the note payments,
//                  and the projection drains the linked trust's cash to pay them.
// The live sale-to-trust route already shares one freshly minted group across
// both writes (sale-to-trust/route.ts:12-17, :199, :235). The solver must match.
//
// Both assertions below check NON-NULL on each half before comparing them:
// `expect(a).toBe(b)` passes when both are null, which is exactly the pre-fix
// state of the account half.

const NOTE_ID_2 = "77777777-7777-4777-8777-777777777777";
const SALE_ACCOUNT_1 = "88888888-8888-4888-8888-888888888888";
const SALE_ACCOUNT_2 = "99999999-9999-4999-8999-999999999999";
/** An account changed by some OTHER lever in the same save. Its only job is to
 *  sit among the account drafts so a sale's note cannot be paired by position. */
const UNRELATED_ACCOUNT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const saleAccount = (id: string, name: string) => ({
  id,
  name,
  category: "taxable" as const,
  subType: "brokerage",
  value: 500_000,
  basis: 200_000,
  growthRate: 0.05,
  rmdEnabled: false,
  titlingType: "jtwros" as const,
  revocableTrustName: null,
  owners: [
    { kind: "family_member" as const, familyMemberId: FAMILY_MEMBER_ID, percent: 1 },
  ],
});

/** The account half of a sale: owners become the trust, 100%. */
const soldToTrust = (a: ReturnType<typeof saleAccount>) => ({
  ...a,
  owners: [{ kind: "entity" as const, entityId: ENTITY_ID, percent: 1 }],
});

function treeWithAccounts(accounts: unknown[]) {
  vi.mocked(loadEffectiveTree).mockResolvedValue({
    effectiveTree: {
      ...minimalTree(),
      accounts,
      rothConversions: [],
      assetTransactions: [],
      reinvestments: [],
      gifts: [],
      externalBeneficiaries: [],
      entities: [],
    },
    warnings: [],
  } as never);
}

const accountChangeFor = (targetId: string) =>
  (insertedChanges as Record<string, unknown>[]).find(
    (c) => c.targetKind === "account" && c.targetId === targetId,
  );

const noteRowById = (id: string) =>
  (insertedNotes as Record<string, unknown>[]).find((n) => n.id === id);

const editCallFor = (targetId: string) =>
  vi
    .mocked(applyEntityEdit)
    .mock.calls.map((c) => c[0])
    .find((c) => c.targetId === targetId);

describe("save-scenario — a sale to trust saves as one toggleable unit", () => {
  it("POST puts the owner flip and its note under the SAME non-null toggle group", async () => {
    const acct = saleAccount(SALE_ACCOUNT_1, "Brokerage");
    treeWithAccounts([acct]);

    const res = await POST(
      makeRequest({
        source: "base",
        name: "IDGT sale",
        mutations: [
          { kind: "account-upsert", id: SALE_ACCOUNT_1, value: soldToTrust(acct) },
          {
            kind: "note-receivable-upsert",
            id: NOTE_ID,
            value: saleNote(),
            sourceAccountId: SALE_ACCOUNT_1,
          },
        ],
      }),
      ctx as never,
    );

    expect(res.status).toBe(200);

    const change = accountChangeFor(SALE_ACCOUNT_1) as { toggleGroupId: string | null };
    const note = noteRowById(NOTE_ID) as { toggleGroupId: string | null };
    expect(change).toBeDefined();
    expect(note).toBeDefined();
    // Non-null on BOTH halves first — a bare toBe() is green when both are null.
    expect(change.toggleGroupId).not.toBeNull();
    expect(note.toggleGroupId).not.toBeNull();
    expect(change.toggleGroupId).toBe(note.toggleGroupId);

    // Exactly one group, named for the advisor's action the way the live route
    // names it.
    const groups = insertedGroups as Record<string, unknown>[];
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe("Sell Brokerage to trust");
    expect(groups[0].defaultOn).toBe(true);
    expect(groups[0].id).toBe(change.toggleGroupId);

    // `sourceAccountId` is solver-wire routing, not a note column. The note
    // INSERT builds an explicit column list, so it cannot reach the table —
    // this ratchets that, the way the sibling `startYearRef` guard above does.
    expect(note).not.toHaveProperty("sourceAccountId");
  });

  it("PUT puts the owner flip and its note under the SAME non-null toggle group", async () => {
    const acct = saleAccount(SALE_ACCOUNT_1, "Brokerage");
    treeWithAccounts([acct]);

    const res = await PUT(
      makeUpdateRequest({
        scenarioId: SCENARIO_ID,
        mutations: [
          { kind: "account-upsert", id: SALE_ACCOUNT_1, value: soldToTrust(acct) },
          {
            kind: "note-receivable-upsert",
            id: NOTE_ID,
            value: saleNote(),
            sourceAccountId: SALE_ACCOUNT_1,
          },
        ],
      }),
      ctx as never,
    );

    expect(res.status).toBe(200);

    const edit = editCallFor(SALE_ACCOUNT_1);
    const note = noteRowById(NOTE_ID) as { toggleGroupId: string | null };
    expect(edit).toBeDefined();
    expect(note).toBeDefined();
    expect(edit!.toggleGroupId ?? null).not.toBeNull();
    expect(note.toggleGroupId).not.toBeNull();
    expect(edit!.toggleGroupId).toBe(note.toggleGroupId);

    const groups = insertedGroups as Record<string, unknown>[];
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe("Sell Brokerage to trust");
  });

  it("POST gives TWO sales to the SAME trust two different groups", async () => {
    // The discriminating scope. A heuristic that pairs a note to whichever
    // account now has owners [{entity: T, 100%}] cannot tell these two sales
    // apart — an advisor selling two assets to one IDGT is ordinary.
    const a1 = saleAccount(SALE_ACCOUNT_1, "Brokerage");
    const a2 = saleAccount(SALE_ACCOUNT_2, "Rental");
    const other = saleAccount(UNRELATED_ACCOUNT, "Savings");
    treeWithAccounts([a1, a2, other]);

    // ORDER IS THE POINT. The account mutations are declared [A2, unrelated,
    // A1] while the notes are declared [note→A1, note→A2], so declaration
    // order and POSITION disagree in both directions:
    //   i-th note ↔ i-th account draft     → note1↔A2, note2↔unrelated  ✗
    //   i-th note ↔ i-th from the end      → note1↔A1, note2↔unrelated  ✗
    // Only reading the declared `sourceAccountId` pairs them correctly. With
    // the two lists in step, a positional implementation that never reads the
    // field passes this scope — which is how the committed version of this
    // test pinned "one group per sale" without pinning "the pairing is
    // DECLARED". Production diverges the same way: the solver's working set is
    // a keyed Map flattened in insertion order, so an unrelated earlier lever's
    // account-upsert sits ahead of a sale's note.
    const res = await POST(
      makeRequest({
        source: "base",
        name: "Two IDGT sales",
        mutations: [
          { kind: "account-upsert", id: SALE_ACCOUNT_2, value: soldToTrust(a2) },
          // Not a sale — some other lever revalued it in the same save.
          { kind: "account-upsert", id: UNRELATED_ACCOUNT, value: { ...other, value: 61_000 } },
          { kind: "account-upsert", id: SALE_ACCOUNT_1, value: soldToTrust(a1) },
          {
            kind: "note-receivable-upsert",
            id: NOTE_ID,
            value: saleNote(),
            sourceAccountId: SALE_ACCOUNT_1,
          },
          {
            kind: "note-receivable-upsert",
            id: NOTE_ID_2,
            value: { ...saleNote(), id: NOTE_ID_2, name: "Note from Rental sale" },
            sourceAccountId: SALE_ACCOUNT_2,
          },
        ],
      }),
      ctx as never,
    );

    expect(res.status).toBe(200);

    const change1 = accountChangeFor(SALE_ACCOUNT_1) as { toggleGroupId: string | null };
    const change2 = accountChangeFor(SALE_ACCOUNT_2) as { toggleGroupId: string | null };
    const note1 = noteRowById(NOTE_ID) as { toggleGroupId: string | null };
    const note2 = noteRowById(NOTE_ID_2) as { toggleGroupId: string | null };
    for (const half of [change1, change2, note1, note2]) {
      expect(half).toBeDefined();
      expect(half.toggleGroupId).not.toBeNull();
    }
    // Each sale pairs with ITS OWN note...
    expect(change1.toggleGroupId).toBe(note1.toggleGroupId);
    expect(change2.toggleGroupId).toBe(note2.toggleGroupId);
    // ...and the two sales stay independently toggleable.
    expect(change1.toggleGroupId).not.toBe(change2.toggleGroupId);

    // The unrelated account is swept into NEITHER sale's card.
    const unrelated = accountChangeFor(UNRELATED_ACCOUNT) as {
      toggleGroupId: string | null;
    };
    expect(unrelated).toBeDefined();
    expect(unrelated.toggleGroupId).toBeNull();

    const groups = insertedGroups as Record<string, unknown>[];
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.name).sort()).toEqual([
      "Sell Brokerage to trust",
      "Sell Rental to trust",
    ]);
    // orderIndex stays unique across every group source in the save.
    expect(groups.map((g) => g.orderIndex).sort()).toEqual([0, 1]);
  });

  it("PUT gives TWO sales to the SAME trust two different groups", async () => {
    const a1 = saleAccount(SALE_ACCOUNT_1, "Brokerage");
    const a2 = saleAccount(SALE_ACCOUNT_2, "Rental");
    const other = saleAccount(UNRELATED_ACCOUNT, "Savings");
    treeWithAccounts([a1, a2, other]);

    // ORDER IS THE POINT. The account mutations are declared [A2, unrelated,
    // A1] while the notes are declared [note→A1, note→A2], so declaration
    // order and POSITION disagree in both directions:
    //   i-th note ↔ i-th account draft     → note1↔A2, note2↔unrelated  ✗
    //   i-th note ↔ i-th from the end      → note1↔A1, note2↔unrelated  ✗
    // Only reading the declared `sourceAccountId` pairs them correctly. With
    // the two lists in step, a positional implementation that never reads the
    // field passes this scope — which is how the committed version of this
    // test pinned "one group per sale" without pinning "the pairing is
    // DECLARED". Production diverges the same way: the solver's working set is
    // a keyed Map flattened in insertion order, so an unrelated earlier lever's
    // account-upsert sits ahead of a sale's note.
    const res = await PUT(
      makeUpdateRequest({
        scenarioId: SCENARIO_ID,
        mutations: [
          { kind: "account-upsert", id: SALE_ACCOUNT_2, value: soldToTrust(a2) },
          // Not a sale — some other lever revalued it in the same save.
          { kind: "account-upsert", id: UNRELATED_ACCOUNT, value: { ...other, value: 61_000 } },
          { kind: "account-upsert", id: SALE_ACCOUNT_1, value: soldToTrust(a1) },
          {
            kind: "note-receivable-upsert",
            id: NOTE_ID,
            value: saleNote(),
            sourceAccountId: SALE_ACCOUNT_1,
          },
          {
            kind: "note-receivable-upsert",
            id: NOTE_ID_2,
            value: { ...saleNote(), id: NOTE_ID_2, name: "Note from Rental sale" },
            sourceAccountId: SALE_ACCOUNT_2,
          },
        ],
      }),
      ctx as never,
    );

    expect(res.status).toBe(200);

    const edit1 = editCallFor(SALE_ACCOUNT_1);
    const edit2 = editCallFor(SALE_ACCOUNT_2);
    const note1 = noteRowById(NOTE_ID) as { toggleGroupId: string | null };
    const note2 = noteRowById(NOTE_ID_2) as { toggleGroupId: string | null };
    expect(edit1?.toggleGroupId ?? null).not.toBeNull();
    expect(edit2?.toggleGroupId ?? null).not.toBeNull();
    expect(note1.toggleGroupId).not.toBeNull();
    expect(note2.toggleGroupId).not.toBeNull();
    expect(edit1!.toggleGroupId).toBe(note1.toggleGroupId);
    expect(edit2!.toggleGroupId).toBe(note2.toggleGroupId);
    expect(edit1!.toggleGroupId).not.toBe(edit2!.toggleGroupId);
    // The unrelated account is swept into NEITHER sale's card.
    expect(editCallFor(UNRELATED_ACCOUNT)).toBeDefined();
    expect(editCallFor(UNRELATED_ACCOUNT)?.toggleGroupId ?? null).toBeNull();
    expect(insertedGroups).toHaveLength(2);
  });

  it("PUT re-save reuses the sale's existing group instead of minting a second one", async () => {
    // The scenario already holds this sale from an earlier save: the note row
    // exists and is gated by a group this scenario owns. A re-save must tag the
    // account edit with THAT group, not a fresh one — otherwise the two halves
    // drift apart again on every update.
    const acct = saleAccount(SALE_ACCOUNT_1, "Brokerage");
    treeWithAccounts([acct]);
    vi.mocked(loadScenarioToggleGroups).mockResolvedValue([
      {
        id: "sale-gid",
        scenarioId: SCENARIO_ID,
        name: "Sell Brokerage to trust",
        defaultOn: true,
        requiresGroupId: null,
        orderIndex: 0,
      },
    ] as never);
    existingNoteRows = [{ id: NOTE_ID, toggleGroupId: "sale-gid" }];

    const res = await PUT(
      makeUpdateRequest({
        scenarioId: SCENARIO_ID,
        mutations: [
          { kind: "account-upsert", id: SALE_ACCOUNT_1, value: soldToTrust(acct) },
          {
            kind: "note-receivable-upsert",
            id: NOTE_ID,
            value: saleNote(),
            sourceAccountId: SALE_ACCOUNT_1,
          },
        ],
      }),
      ctx as never,
    );

    expect(res.status).toBe(200);
    expect(insertedGroups).toHaveLength(0);
    expect(editCallFor(SALE_ACCOUNT_1)?.toggleGroupId).toBe("sale-gid");
  });
});
