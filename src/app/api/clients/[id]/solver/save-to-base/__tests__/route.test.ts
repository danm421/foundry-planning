import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db-helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db-helpers")>();
  return { ...actual, requireOrgId: vi.fn() };
});
vi.mock("@/lib/db-scoping", () => ({
  findClientInFirm: vi.fn(),
  assertAccountsInClient: vi.fn(),
  assertEntitiesInClient: vi.fn(),
  assertFamilyMembersInClient: vi.fn(),
  assertExternalBeneficiariesInClient: vi.fn(),
}));
vi.mock("@/lib/scenario/loader", () => ({ loadEffectiveTree: vi.fn() }));
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

// Records every tx.insert(table).values(row) and tx.update(table).set(set).where(...)
// so tests can assert the rows written and that updates are base-scenario scoped.
type Insert = { table: unknown; values: unknown };
type Update = { table: unknown; set: unknown };
type Delete = { table: unknown };
const inserts: Insert[] = [];
const updates: Update[] = [];
const deletes: Delete[] = [];

vi.mock("@/db", () => {
  // db.select(...).from(...).where(...) resolves to the base-scenario lookup.
  const select = () => ({
    from: () => ({ where: async () => [{ id: "base-scenario-id" }] }),
  });
  return {
    db: {
      select,
      transaction: vi.fn(async (fn) => {
        const tx = {
          insert: (table: unknown) => ({
            values: (values: unknown) => {
              inserts.push({ table, values });
              return { returning: async () => [{ id: "generated-account-id" }] };
            },
          }),
          update: (table: unknown) => ({
            set: (set: unknown) => ({ where: async () => { updates.push({ table, set }); } }),
          }),
          delete: (table: unknown) => ({ where: async () => { deletes.push({ table }); } }),
        };
        return await fn(tx);
      }),
    },
  };
});

import { POST } from "../route";
import { requireOrgId } from "@/lib/db-helpers";
import {
  findClientInFirm,
  assertAccountsInClient,
  assertEntitiesInClient,
  assertFamilyMembersInClient,
  assertExternalBeneficiariesInClient,
} from "@/lib/db-scoping";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { recordAudit } from "@/lib/audit";

const CLIENT_ID = "00000000-0000-4000-8000-000000000001";
const FIRM_ID = "00000000-0000-4000-8000-000000000099";

const ACCT = {
  id: "synthetic-new",
  name: "John — Taxable",
  category: "taxable",
  subType: "brokerage",
  value: 0,
  basis: 0,
  growthRate: 0.06,
  rmdEnabled: false,
  titlingType: "jtwros",
  owners: [{ kind: "family_member", familyMemberId: "fm-1", percent: 100 }],
};

function makeRequest(body: unknown) {
  return new Request(
    `http://localhost/api/clients/${CLIENT_ID}/solver/save-to-base`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  ) as unknown as import("next/server").NextRequest;
}

const ctx = { params: Promise.resolve({ id: CLIENT_ID }) };

beforeEach(() => {
  inserts.length = 0;
  updates.length = 0;
  deletes.length = 0;
  vi.mocked(requireOrgId).mockResolvedValue(FIRM_ID);
  vi.mocked(findClientInFirm).mockResolvedValue({ id: CLIENT_ID } as never);
  vi.mocked(assertAccountsInClient).mockResolvedValue({ ok: true } as never);
  vi.mocked(assertEntitiesInClient).mockResolvedValue({ ok: true } as never);
  vi.mocked(assertFamilyMembersInClient).mockResolvedValue({ ok: true } as never);
  vi.mocked(assertExternalBeneficiariesInClient).mockResolvedValue({ ok: true } as never);
  vi.mocked(loadEffectiveTree).mockResolvedValue({
    effectiveTree: { accounts: [], savingsRules: [] },
    warnings: [],
  } as never);
});

