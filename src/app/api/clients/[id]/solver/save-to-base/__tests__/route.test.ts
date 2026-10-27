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
  assertIncomesInClient: vi.fn(),
  assertLiabilitiesInClient: vi.fn(),
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
// An UPDATE's `.returning()` reports `updateMatched` — set it to [] to model a
// client-scoped WHERE that matched no row.
type Insert = { table: unknown; values: unknown };
type Update = { table: unknown; set: unknown; where?: unknown };
type Delete = { table: unknown; where?: unknown };
const inserts: Insert[] = [];
const updates: Update[] = [];
const deletes: Delete[] = [];
let updateMatched: unknown[] = [];
// Rows the transaction's revocable_trusts lookup returns ({ id, name }).
let revocableTrustRows: unknown[] = [];

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
          select: () => ({
            from: () => ({ where: async () => revocableTrustRows }),
          }),
          insert: (table: unknown) => ({
            values: (values: unknown) => {
              inserts.push({ table, values });
              // A row inserted under its own id comes back with it, as in Postgres.
              const id = (values as { id?: string }).id ?? "generated-account-id";
              return { returning: async () => [{ ...(values as object), id }] };
            },
          }),
          update: (table: unknown) => ({
            set: (set: unknown) => ({
              where: (where: unknown) => {
                updates.push({ table, set, where });
                return Object.assign(Promise.resolve(), {
                  returning: async () => updateMatched,
                });
              },
            }),
          }),
          delete: (table: unknown) => ({
            where: async (where: unknown) => {
              deletes.push({ table, where });
            },
          }),
        };
        return await fn(tx);
      }),
    },
  };
});

import { and, eq } from "drizzle-orm";
import { POST } from "../route";
import { db } from "@/db";
import {
  accountOwners,
  accounts,
  clients,
  expenseDedicatedAccounts,
  expenses,
  familyMembers,
  gifts,
  giftSeries,
  revocableTrusts,
  savingsRules,
} from "@/db/schema";
import { applyScenarioChanges } from "@/engine/scenario/applyChanges";
import type { ScenarioChange } from "@/engine/scenario/types";
import { buildClientData } from "@/engine/__tests__/fixtures";
import type { ClientData } from "@/engine/types";
import { requireOrgId } from "@/lib/db-helpers";
import {
  findClientInFirm,
  assertAccountsInClient,
  assertEntitiesInClient,
  assertFamilyMembersInClient,
  assertExternalBeneficiariesInClient,
  assertIncomesInClient,
  assertLiabilitiesInClient,
} from "@/lib/db-scoping";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { recordAudit } from "@/lib/audit";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { GOAL_FUNDING_529_ERROR } from "@/lib/goals";
import { partitionBaseSavableMutations } from "@/lib/solver/mutations-to-base-updates";
import type { SolverMutation } from "@/lib/solver/types";

const CLIENT_ID = "00000000-0000-4000-8000-000000000001";
const FIRM_ID = "00000000-0000-4000-8000-000000000099";

const PORTFOLIO_ID = "00000000-0000-4000-8000-000000000001";
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
  updateMatched = [{ id: "matched" }];
  revocableTrustRows = [];
  vi.mocked(requireOrgId).mockResolvedValue(FIRM_ID);
  vi.mocked(findClientInFirm).mockResolvedValue({ id: CLIENT_ID } as never);
  vi.mocked(assertAccountsInClient).mockResolvedValue({ ok: true } as never);
  vi.mocked(assertEntitiesInClient).mockResolvedValue({ ok: true } as never);
  vi.mocked(assertFamilyMembersInClient).mockResolvedValue({ ok: true } as never);
  vi.mocked(assertExternalBeneficiariesInClient).mockResolvedValue({ ok: true } as never);
  vi.mocked(assertIncomesInClient).mockResolvedValue({ ok: true } as never);
  vi.mocked(assertLiabilitiesInClient).mockResolvedValue({ ok: true } as never);
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

  it("persists the growth BASIS on insert, not just the resolved rate", async () => {
    // Without growth_source + model_portfolio_id the column default ("default")
    // wins on the next load and resolve-entity re-derives growth from the
    // CATEGORY — silently discarding the portfolio the advisor picked in the
    // Solver and the rate the projection they approved was run on.
    const res = await POST(
      makeRequest({
        source: "base",
        mutations: [
          {
            kind: "account-upsert",
            id: "synthetic-new",
            value: {
              ...ACCT,
              growthRate: 0.062,
              growthSource: "model_portfolio",
              modelPortfolioId: PORTFOLIO_ID,
            },
          },
        ],
      }),
      ctx as never,
    );
    expect(res.status).toBe(200);
    expect(inserts[0].values).toMatchObject({
      growthRate: "0.062",
      growthSource: "model_portfolio",
      modelPortfolioId: PORTFOLIO_ID,
    });
  });

  it("persists the inherited-IRA fields on insert", async () => {
    // A scenario-added inherited IRA the Solver mints must carry its
    // inherited fields onto the base insert — dropping the spread here would
    // silently un-inherit it (null death year, false heir-disabled) the
    // moment it's saved to base.
    const res = await POST(
      makeRequest({
        source: "base",
        mutations: [
          {
            kind: "account-upsert",
            id: "synthetic-new",
            value: {
              ...ACCT,
              category: "retirement",
              subType: "traditional_ira",
              inheritedDeathYear: 2022,
              inheritedOwnerBirthYear: 1945,
              inheritedHeirDisabled: true,
            },
          },
        ],
      }),
      ctx as never,
    );
    expect(res.status).toBe(200);
    expect(inserts[0].values).toMatchObject({
      inheritedDeathYear: 2022,
      inheritedOwnerBirthYear: 1945,
      inheritedHeirDisabled: true,
    });
  });

  it("persists the payout window on insert", async () => {
    // inheritedIraRowFields carries the window; dropping it there would
    // silently reset a scenario's payout plan to the minimum on save-to-base.
    const res = await POST(
      makeRequest({
        source: "base",
        mutations: [
          {
            kind: "account-upsert",
            id: "synthetic-new",
            value: {
              ...ACCT,
              category: "retirement",
              subType: "traditional_ira",
              inheritedDeathYear: 2026,
              inheritedOwnerBirthYear: 1930,
              inheritedPayoutFromYear: 2031,
              inheritedPayoutThroughYear: 2036,
            },
          },
        ],
      }),
      ctx as never,
    );
    expect(res.status).toBe(200);
    expect(inserts[0].values).toMatchObject({ inheritedPayoutFromYear: 2031, inheritedPayoutThroughYear: 2036 });
  });

  it("clears a stale portfolio link when the account moves off a portfolio", async () => {
    vi.mocked(loadEffectiveTree).mockResolvedValue({
      effectiveTree: { accounts: [{ ...ACCT }], savingsRules: [] },
      warnings: [],
    } as never);
    const res = await POST(
      makeRequest({
        source: "base",
        mutations: [
          {
            kind: "account-upsert",
            id: "synthetic-new",
            value: { ...ACCT, growthSource: "default", modelPortfolioId: null },
          },
        ],
      }),
      ctx as never,
    );
    expect(res.status).toBe(200);
    // Leaving the old id behind would silently re-link the account to the
    // portfolio the advisor just switched away from.
    expect(updates[0].set).toMatchObject({
      growthSource: "default",
      modelPortfolioId: null,
    });
  });

  it("pins a rate-only account to 'custom' rather than letting it revert", async () => {
    // A lever that MINTS an account (the Roth-conversion form) may hand over a
    // resolved rate with no basis. The column default would re-derive growth
    // from the category and discard that rate — so the write boundary backstops
    // it to "custom", honouring the rate the approved projection actually ran on.
    vi.mocked(loadEffectiveTree).mockResolvedValue({
      effectiveTree: { accounts: [], savingsRules: [] },
      warnings: [],
    } as never);
    const res = await POST(
      makeRequest({
        source: "base",
        mutations: [
          { kind: "account-upsert", id: "synthetic-new", value: { ...ACCT, growthRate: 0.08 } },
        ],
      }),
      ctx as never,
    );
    expect(res.status).toBe(200);
    expect(inserts[0].values).toMatchObject({ growthRate: "0.08", growthSource: "custom" });
  });

  it("writes margin loan fields on insert, and loan-free defaults otherwise", async () => {
    const res = await POST(
      makeRequest({
        source: "base",
        mutations: [
          {
            kind: "account-upsert",
            id: "synthetic-new",
            value: { ...ACCT, marginBalance: 2_000_000, marginInterestRate: 0.08, marginCallPct: 0.25 },
          },
        ],
      }),
      ctx as never,
    );
    expect(res.status).toBe(200);
    expect(inserts[0].values).toMatchObject({
      marginBalance: "2000000",
      marginInterestRate: "0.08",
      marginCallPct: "0.25",
    });

    inserts.length = 0;
    const res2 = await POST(
      makeRequest({ source: "base", mutations: [{ kind: "account-upsert", id: "synthetic-new", value: ACCT }] }),
      ctx as never,
    );
    expect(res2.status).toBe(200);
    expect(inserts[0].values).toMatchObject({
      marginBalance: "0",
      marginInterestRate: "0",
      marginCallPct: "0.3",
    });
  });

  it("writes the margin borrowing fields on insert, and forces the switch off for a non-taxable account", async () => {
    const borrow = {
      marginBorrowEnabled: true,
      marginBorrowStartYear: 2028,
      marginBorrowStartYearRef: null,
      marginRepayYear: 2036,
      marginRepayYearRef: null,
    };
    const res = await POST(
      makeRequest({
        source: "base",
        mutations: [{ kind: "account-upsert", id: "synthetic-new", value: { ...ACCT, ...borrow } }],
      }),
      ctx as never,
    );
    expect(res.status).toBe(200);
    expect(inserts[0].values).toMatchObject(borrow);

    inserts.length = 0;
    const res2 = await POST(
      makeRequest({
        source: "base",
        mutations: [
          { kind: "account-upsert", id: "synthetic-new", value: { ...ACCT, ...borrow, category: "cash", subType: "checking" } },
        ],
      }),
      ctx as never,
    );
    expect(res2.status).toBe(200);
    expect(inserts[0].values).toMatchObject({ marginBorrowEnabled: false, marginRepayYear: 2036 });

    inserts.length = 0;
    await POST(
      makeRequest({ source: "base", mutations: [{ kind: "account-upsert", id: "synthetic-new", value: ACCT }] }),
      ctx as never,
    );
    expect(inserts[0].values).toMatchObject({
      marginBorrowEnabled: false,
      marginBorrowStartYear: null,
      marginRepayYear: null,
    });
  });

  it("writes margin loan fields on update, and loan-free defaults otherwise", async () => {
    vi.mocked(loadEffectiveTree).mockResolvedValue({
      effectiveTree: { accounts: [{ ...ACCT }], savingsRules: [] },
      warnings: [],
    } as never);
    const res = await POST(
      makeRequest({
        source: "base",
        mutations: [
          {
            kind: "account-upsert",
            id: "synthetic-new",
            value: { ...ACCT, marginBalance: 500_000, marginInterestRate: 0.07, marginCallPct: 0.2 },
          },
        ],
      }),
      ctx as never,
    );
    expect(res.status).toBe(200);
    expect(updates[0].set).toMatchObject({
      marginBalance: "500000",
      marginInterestRate: "0.07",
      marginCallPct: "0.2",
    });

    updates.length = 0;
    const res2 = await POST(
      makeRequest({ source: "base", mutations: [{ kind: "account-upsert", id: "synthetic-new", value: ACCT }] }),
      ctx as never,
    );
    expect(res2.status).toBe(200);
    expect(updates[0].set).toMatchObject({
      marginBalance: "0",
      marginInterestRate: "0",
      marginCallPct: "0.3",
    });
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

  it("persists the inherited-IRA fields on update", async () => {
    // An already-base account the Solver edits must carry its inherited
    // fields onto the base UPDATE — dropping the spread here would silently
    // un-inherit an existing inherited IRA the next time the Solver saves.
    vi.mocked(loadEffectiveTree).mockResolvedValue({
      effectiveTree: { accounts: [{ ...ACCT, category: "retirement", subType: "traditional_ira" }], savingsRules: [] },
      warnings: [],
    } as never);
    const res = await POST(
      makeRequest({
        source: "base",
        mutations: [
          {
            kind: "account-upsert",
            id: "synthetic-new",
            value: {
              ...ACCT,
              category: "retirement",
              subType: "traditional_ira",
              inheritedDeathYear: 2022,
              inheritedOwnerBirthYear: 1945,
              inheritedHeirDisabled: true,
            },
          },
        ],
      }),
      ctx as never,
    );
    expect(res.status).toBe(200);
    expect(updates[0].set).toMatchObject({
      inheritedDeathYear: 2022,
      inheritedOwnerBirthYear: 1945,
      inheritedHeirDisabled: true,
    });
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

  it("carries absorbsRemainingCashFlow into the base expense row", async () => {
    const LIVING_EXPENSE = {
      id: "syn-living-1",
      name: "Current Living Expenses",
      type: "living",
      annualAmount: 0,
      startYear: 2026,
      endYear: 2040,
      growthRate: 0.03,
      absorbsRemainingCashFlow: true,
    };
    const res = await POST(
      makeRequest({
        source: "base",
        mutations: [{ kind: "expense-upsert", id: "syn-living-1", value: LIVING_EXPENSE }],
      }),
      ctx as never,
    );
    expect(res.status).toBe(200);
    // Whether the route classifies this as an insert or a full update, the
    // written row must carry the flag. A field absent from either literal is
    // dropped SILENTLY — the plan simply stops absorbing, with no error.
    const written = [...inserts.map((i) => i.values), ...updates.map((u) => u.set)].find(
      (v) => (v as { name?: string } | undefined)?.name === "Current Living Expenses",
    ) as Record<string, unknown> | undefined;
    expect(written).toBeDefined();
    expect(written!.absorbsRemainingCashFlow).toBe(true);
  });

  it("refuses a 529 on an Other goal before writing anything", async () => {
    vi.mocked(loadEffectiveTree).mockResolvedValue({
      effectiveTree: {
        accounts: [{ id: "acct-529", category: "education_savings", subType: "529" }],
        savingsRules: [],
      },
      warnings: [],
    } as never);
    const CAR = {
      id: "syn-car-1", name: "Car", type: "other", annualAmount: 60000,
      startYear: 2030, endYear: 2030, growthRate: 0.03,
      isGoal: true, dedicatedAccountIds: ["acct-529"], payShortfallOutOfPocket: true,
    };
    const res = await POST(
      makeRequest({ source: "base", mutations: [{ kind: "expense-upsert", id: "syn-car-1", value: CAR }] }),
      ctx as never,
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(GOAL_FUNDING_529_ERROR);
    expect(inserts).toHaveLength(0);
  });

  it("persists isGoal on a Solver-added Other goal", async () => {
    const CAR = {
      id: "syn-car-1", name: "Car", type: "other", annualAmount: 60000,
      startYear: 2030, endYear: 2030, growthRate: 0.03,
      isGoal: true, dedicatedAccountIds: [], payShortfallOutOfPocket: true,
    };
    const res = await POST(
      makeRequest({ source: "base", mutations: [{ kind: "expense-upsert", id: "syn-car-1", value: CAR }] }),
      ctx as never,
    );
    expect(res.status).toBe(200);
    const inserted = inserts.find((i) => (i.values as { name?: string }).name === "Car");
    expect(inserted?.values).toMatchObject({ type: "other", isGoal: true });
  });
});

/**
 * An upsert is classified as insert-or-update by its `id`, but the row it
 * writes is named by `value.id`. The two must agree, and the satellite rows
 * (account owners, goal funding links) — which carry no client column — are
 * rewritten only for a parent row the client-scoped UPDATE actually matched.
 */
describe("save-to-base — an upsert writes only the client's own base row", () => {
  const BASE_ACCT = { ...ACCT, id: "base-acct" };
  const BASE_EXP = {
    id: "base-exp",
    name: "College",
    type: "education",
    annualAmount: 30000,
    startYear: 2032,
    endYear: 2035,
    growthRate: 0.05,
    dedicatedAccountIds: ["base-acct"],
    payShortfallOutOfPocket: false,
    institutionState: null,
    institutionName: null,
  };
  const save = (mutation: unknown) =>
    POST(makeRequest({ source: "base", mutations: [mutation] }), ctx as never);
  const writesTo = (table: unknown) => ({
    deleted: deletes.filter((d) => d.table === table).length,
    inserted: inserts.filter((i) => i.table === table).length,
  });

  beforeEach(() => {
    vi.mocked(loadEffectiveTree).mockResolvedValue({
      effectiveTree: { accounts: [BASE_ACCT], expenses: [BASE_EXP], savingsRules: [], incomes: [] },
      warnings: [],
    } as never);
  });

  it("refuses an account upsert whose value names a different row than its id", async () => {
    const res = await save({
      kind: "account-upsert",
      id: "base-acct",
      value: { ...BASE_ACCT, id: "other-acct" },
    });
    expect(res.status).toBe(400);
    expect({ updates, deletes, inserts }).toEqual({ updates: [], deletes: [], inserts: [] });
  });

  it("refuses an expense upsert whose value names a different row than its id", async () => {
    const res = await save({
      kind: "expense-upsert",
      id: "base-exp",
      value: { ...BASE_EXP, id: "other-exp" },
    });
    expect(res.status).toBe(400);
    expect({ updates, deletes, inserts }).toEqual({ updates: [], deletes: [], inserts: [] });
  });

  it("rewrites account owners only when the scoped update matched the account", async () => {
    updateMatched = [];
    const res = await save({ kind: "account-upsert", id: "base-acct", value: BASE_ACCT });
    expect(res.status).toBe(200);
    expect(writesTo(accountOwners)).toEqual({ deleted: 0, inserted: 0 });
  });

  it("rewrites goal funding links only when the scoped update matched the expense", async () => {
    updateMatched = [];
    const res = await save({ kind: "expense-upsert", id: "base-exp", value: BASE_EXP });
    expect(res.status).toBe(200);
    expect(writesTo(expenseDedicatedAccounts)).toEqual({ deleted: 0, inserted: 0 });
  });
});

/**
 * Held editor changes (the Details editors' saves inside the Solver) are
 * written through the scenario→base promote machinery, in the same transaction
 * as the controls and BEFORE them, so a control moved after a dialog save wins.
 */
describe("save-to-base — held editor changes", () => {
  const SAVE_ID = "00000000-0000-4000-8000-0000000000b1";
  const HELD_ACCT = "00000000-0000-4000-8000-0000000000a1";
  const HELD_EXP = "00000000-0000-4000-8000-0000000000e1";
  const NEW_RULE = "00000000-0000-4000-8000-0000000000c1";
  const GIFT = "00000000-0000-4000-8000-0000000000d1";
  const FOREIGN = "00000000-0000-4000-8000-0000000000f1";
  const BASE_EXP = "00000000-0000-4000-8000-0000000000e2";
  /** The fixture plan with one uuid-keyed expense a held entry can target. */
  const baseWith = (expense: Record<string, unknown>) =>
    buildClientData({
      expenses: [
        { id: BASE_EXP, type: "insurance", name: "Life Insurance", annualAmount: 5000, startYear: 2026, endYear: 2045, growthRate: 0.02, ...expense },
      ] as ClientData["expenses"],
    });
  const BASE_SCOPE = (table: typeof expenses, id: string) =>
    and(eq(table.id, id), eq(table.clientId, CLIENT_ID), eq(table.scenarioId, "base-scenario-id"));

  const held = (op: "add" | "edit" | "remove", targetKind: string, targetId: string, payload: unknown) => ({
    kind: "held-change",
    op,
    targetKind,
    targetId,
    payload,
    saveId: SAVE_ID,
  });
  const save = (mutations: unknown[]) => POST(makeRequest({ source: "base", mutations }), ctx as never);

  /** Base is `base`; the source load (the one carrying held changes) applies
   *  them, as `loadEffectiveTree` does. */
  function trees(base: ClientData) {
    vi.mocked(loadEffectiveTree).mockImplementation((async (
      _c: string,
      _f: string,
      _s: string,
      _t: unknown,
      extra: ScenarioChange[] = [],
    ) => ({
      effectiveTree: extra.length > 0 ? applyScenarioChanges(base, extra, {}, []).effectiveTree : base,
      warnings: [],
    })) as never);
  }

  const NEW_ACCOUNT = {
    id: HELD_ACCT,
    name: "New brokerage",
    category: "taxable",
    subType: "brokerage",
    value: 1000,
    basis: 1000,
    growthRate: 0.05,
    rmdEnabled: false,
    titlingType: "jtwros",
    owners: [{ kind: "family_member", familyMemberId: "fm-1", percent: 1 }],
  };

  beforeEach(() => {
    vi.mocked(db.transaction).mockClear();
    vi.mocked(loadEffectiveTree).mockClear();
    vi.mocked(assertAccountsInClient).mockClear();
    vi.mocked(recordAudit).mockClear();
    trees(buildClientData());
  });

  it("writes held entries through executeBaseWritePlan before control writes, in one transaction", async () => {
    trees(baseWith({}));
    const res = await save([
      { kind: "retirement-age", person: "client", age: 67 },
      held("edit", "expense", BASE_EXP, { annualAmount: { from: 5000, to: 6500 } }),
    ]);
    expect(res.status).toBe(200);
    expect(db.transaction).toHaveBeenCalledTimes(1);
    const heldWrite = updates.findIndex((u) => u.table === expenses);
    const controlWrite = updates.findIndex((u) => u.table === clients);
    expect(updates[heldWrite]).toMatchObject({ set: { annualAmount: "6500" }, where: BASE_SCOPE(expenses, BASE_EXP) });
    expect(updates[controlWrite].set).toMatchObject({ retirementAge: 67 });
    expect(heldWrite).toBeLessThan(controlWrite);
  });

  it("refuses a held recurring gift", async () => {
    const res = await save([
      held("add", "gift", GIFT, {
        id: GIFT, kind: "series", startYear: 2027, endYear: 2031, annualAmount: 19_000,
        amountMode: "fixed", inflationAdjust: false, grantor: "client",
        recipient: { kind: "family_member", id: "fm-1" }, crummey: false,
      }),
    ]);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(
      "A recurring gift can't be saved to base facts from the Solver. Save as a scenario instead.",
    );
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("saves a held one-time gift add without the recurring-gift refusal", async () => {
    const res = await save([
      held("add", "gift", GIFT, {
        id: GIFT, kind: "cash-once", year: 2030, amount: 50_000, grantor: "client",
        recipient: { kind: "family_member", id: "fm-1" }, crummey: false,
      }),
    ]);
    expect(res.status).toBe(200);
    // A gift's add writes the gift under its own id (an edit of a base gift is an add).
    expect(updates.find((u) => u.table === gifts)?.where).toEqual(and(eq(gifts.id, GIFT), eq(gifts.clientId, CLIENT_ID)));
  });

  it("a held gift remove deletes that id from base's gift_series partition", async () => {
    const res = await save([held("remove", "gift", GIFT, null)]);
    expect(res.status).toBe(200);
    expect(deletes.filter((d) => d.table === giftSeries).map((d) => d.where)).toEqual([
      and(eq(giftSeries.id, GIFT), eq(giftSeries.clientId, CLIENT_ID), eq(giftSeries.scenarioId, "base-scenario-id")),
    ]);
  });

  // Entries left behind (held back, switched off) name a held add by its id;
  // the base row keeps that id so they still resolve after the save.
  it("a held add is written under its own id, which a held-back gift to it still names", async () => {
    const KIM = "00000000-0000-4000-8000-0000000000a7";
    const kim = held("add", "family_member", KIM, { id: KIM, firstName: "Kim", relationship: "child" });
    const giftToKim = held("add", "gift", GIFT, {
      id: GIFT, kind: "series", startYear: 2027, endYear: 2031, annualAmount: 19_000,
      amountMode: "fixed", inflationAdjust: false, grantor: "client",
      recipient: { kind: "family_member", id: KIM }, crummey: false,
    });
    const { savable, held: kept } = partitionBaseSavableMutations([kim, giftToKim] as SolverMutation[]);
    expect(kept).toEqual([giftToKim]);

    const res = await save(savable);
    expect(res.status).toBe(200);
    const inserted = inserts.find((i) => i.table === familyMembers)?.values as { id?: string };
    expect(inserted.id).toBe(KIM);
    expect(updates.filter((u) => u.table === familyMembers)).toEqual([]);
  });

  it("a held account keeps its id, so a switched-off savings rule on it still names it", async () => {
    // The rule is off, so it is not posted; it stays in the list naming HELD_ACCT.
    const res = await save([held("add", "account", HELD_ACCT, NEW_ACCOUNT)]);
    expect(res.status).toBe(200);
    expect((inserts.find((i) => i.table === accounts)?.values as { id?: string }).id).toBe(HELD_ACCT);
  });

  it("a control 529's Roth rollover to a held-added account names the row the held add wrote", async () => {
    const CONTROL_529 = "00000000-0000-4000-8000-0000000000a8";
    const res = await save([
      held("add", "account", HELD_ACCT, { ...NEW_ACCOUNT, category: "retirement", subType: "roth_ira" }),
      {
        kind: "account-upsert",
        id: CONTROL_529,
        value: {
          ...ACCT,
          id: CONTROL_529,
          name: "Kim's 529",
          category: "education_savings",
          subType: "529",
          education529: { beneficiaryFamilyMemberId: "fm-1", rothRolloverEnabled: true, rothRolloverAccountId: HELD_ACCT },
        },
      },
    ]);
    expect(res.status).toBe(200);
    const accountRows = inserts.filter((i) => i.table === accounts).map((i) => i.values as Record<string, unknown>);
    expect(accountRows[0].id).toBe(HELD_ACCT);
    expect(accountRows[1]).toMatchObject({ name: "Kim's 529", rothRolloverAccountId: HELD_ACCT });
  });

  it("a held add whose id is already taken fails the whole save", async () => {
    vi.mocked(db.transaction).mockImplementationOnce((async (fn: (tx: unknown) => Promise<unknown>) => {
      const taken = Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" });
      const tx = {
        insert: () => ({ values: () => ({ returning: async () => { throw taken; } }) }),
      };
      return fn(tx);
    }) as never);
    const res = await save([held("add", "account", HELD_ACCT, NEW_ACCOUNT)]);
    expect(res.ok).toBe(false);
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("a held add's new id reaches a control savings rule through idRemap", async () => {
    const res = await save([
      held("add", "account", HELD_ACCT, NEW_ACCOUNT),
      {
        kind: "savings-rule-upsert",
        id: NEW_RULE,
        value: {
          id: NEW_RULE, accountId: HELD_ACCT, annualAmount: 6000, startYear: 2026, endYear: 2035,
          isDeductible: false, applyContributionLimit: true, contributeMax: false,
        },
      },
    ]);
    expect(res.status).toBe(200);
    expect(inserts.find((i) => i.table === accounts)?.values).toMatchObject({ name: "New brokerage" });
    expect(inserts.find((i) => i.table === savingsRules)?.values).toMatchObject({ accountId: HELD_ACCT });
    // The held account is this batch's own insert, not a foreign id.
    for (const [, ids] of vi.mocked(assertAccountsInClient).mock.calls) expect(ids).not.toContain(HELD_ACCT);
  });

  it("audit carries heldCounts", async () => {
    const res = await save([held("add", "account", HELD_ACCT, NEW_ACCOUNT)]);
    expect(res.status).toBe(200);
    expect((await res.json()).heldCounts).toEqual({ account: 1 });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ heldCounts: { account: 1 } }) }),
    );
  });

  it("rejects a malformed held-change with 400 before any query", async () => {
    // An add's payload must carry its own target id.
    const res = await save([held("add", "account", HELD_ACCT, { ...NEW_ACCOUNT, id: FOREIGN })]);
    expect(res.status).toBe(400);
    expect(loadEffectiveTree).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("a scale lever over a held living expense and a base one writes each amount once", async () => {
    trees(baseWith({ type: "living", name: "Retirement", annualAmount: 100_000, startYear: 2035, endYear: 2055 }));
    const res = await save([
      held("add", "expense", HELD_EXP, {
        id: HELD_EXP, type: "living", name: "Travel", annualAmount: 5000, startYear: 2035, endYear: 2045, growthRate: 0,
      }),
      { kind: "living-expense-scale", multiplier: 1.1 },
    ]);
    expect(res.status).toBe(200);
    const inserted = inserts.find((i) => i.table === expenses)?.values as { annualAmount: string };
    expect(Number(inserted.annualAmount)).toBeCloseTo(5500);
    expect(updates).toContainEqual(
      expect.objectContaining({
        table: expenses,
        where: BASE_SCOPE(expenses, BASE_EXP),
        set: expect.objectContaining({ annualAmount: String(100_000 * 1.1) }),
      }),
    );
    // The lever's leftover write on the held add hits the row the insert wrote
    // under that id, and sets the same absolute amount the insert carries:
    // nothing compounds.
    expect(inserted).toHaveProperty("id", HELD_EXP);
    expect(updates).toContainEqual(
      expect.objectContaining({
        table: expenses,
        where: BASE_SCOPE(expenses, HELD_EXP),
        set: expect.objectContaining({ annualAmount: String(5000 * 1.1) }),
      }),
    );
    expect(Number(inserted.annualAmount)).toBe(5000 * 1.1);
  });

  it("refuses a held entry naming an item a Solver control adds", async () => {
    const res = await save([
      { kind: "account-upsert", id: HELD_ACCT, value: NEW_ACCOUNT },
      held("add", "savings_rule", NEW_RULE, {
        id: NEW_RULE, accountId: HELD_ACCT, annualAmount: 6000, startYear: 2026, endYear: 2035,
      }),
    ]);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(
      "An editor change uses something a Solver control adds, so it can't be saved to base facts yet. Save as a scenario instead.",
    );
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("refuses a held savings rule on another client's account", async () => {
    vi.mocked(assertAccountsInClient).mockImplementation((async (_c: string, ids: string[]) =>
      ids.includes(FOREIGN) ? { ok: false, reason: `Account ${FOREIGN} not owned by this client` } : { ok: true }) as never);
    const res = await save([
      held("add", "savings_rule", NEW_RULE, {
        id: NEW_RULE, accountId: FOREIGN, annualAmount: 6000, startYear: 2026, endYear: 2035,
      }),
    ]);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(`Account ${FOREIGN} not owned by this client`);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("stores a held expense edit's living items and total as held", async () => {
    // The total was set from these items when the edit was held; base must not recompute it.
    trees(baseWith({ type: "living", name: "Living", annualAmount: 80_000 }));
    const items = [{ id: "i-1", name: "Housing", amount: 3000, frequency: "monthly" }];
    const res = await save([
      held("edit", "expense", BASE_EXP, {
        livingItems: { from: null, to: items },
        annualAmount: { from: 80_000, to: "36000" },
      }),
    ]);
    expect(res.status).toBe(200);
    expect(updates.find((u) => u.table === expenses)?.set).toMatchObject({ livingItems: items, annualAmount: "36000" });
  });

  describe("revocable-trust tag", () => {
    const BASE_ACCT = { ...ACCT, id: "acct-1", revocableTrustName: null };
    const withBase = (revocableTrustName?: string | null) =>
      vi.mocked(loadEffectiveTree).mockResolvedValue({
        effectiveTree: {
          accounts: revocableTrustName === undefined ? [BASE_ACCT] : [{ ...BASE_ACCT, revocableTrustName }],
          savingsRules: [],
        },
        warnings: [],
      } as never);
    const save = (revocableTrustName: string | null) =>
      POST(
        makeRequest({
          source: "base",
          mutations: [
            { kind: "account-upsert", id: "acct-1", value: { ...BASE_ACCT, revocableTrustName } },
          ],
        }),
        ctx as never,
      );
    const trustInserts = () => inserts.filter((i) => i.table === revocableTrusts);
    const accountUpdate = () => updates.find((u) => u.table === accounts)!;

    it("tags an updated account into an existing revocable trust by name", async () => {
      withBase();
      revocableTrustRows = [{ id: "rt-1", name: "Rivera Family Trust" }];
      const res = await save("Rivera Family Trust");
      expect(res.status).toBe(200);
      expect(accountUpdate().set).toMatchObject({ revocableTrustId: "rt-1" });
      expect(trustInserts()).toHaveLength(0);
    });

    it("creates the revocable trust row when none has that name", async () => {
      withBase();
      revocableTrustRows = [];
      const res = await save("Rivera Family Trust");
      expect(res.status).toBe(200);
      expect(trustInserts()).toHaveLength(1);
      expect(trustInserts()[0].values).toMatchObject({ clientId: CLIENT_ID, name: "Rivera Family Trust" });
      // The mock echoes the inserted row with a generated id.
      expect(accountUpdate().set).toMatchObject({ revocableTrustId: "generated-account-id" });
    });

    it("marks the trust-creation audit row as a shared-access write", async () => {
      vi.mocked(requireClientEditAccess).mockResolvedValueOnce({ firmId: FIRM_ID, access: "shared" } as never);
      vi.mocked(recordAudit).mockClear();
      withBase();
      revocableTrustRows = [];
      const res = await save("Rivera Family Trust");
      expect(res.status).toBe(200);
      const created = vi.mocked(recordAudit).mock.calls.find(([a]) => a.action === "revocable_trust.create");
      expect(created?.[0].metadata).toMatchObject({
        name: "Rivera Family Trust",
        crossFirmActor: true,
        actorFirmId: FIRM_ID,
      });
    });

    it("clears the trust link when the tag is removed", async () => {
      withBase("Rivera Family Trust");
      const res = await save(null);
      expect(res.status).toBe(200);
      expect(accountUpdate().set).toHaveProperty("revocableTrustId", null);
    });

    it("leaves the trust link alone when the tag did not change", async () => {
      withBase("Rivera Family Trust");
      const res = await save("Rivera Family Trust");
      expect(res.status).toBe(200);
      expect(accountUpdate().set).not.toHaveProperty("revocableTrustId");
    });

    it("tags an inserted account", async () => {
      revocableTrustRows = [{ id: "rt-1", name: "Rivera Family Trust" }];
      const res = await POST(
        makeRequest({
          source: "base",
          mutations: [
            { kind: "account-upsert", id: "synthetic-new", value: { ...ACCT, revocableTrustName: "Rivera Family Trust" } },
          ],
        }),
        ctx as never,
      );
      expect(res.status).toBe(200);
      expect(inserts.find((i) => i.table === accounts)!.values).toMatchObject({ revocableTrustId: "rt-1" });
    });
  });
});