describe("POST /api/clients/[id]/solver/save-to-base", () => {
  it("returns 400 on a malformed body", async () => {
    const res = await POST(makeRequest({ source: "base" }), ctx as never);
    expect(res.status).toBe(400);
  });

  it("returns 403 when the client is not in the caller's firm", async () => {
    vi.mocked(findClientInFirm).mockResolvedValue(null as never);
    const res = await POST(
      makeRequest({ source: "base", mutations: [{ kind: "account-upsert", id: "x", value: ACCT }] }),
      ctx as never,
    );
    expect(res.status).toBe(403);
  });

  it("inserts a brand-new account plus its owner row, scoped to the base scenario", async () => {
    const res = await POST(
      makeRequest({
        source: "base",
        mutations: [{ kind: "account-upsert", id: "synthetic-new", value: ACCT }],
      }),
      ctx as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, accountInserts: 1 });
    // One account insert + one account_owners insert.
    expect(inserts).toHaveLength(2);
    expect(inserts[0].values).toMatchObject({
      clientId: CLIENT_ID,
      scenarioId: "base-scenario-id",
      name: "John — Taxable",
    });
    expect(inserts[1].values).toMatchObject({
      accountId: "generated-account-id",
      familyMemberId: "fm-1",
      percent: "100",
    });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "client.base_facts.update",
        metadata: expect.objectContaining({ source: "solver", accountInserts: 1 }),
      }),
    );
  });

  it("classifies an account already in the source tree as an update and re-materializes its owners", async () => {
    vi.mocked(loadEffectiveTree).mockResolvedValue({
      effectiveTree: { accounts: [{ ...ACCT }], savingsRules: [] },
      warnings: [],
    } as never);
    const res = await POST(
      makeRequest({
        source: "base",
        mutations: [{ kind: "account-upsert", id: "synthetic-new", value: { ...ACCT, name: "Renamed" } }],
      }),
      ctx as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ accountInserts: 0, accountUpdates: 1 });
    // One UPDATE to the account columns …
    expect(updates).toHaveLength(1);
    expect(updates[0].set).toMatchObject({ name: "Renamed" });
    // … plus the owners satellite re-materialized (delete-then-reinsert) so a
    // retitle is never lost (#a).
    expect(deletes).toHaveLength(1);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].values).toMatchObject({ familyMemberId: "fm-1", percent: "100" });
  });

  it("persists a retitle-into-trust on update by rewriting account_owners (#a)", async () => {
    // Source has the account (→ UPDATE); the upsert retitles it to an entity owner.
    vi.mocked(loadEffectiveTree).mockResolvedValue({
      effectiveTree: { accounts: [{ ...ACCT }], savingsRules: [] },
      warnings: [],
    } as never);
    const retitled = {
      ...ACCT,
      owners: [{ kind: "entity", entityId: "trust-1", percent: 100 }],
    };
    const res = await POST(
      makeRequest({
        source: "base",
        mutations: [{ kind: "account-upsert", id: "synthetic-new", value: retitled }],
      }),
      ctx as never,
    );
    expect(res.status).toBe(200);
    // Old owners cleared, new entity owner written.
    expect(deletes).toHaveLength(1);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].values).toMatchObject({ entityId: "trust-1", familyMemberId: null, percent: "100" });
  });

  it("returns 400 when an owner references a family member not in the client (#b)", async () => {
    vi.mocked(assertFamilyMembersInClient).mockResolvedValue({
      ok: false,
      reason: "Family member fm-1 not owned by this client",
    } as never);
    const res = await POST(
      makeRequest({
        source: "base",
        mutations: [{ kind: "account-upsert", id: "synthetic-new", value: ACCT }],
      }),
      ctx as never,
    );
    expect(res.status).toBe(400);
    // Guarded BEFORE the transaction — nothing written.
    expect(inserts).toHaveLength(0);
  });

  it("inserts an overlay-added account into base rather than 0-row updating it (#c)", async () => {
    const SCENARIO = "11111111-1111-4111-8111-111111111111";
    // 1st load = source (overlay) that CONTAINS the account.
    // 2nd load = base tree, which does NOT — so it must classify as an insert.
    vi.mocked(loadEffectiveTree)
      .mockResolvedValueOnce({
        effectiveTree: { accounts: [{ ...ACCT }], savingsRules: [] },
        warnings: [],
      } as never)
      .mockResolvedValueOnce({
        effectiveTree: { accounts: [], savingsRules: [] },
        warnings: [],
      } as never);
    const res = await POST(
      makeRequest({
        source: SCENARIO,
        mutations: [{ kind: "account-upsert", id: "synthetic-new", value: ACCT }],
      }),
      ctx as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ accountInserts: 1, accountUpdates: 0 });
    // Account row + its owner row inserted into base.
    expect(inserts).toHaveLength(2);
    expect(inserts[0].values).toMatchObject({ scenarioId: "base-scenario-id", name: "John — Taxable" });
  });

  it("applies a client-singleton update for a retirement-age lever", async () => {
    const res = await POST(
      makeRequest({
        source: "base",
        mutations: [{ kind: "retirement-age", person: "client", age: 67 }],
      }),
      ctx as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ clientUpdate: 1 });
    expect(inserts).toHaveLength(0);
    expect(updates).toHaveLength(1);
    expect(updates[0].set).toMatchObject({ retirementAge: 67 });
  });

  it("applies a string-coerced partial income update", async () => {
    const incomeId = "00000000-0000-4000-8000-0000000000a1";
    vi.mocked(loadEffectiveTree).mockResolvedValue({
      effectiveTree: {
        accounts: [],
        savingsRules: [],
        incomes: [{ id: incomeId, type: "salary", owner: "client", annualAmount: 200000 }],
      },
      warnings: [],
    } as never);
    const res = await POST(
      makeRequest({
        source: "base",
        mutations: [{ kind: "income-annual-amount", incomeId, annualAmount: 250000 }],
      }),
      ctx as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ incomeUpdates: 1 });
    expect(updates).toHaveLength(1);
    expect(updates[0].set).toMatchObject({ annualAmount: "250000" });
  });

  it("remaps a surplus save-to account created in the same batch to its inserted uuid", async () => {
    // Account created inline (synthetic id) AND chosen as the surplus destination.
    const res = await POST(
      makeRequest({
        source: "base",
        mutations: [
          { kind: "account-upsert", id: "synthetic-new", value: ACCT },
          { kind: "surplus-allocation", spendPct: 0.5, saveAccountId: "synthetic-new" },
        ],
      }),
      ctx as never,
    );
    expect(res.status).toBe(200);
    // The plan_settings update carries the surplus fields; its save-to id must be
    // the generated DB uuid, NOT the synthetic id (else FK violation).
    const ps = updates.find((u) => u.set && "surplusSaveAccountId" in (u.set as object));
    expect(ps).toBeDefined();
    expect((ps!.set as { surplusSaveAccountId: string }).surplusSaveAccountId).toBe(
      "generated-account-id",
    );
  });

  it("returns 400 when the surplus save-to account is not in the client", async () => {
    // Only the surplus destination id fails tenant validation; the (empty) savings
    // and dedicated guards pass. This forces the 400 to come from the NEW surplus
    // guard specifically — the test fails if that guard is removed.
    vi.mocked(assertAccountsInClient).mockImplementation((async (_clientId: string, ids: string[]) =>
      ids.includes("acct-external")
        ? { ok: false, reason: "Account acct-external not owned by this client" }
        : { ok: true }) as never);
    const res = await POST(
      makeRequest({
        source: "base",
        mutations: [{ kind: "surplus-allocation", spendPct: 0.5, saveAccountId: "acct-external" }],
      }),
      ctx as never,
    );
    expect(res.status).toBe(400);
    // The surplus guard was actually consulted with the destination id.
    expect(assertAccountsInClient).toHaveBeenCalledWith(CLIENT_ID, ["acct-external"]);
    // Guarded BEFORE the transaction — nothing written.
    expect(updates).toHaveLength(0);
  });

  it("persists a new 529's beneficiary and does not write a sentinel owner row", async () => {
    const ACCT_529 = {
      id: "syn-529",
      name: "Ava — 529 Plan",
      category: "education_savings",
      subType: "529",
      value: 15000,
      basis: 15000,
      growthRate: 0.06,
      rmdEnabled: false,
      titlingType: "jtwros",
      owners: [{ kind: "external_beneficiary", externalBeneficiaryId: "__529_beneficiary", percent: 1 }],
      education529: {
        grantorFamilyMemberId: null,
        grantorName: null,
        beneficiaryFamilyMemberId: "fm-ava",
        beneficiaryName: null,
        rothRolloverEnabled: false,
        rothRolloverStartYear: null,
        rothRolloverAccountId: null,
      },
    };
    const res = await POST(
      makeRequest({ source: "base", mutations: [{ kind: "account-upsert", id: "syn-529", value: ACCT_529 }] }),
      ctx as never,
    );
    expect(res.status).toBe(200);
    // Exactly ONE insert — the account row. No account_owners row for the sentinel.
    expect(inserts).toHaveLength(1);
    expect(inserts[0].values).toMatchObject({
      category: "education_savings",
      beneficiaryFamilyMemberId: "fm-ava",
    });
    // The sentinel is excluded from external-beneficiary tenant validation …
    expect(assertExternalBeneficiariesInClient).toHaveBeenCalledWith(CLIENT_ID, []);
    // … while the beneficiary family member IS validated.
    expect(assertFamilyMembersInClient).toHaveBeenCalledWith(
      CLIENT_ID,
      expect.arrayContaining(["fm-ava"]),
    );
  });

  it("validates a new 529's Roth-rollover destination account against tenant scope", async () => {
    const ACCT_529_ROTH = {
      id: "syn-529-roth",
      name: "Ava — 529 Plan",
      category: "education_savings",
      subType: "529",
      value: 15000,
      basis: 15000,
      growthRate: 0.06,
      rmdEnabled: false,
      titlingType: "jtwros",
      owners: [{ kind: "external_beneficiary", externalBeneficiaryId: "__529_beneficiary", percent: 1 }],
      education529: {
        grantorFamilyMemberId: null,
        grantorName: null,
        beneficiaryFamilyMemberId: "fm-ava",
        beneficiaryName: null,
        rothRolloverEnabled: true,
        rothRolloverStartYear: 2040,
        // Not the account's own synthetic id, and not any other id inserted in
        // this batch — so it is NOT filtered by insertedSyntheticIds and must
        // reach the tenant check as a crafted / cross-tenant destination.
        rothRolloverAccountId: "cross-tenant-roth-acct",
      },
    };
    const res = await POST(
      makeRequest({
        source: "base",
        mutations: [{ kind: "account-upsert", id: "syn-529-roth", value: ACCT_529_ROTH }],
      }),
      ctx as never,
    );
    expect(res.status).toBe(200);
    // The roth-rollover destination id was actually consulted by the tenant guard.
    expect(assertAccountsInClient).toHaveBeenCalledWith(
      CLIENT_ID,
      expect.arrayContaining(["cross-tenant-roth-acct"]),
    );
  });

  it("returns 400 when the 529 Roth-rollover destination account is not in the client", async () => {
    // Only the roth-rollover destination id fails tenant validation; the other
    // (empty) guards pass. This forces the 400 to come from the NEW roth-rollover
    // guard specifically — the test fails if that guard is removed.
    vi.mocked(assertAccountsInClient).mockImplementation((async (_clientId: string, ids: string[]) =>
      ids.includes("cross-tenant-roth-acct")
        ? { ok: false, reason: "Account cross-tenant-roth-acct not owned by this client" }
        : { ok: true }) as never);
    const ACCT_529_ROTH = {
      id: "syn-529-roth",
      name: "Ava — 529 Plan",
      category: "education_savings",
      subType: "529",
      value: 15000,
      basis: 15000,
      growthRate: 0.06,
      rmdEnabled: false,
      titlingType: "jtwros",
      owners: [{ kind: "external_beneficiary", externalBeneficiaryId: "__529_beneficiary", percent: 1 }],
      education529: {
        grantorFamilyMemberId: null,
        grantorName: null,
        beneficiaryFamilyMemberId: "fm-ava",
        beneficiaryName: null,
        rothRolloverEnabled: true,
        rothRolloverStartYear: 2040,
        rothRolloverAccountId: "cross-tenant-roth-acct",
      },
    };
    const res = await POST(
      makeRequest({
        source: "base",
        mutations: [{ kind: "account-upsert", id: "syn-529-roth", value: ACCT_529_ROTH }],
      }),
      ctx as never,
    );
    expect(res.status).toBe(400);
    // Guarded BEFORE the transaction — nothing written.
    expect(inserts).toHaveLength(0);
  });

  it("validates an education goal's forFamilyMemberId against tenant scope", async () => {
    const EDU_EXPENSE = {
      id: "syn-edu-1",
      name: "College",
      type: "education",
      annualAmount: 30000,
      startYear: 2032,
      endYear: 2035,
      growthRate: 0.05,
      dedicatedAccountIds: [],
      payShortfallOutOfPocket: false,
      institutionState: null,
      institutionName: null,
      // Not any account-owner or 529 grantor/beneficiary id — this must flow
      // into the SAME fmCheck call via expenseInserts/expenseFullUpdates, or a
      // crafted id here would slip past tenant validation.
      forFamilyMemberId: "cross-tenant-fm",
    };
    const res = await POST(
      makeRequest({
        source: "base",
        mutations: [{ kind: "expense-upsert", id: "syn-edu-1", value: EDU_EXPENSE }],
      }),
      ctx as never,
    );
    expect(res.status).toBe(200);
    // The education goal's "For" id was actually consulted by the tenant guard.
    expect(assertFamilyMembersInClient).toHaveBeenCalledWith(
      CLIENT_ID,
      expect.arrayContaining(["cross-tenant-fm"]),
    );
  });

  it("returns 400 when an education goal's forFamilyMemberId is not in the client", async () => {
    // Only the "For" family-member id fails tenant validation; the other
    // (empty) guards pass. This forces the 400 to come from the forFamilyMemberId
    // guard specifically — the test fails if that guard is removed.
    vi.mocked(assertFamilyMembersInClient).mockImplementation((async (_clientId: string, ids: string[]) =>
      ids.includes("cross-tenant-fm")
        ? { ok: false, reason: "Family member cross-tenant-fm not owned by this client" }
        : { ok: true }) as never);
    const EDU_EXPENSE = {
      id: "syn-edu-1",
      name: "College",
      type: "education",
      annualAmount: 30000,
      startYear: 2032,
      endYear: 2035,
      growthRate: 0.05,
      dedicatedAccountIds: [],
      payShortfallOutOfPocket: false,
      institutionState: null,
      institutionName: null,
      forFamilyMemberId: "cross-tenant-fm",
    };
    const res = await POST(
      makeRequest({
        source: "base",
        mutations: [{ kind: "expense-upsert", id: "syn-edu-1", value: EDU_EXPENSE }],
      }),
      ctx as never,
    );
    expect(res.status).toBe(400);
    // Guarded BEFORE the transaction — nothing written.
    expect(inserts).toHaveLength(0);
  });
});
