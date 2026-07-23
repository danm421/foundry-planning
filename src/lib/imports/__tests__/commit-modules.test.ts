import { describe, expect, it, vi } from "vitest";

// commitAccounts' owner-writing path calls validateOwnersTenant, which queries
// the real db. Stub only the tenant check (keep validateOwnersShape real) so
// these unit tests stay pure and never touch a database.
vi.mock("@/lib/ownership", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ownership")>();
  return { ...actual, validateOwnersTenant: vi.fn().mockResolvedValue(null) };
});

import { commitAccounts, resolveAccountCategory } from "@/lib/imports/commit/accounts";
import { commitClientsIdentity } from "@/lib/imports/commit/clients-identity";
import { commitEntities } from "@/lib/imports/commit/entities";
import { commitExpenses } from "@/lib/imports/commit/expenses";
import { commitFamilyMembers } from "@/lib/imports/commit/family-members";
import { commitIncomes } from "@/lib/imports/commit/incomes";
import { commitLiabilities } from "@/lib/imports/commit/liabilities";
import { commitLifeInsurance } from "@/lib/imports/commit/life-insurance";
import { commitWills } from "@/lib/imports/commit/wills";
import {
  WillCommitValidationError,
  type CommitWill,
} from "@/lib/imports/commit/will-types";
import type { Annotated, ImportPayload } from "@/lib/imports/types";

import { callsForTable, makeFakeTx, type FakeTxCall } from "./commit-test-helpers";

const ctx = {
  clientId: "client-1",
  scenarioId: "scenario-1",
  orgId: "org-1",
  userId: "user-1",
};

function emptyPayload(): ImportPayload {
  return {
    dependents: [],
    accounts: [],
    incomes: [],
    expenses: [],
    liabilities: [],
    lifePolicies: [],
    wills: [],
    entities: [],
    warnings: [],
  };
}

/**
 * Normalizes a recorded account_owners insert to an array of rows. The synthesis
 * path inserts a single object (client/spouse) or an array (joint); the owners[]
 * path inserts an array. Tests assert on the flattened rows regardless of shape.
 */
function ownerRows(call: FakeTxCall): Record<string, unknown>[] {
  const v = (call as { values: unknown }).values;
  return (Array.isArray(v) ? v : [v]) as Record<string, unknown>[];
}

describe("commitClientsIdentity", () => {
  it("skips when neither primary nor spouse is present", async () => {
    const { tx, calls } = makeFakeTx();
    const result = await commitClientsIdentity(tx, emptyPayload(), ctx);
    expect(result).toEqual({ created: 0, updated: 0, skipped: 1, warnings: [] });
    // A single select against `clients` is allowed (to discover the linked
    // crm_household_id); no writes should land on the legacy table.
    expect(calls.filter((c) => c.op !== "select")).toHaveLength(0);
  });

  it("updates client row + mirrors identity to CRM contacts", async () => {
    const { tx, calls, setSelectResult } = makeFakeTx();
    // Pretend the planning client is linked to a CRM household so the mirror
    // path actually fires.
    setSelectResult("clients", [{ crmHouseholdId: "household-1" }]);
    // Both contact rows already exist, so the mirror UPDATEs them in place
    // (the insert path is exercised by the single→married test above).
    setSelectResult("crm_household_contacts", [
      { id: "primary-1", role: "primary", lastName: "Doe" },
      { id: "spouse-1", role: "spouse", lastName: "Doe" },
    ]);
    const payload: ImportPayload = {
      ...emptyPayload(),
      primary: {
        firstName: "Jordan",
        lastName: "Doe",
        dateOfBirth: "1980-01-01",
        filingStatus: "married_filing_jointly",
      },
      spouse: { firstName: "Riley", lastName: "Doe", dateOfBirth: "1982-02-02" },
    };
    const result = await commitClientsIdentity(tx, payload, ctx);
    expect(result.updated).toBe(1);

    // Legacy clients update — still dual-written until Phase 9 drops the
    // columns.
    const updates = callsForTable(calls, "clients").filter((c) => c.op === "update");
    expect(updates).toHaveLength(1);
    const setValues = updates[0].op === "update" ? (updates[0].values as Record<string, unknown>) : {};
    expect(setValues.firstName).toBe("Jordan");
    expect(setValues.lastName).toBe("Doe");
    expect(setValues.dateOfBirth).toBe("1980-01-01");
    // The extractor emits IRS-style filing statuses; the DB `filing_status`
    // enum uses the planning vocabulary. Commit must translate before writing,
    // or Postgres rejects the value and rolls back the whole commit.
    expect(setValues.filingStatus).toBe("married_joint");
    expect(setValues.spouseName).toBe("Riley");
    expect(setValues.spouseLastName).toBe("Doe");
    expect(setValues.spouseDob).toBe("1982-02-02");

    // CRM mirror — one update per CRM contact role.
    const crmUpdates = callsForTable(calls, "crm_household_contacts").filter((c) => c.op === "update");
    expect(crmUpdates).toHaveLength(2);
    const crmValues = crmUpdates.map((u) => (u.op === "update" ? (u.values as Record<string, unknown>) : {}));
    expect(crmValues[0].firstName).toBe("Jordan");
    expect(crmValues[0].lastName).toBe("Doe");
    expect(crmValues[0].dateOfBirth).toBe("1980-01-01");
    expect(crmValues[1].firstName).toBe("Riley");
  });

  it("inserts a spouse CRM contact when the household started single", async () => {
    const { tx, calls, setSelectResult } = makeFakeTx();
    setSelectResult("clients", [{ crmHouseholdId: "household-1" }]);
    // Household was created single: only a primary contact row exists — there
    // is NO role='spouse' row for an UPDATE to land on.
    setSelectResult("crm_household_contacts", [
      { id: "primary-1", role: "primary", lastName: "Doe" },
    ]);
    const payload: ImportPayload = {
      ...emptyPayload(),
      primary: {
        firstName: "Jordan",
        lastName: "Doe",
        dateOfBirth: "1980-01-01",
        filingStatus: "married_filing_jointly",
      },
      spouse: { firstName: "Riley", lastName: "Doe", dateOfBirth: "1982-02-02" },
    };
    await commitClientsIdentity(tx, payload, ctx);

    // The spouse must be INSERTED (the single→married transition), not silently
    // dropped by an UPDATE that matches zero rows.
    const crmInserts = callsForTable(calls, "crm_household_contacts").filter(
      (c) => c.op === "insert",
    );
    expect(crmInserts).toHaveLength(1);
    const inserted =
      crmInserts[0].op === "insert"
        ? (crmInserts[0].values as Record<string, unknown>)
        : {};
    expect(inserted.role).toBe("spouse");
    expect(inserted.firstName).toBe("Riley");
    expect(inserted.lastName).toBe("Doe");
    expect(inserted.dateOfBirth).toBe("1982-02-02");
    expect(inserted.householdId).toBe("household-1");
  });

  it("re-syncs the denormalized household name when the import changes a name", async () => {
    const { tx, calls, setSelectResult } = makeFakeTx();
    setSelectResult("clients", [{ crmHouseholdId: "household-1" }]);
    // Contacts as they read back AFTER the import upserts the new names.
    setSelectResult("crm_household_contacts", [
      { role: "primary", firstName: "Jordan", lastName: "Doe" },
      { role: "spouse", firstName: "Riley", lastName: "Doe" },
    ]);
    // The stale denormalized name the household still carries.
    setSelectResult("crm_households", [{ name: "old placeholder name" }]);
    const payload: ImportPayload = {
      ...emptyPayload(),
      primary: { firstName: "Jordan", lastName: "Doe" },
      spouse: { firstName: "Riley", lastName: "Doe" },
    };
    await commitClientsIdentity(tx, payload, ctx);

    // The household name must be rewritten from the (now-updated) contacts.
    const householdUpdates = callsForTable(calls, "crm_households").filter(
      (c) => c.op === "update",
    );
    expect(householdUpdates).toHaveLength(1);
    const setValues =
      householdUpdates[0].op === "update"
        ? (householdUpdates[0].values as Record<string, unknown>)
        : {};
    expect(setValues.name).toBe("Jordan & Riley Doe");
  });

  it("does not touch the household name when no name field is imported", async () => {
    const { tx, calls, setSelectResult } = makeFakeTx();
    setSelectResult("clients", [{ crmHouseholdId: "household-1" }]);
    // Only a DOB comes in — the extractor recovered no usable name on either
    // slot, so the household name must be left alone.
    const payload: ImportPayload = {
      ...emptyPayload(),
      primary: { firstName: "", dateOfBirth: "1980-01-01" },
    };
    await commitClientsIdentity(tx, payload, ctx);
    expect(callsForTable(calls, "crm_households")).toHaveLength(0);
  });

  it("skips empty fields rather than overwriting with undefined", async () => {
    const { tx, calls, setSelectResult } = makeFakeTx();
    setSelectResult("clients", [{ crmHouseholdId: "household-1" }]);
    const payload: ImportPayload = {
      ...emptyPayload(),
      primary: { firstName: "Jordan" },
    };
    await commitClientsIdentity(tx, payload, ctx);
    const updates = callsForTable(calls, "clients").filter((c) => c.op === "update");
    const setValues = updates[0].op === "update" ? (updates[0].values as Record<string, unknown>) : {};
    expect(setValues.firstName).toBe("Jordan");
    expect(setValues.lastName).toBeUndefined();
    expect(setValues.spouseName).toBeUndefined();
  });

  it("skips CRM mirror when the planning client has no crm_household_id", async () => {
    const { tx, calls } = makeFakeTx();
    // Default select returns [] — no household link.
    const payload: ImportPayload = {
      ...emptyPayload(),
      primary: { firstName: "Jordan", lastName: "Doe" },
    };
    await commitClientsIdentity(tx, payload, ctx);
    // Legacy update still fires; CRM never gets touched.
    expect(callsForTable(calls, "clients").filter((c) => c.op === "update")).toHaveLength(1);
    expect(callsForTable(calls, "crm_household_contacts")).toHaveLength(0);
  });
});

describe("commitFamilyMembers", () => {
  it("inserts role='client' singleton when none exists", async () => {
    const { tx, calls } = makeFakeTx();
    const payload: ImportPayload = {
      ...emptyPayload(),
      primary: { firstName: "Jordan", lastName: "Doe" },
    };
    const result = await commitFamilyMembers(tx, payload, ctx);
    expect(result.created).toBe(1);
    const inserts = callsForTable(calls, "family_members").filter((c) => c.op === "insert");
    expect(inserts).toHaveLength(1);
    const values = (inserts[0] as { values: Record<string, unknown> }).values;
    expect(values.role).toBe("client");
    expect(values.firstName).toBe("Jordan");
  });

  it("updates existing role='client' singleton", async () => {
    const { tx, calls, setSelectResult } = makeFakeTx();
    setSelectResult("family_members", [{ id: "fm-existing", role: "client" }]);
    const payload: ImportPayload = {
      ...emptyPayload(),
      primary: { firstName: "Jordan" },
    };
    const result = await commitFamilyMembers(tx, payload, ctx);
    expect(result.updated).toBe(1);
    expect(result.created).toBe(0);
    const updates = callsForTable(calls, "family_members").filter((c) => c.op === "update");
    expect(updates).toHaveLength(1);
  });

  it("inserts new dependents and updates exact-matched ones", async () => {
    const { tx, calls } = makeFakeTx();
    const payload: ImportPayload = {
      ...emptyPayload(),
      dependents: [
        {
          firstName: "Sam",
          relationship: "child",
          match: { kind: "new" },
        },
        {
          firstName: "Avery",
          relationship: "child",
          match: { kind: "exact", existingId: "fm-99" },
        },
      ],
    };
    const result = await commitFamilyMembers(tx, payload, ctx);
    expect(result.created).toBe(1);
    expect(result.updated).toBe(1);
    expect(result.skipped).toBe(0);
    const fmCalls = callsForTable(calls, "family_members");
    const inserts = fmCalls.filter((c) => c.op === "insert");
    const updates = fmCalls.filter((c) => c.op === "update");
    expect(inserts).toHaveLength(1);
    expect(updates).toHaveLength(1);
  });

  it("skips dependents annotated as fuzzy", async () => {
    const { tx, calls } = makeFakeTx();
    const payload: ImportPayload = {
      ...emptyPayload(),
      dependents: [
        {
          firstName: "Sam",
          match: { kind: "fuzzy", candidates: [{ id: "x", score: 0.5 }] },
        },
      ],
    };
    const result = await commitFamilyMembers(tx, payload, ctx);
    expect(result.skipped).toBe(1);
    expect(result.created).toBe(0);
    expect(callsForTable(calls, "family_members").filter((c) => c.op === "insert")).toHaveLength(0);
  });
});

describe("resolveAccountCategory", () => {
  it("promotes a 529 misclassified as taxable to education_savings", () => {
    expect(resolveAccountCategory({ name: "Emma 529", category: "taxable", subType: "529" }))
      .toBe("education_savings");
  });

  it("promotes a 529 with no category at all", () => {
    expect(resolveAccountCategory({ name: "Emma 529", subType: "529" }))
      .toBe("education_savings");
  });

  it("leaves a non-529 taxable account alone", () => {
    expect(resolveAccountCategory({ name: "Joint Brokerage", category: "taxable", subType: "brokerage" }))
      .toBe("taxable");
  });

  it("defaults a category-less non-529 account to taxable, as before", () => {
    expect(resolveAccountCategory({ name: "Mystery" })).toBe("taxable");
  });
});

describe("commitAccounts", () => {
  it("inserts new accounts with synthesized owner row when client FM exists", async () => {
    const { tx, calls, setSelectResult } = makeFakeTx();
    setSelectResult("family_members", [
      { id: "fm-client", role: "client" },
      { id: "fm-spouse", role: "spouse" },
    ]);
    const payload: ImportPayload = {
      ...emptyPayload(),
      accounts: [
        {
          name: "Brokerage",
          category: "taxable",
          subType: "brokerage",
          value: 100000,
          owner: "client",
          match: { kind: "new" },
        },
      ],
    };
    const result = await commitAccounts(tx, payload, ctx);
    expect(result.created).toBe(1);
    const accountInserts = callsForTable(calls, "accounts").filter((c) => c.op === "insert");
    expect(accountInserts).toHaveLength(1);
    const ownerInserts = callsForTable(calls, "account_owners").filter((c) => c.op === "insert");
    expect(ownerInserts).toHaveLength(1);
    const ownerVal = (ownerInserts[0] as { values: Record<string, unknown> }).values;
    expect(ownerVal.familyMemberId).toBe("fm-client");
    expect(ownerVal.percent).toBe("1.0000");
  });

  it("synthesizes joint ownership when both client + spouse FM rows exist", async () => {
    const { tx, calls, setSelectResult } = makeFakeTx();
    setSelectResult("family_members", [
      { id: "fm-client", role: "client" },
      { id: "fm-spouse", role: "spouse" },
    ]);
    const payload: ImportPayload = {
      ...emptyPayload(),
      accounts: [
        {
          name: "Joint Brokerage",
          category: "taxable",
          owner: "joint",
          match: { kind: "new" },
        },
      ],
    };
    await commitAccounts(tx, payload, ctx);
    const ownerInserts = callsForTable(calls, "account_owners").filter((c) => c.op === "insert");
    expect(ownerInserts).toHaveLength(1);
    const values = (ownerInserts[0] as { values: unknown }).values as unknown[];
    expect(values).toHaveLength(2);
    expect((values[0] as Record<string, unknown>).percent).toBe("0.5000");
    expect((values[1] as Record<string, unknown>).percent).toBe("0.5000");
  });

  it("skips owner insert when no client FM row exists", async () => {
    const { tx, calls, setSelectResult } = makeFakeTx();
    setSelectResult("family_members", []);
    const payload: ImportPayload = {
      ...emptyPayload(),
      accounts: [
        {
          name: "Brokerage",
          category: "taxable",
          owner: "client",
          match: { kind: "new" },
        },
      ],
    };
    await commitAccounts(tx, payload, ctx);
    expect(callsForTable(calls, "account_owners")).toHaveLength(0);
  });

  it("updates exact-matched accounts without touching owners", async () => {
    const { tx, calls } = makeFakeTx();
    const payload: ImportPayload = {
      ...emptyPayload(),
      accounts: [
        {
          name: "Brokerage",
          category: "taxable",
          value: 200000,
          match: { kind: "exact", existingId: "acct-1" },
        },
      ],
    };
    const result = await commitAccounts(tx, payload, ctx);
    expect(result.updated).toBe(1);
    expect(callsForTable(calls, "account_owners")).toHaveLength(0);
    const updates = callsForTable(calls, "accounts").filter((c) => c.op === "update");
    expect(updates).toHaveLength(1);
    const setValues = (updates[0] as { values: Record<string, unknown> }).values;
    expect(setValues.value).toBe("200000");
  });

  it("skips fuzzy-matched accounts", async () => {
    const { tx } = makeFakeTx();
    const payload: ImportPayload = {
      ...emptyPayload(),
      accounts: [
        {
          name: "Ambiguous",
          match: { kind: "fuzzy", candidates: [{ id: "a", score: 0.6 }] },
        },
      ],
    };
    const result = await commitAccounts(tx, payload, ctx);
    expect(result.skipped).toBe(1);
  });

  it("writes growthSource + modelPortfolioId on a new account insert", async () => {
    const { tx, calls, setSelectResult } = makeFakeTx();
    setSelectResult("family_members", [{ id: "fm-client", role: "client" }]);
    const payload: ImportPayload = {
      ...emptyPayload(),
      accounts: [
        {
          name: "Brokerage",
          category: "taxable",
          owner: "client",
          growthSource: "model_portfolio",
          modelPortfolioId: "mp-1",
          match: { kind: "new" },
        },
      ],
    };
    await commitAccounts(tx, payload, ctx);
    const accountInserts = callsForTable(calls, "accounts").filter((c) => c.op === "insert");
    expect(accountInserts).toHaveLength(1);
    const values = (accountInserts[0] as { values: Record<string, unknown> }).values;
    expect(values.growthSource).toBe("model_portfolio");
    expect(values.modelPortfolioId).toBe("mp-1");
  });

  it("defaults rmdEnabled by sub-type on a new account insert when not extracted", async () => {
    const { tx, calls, setSelectResult } = makeFakeTx();
    setSelectResult("family_members", [{ id: "fm-client", role: "client" }]);
    const payload: ImportPayload = {
      ...emptyPayload(),
      accounts: [
        { name: "Trad IRA", category: "retirement", subType: "traditional_ira", owner: "client", match: { kind: "new" } },
        { name: "Roth IRA", category: "retirement", subType: "roth_ira", owner: "client", match: { kind: "new" } },
      ],
    };
    await commitAccounts(tx, payload, ctx);
    const accountInserts = callsForTable(calls, "accounts").filter((c) => c.op === "insert");
    expect(accountInserts).toHaveLength(2);
    const trad = (accountInserts[0] as { values: Record<string, unknown> }).values;
    const roth = (accountInserts[1] as { values: Record<string, unknown> }).values;
    expect(trad.rmdEnabled).toBe(true);
    expect(roth.rmdEnabled).toBe(false);
  });

  it("respects an explicitly-extracted rmdEnabled flag over the sub-type default", async () => {
    const { tx, calls, setSelectResult } = makeFakeTx();
    setSelectResult("family_members", [{ id: "fm-client", role: "client" }]);
    const payload: ImportPayload = {
      ...emptyPayload(),
      accounts: [
        { name: "Trad IRA", category: "retirement", subType: "traditional_ira", owner: "client", rmdEnabled: false, match: { kind: "new" } },
      ],
    };
    await commitAccounts(tx, payload, ctx);
    const accountInserts = callsForTable(calls, "accounts").filter((c) => c.op === "insert");
    const trad = (accountInserts[0] as { values: Record<string, unknown> }).values;
    expect(trad.rmdEnabled).toBe(false);
  });

  it("sets growthSource + modelPortfolioId on an exact update", async () => {
    const { tx, calls } = makeFakeTx();
    const payload: ImportPayload = {
      ...emptyPayload(),
      accounts: [
        {
          name: "Brokerage",
          category: "taxable",
          growthSource: "inflation",
          modelPortfolioId: null,
          match: { kind: "exact", existingId: "acct-1" },
        },
      ],
    };
    await commitAccounts(tx, payload, ctx);
    const updates = callsForTable(calls, "accounts").filter((c) => c.op === "update");
    expect(updates).toHaveLength(1);
    const setValues = (updates[0] as { values: Record<string, unknown> }).values;
    expect(setValues.growthSource).toBe("inflation");
    expect(setValues.modelPortfolioId).toBeNull();
  });

  it("heals an exact-matched account's category to education_savings when subType is edited to 529", async () => {
    const { tx, calls } = makeFakeTx();
    const payload: ImportPayload = {
      ...emptyPayload(),
      accounts: [
        {
          name: "Emma 529",
          subType: "529",
          match: { kind: "exact", existingId: "acct-1" },
        },
      ],
    };
    await commitAccounts(tx, payload, ctx);
    const updates = callsForTable(calls, "accounts").filter((c) => c.op === "update");
    expect(updates).toHaveLength(1);
    const setValues = (updates[0] as { values: Record<string, unknown> }).values;
    expect(setValues.category).toBe("education_savings");
    expect(setValues.subType).toBe("529");
  });

  it("does not clobber category on an exact update that only edits subType to a non-529 value", async () => {
    const { tx, calls } = makeFakeTx();
    const payload: ImportPayload = {
      ...emptyPayload(),
      accounts: [
        {
          name: "Trad IRA",
          subType: "traditional_ira",
          match: { kind: "exact", existingId: "acct-1" },
        },
      ],
    };
    await commitAccounts(tx, payload, ctx);
    const updates = callsForTable(calls, "accounts").filter((c) => c.op === "update");
    expect(updates).toHaveLength(1);
    const setValues = (updates[0] as { values: Record<string, unknown> }).values;
    expect(setValues.subType).toBe("traditional_ira");
    expect(setValues).not.toHaveProperty("category");
  });

  it("writes the advisor-confirmed owners[] when tenant validation passes", async () => {
    const { tx, calls, setSelectResult } = makeFakeTx();
    setSelectResult("family_members", [{ id: "fm-c", role: "client" }]);
    const payload: ImportPayload = {
      ...emptyPayload(),
      accounts: [
        {
          name: "Brokerage",
          category: "taxable",
          owners: [{ kind: "family_member", familyMemberId: "fm-c", percent: 1 }],
          match: { kind: "new" },
        },
      ],
    };
    await commitAccounts(tx, payload, ctx);
    const ownerInserts = callsForTable(calls, "account_owners").filter((c) => c.op === "insert");
    expect(ownerInserts).toHaveLength(1);
    // owners[] is written as a single batched insert (array of rows).
    const rows = (ownerInserts[0] as { values: unknown }).values as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0].familyMemberId).toBe("fm-c");
    expect(Number(rows[0].percent)).toBe(1);
  });

  it("falls back to coarse joint synthesis when owners[] is empty", async () => {
    const { tx, calls, setSelectResult } = makeFakeTx();
    setSelectResult("family_members", [
      { id: "fm-client", role: "client" },
      { id: "fm-spouse", role: "spouse" },
    ]);
    const payload: ImportPayload = {
      ...emptyPayload(),
      accounts: [
        {
          name: "Joint Brokerage",
          category: "taxable",
          owner: "joint",
          owners: [],
          match: { kind: "new" },
        },
      ],
    };
    await commitAccounts(tx, payload, ctx);
    const ownerInserts = callsForTable(calls, "account_owners").filter((c) => c.op === "insert");
    expect(ownerInserts).toHaveLength(1);
    const values = (ownerInserts[0] as { values: unknown }).values as unknown[];
    expect(values).toHaveLength(2);
    expect((values[0] as Record<string, unknown>).percent).toBe("0.5000");
  });

  // ── Retirement single-owner-100% coercion ──────────────────────────────────
  // A deferred DB trigger (account_owners_retirement_check) rejects any
  // retirement account whose account_owners isn't exactly one row at 100%, and
  // fires at COMMIT — so a mis-labelled joint IRA/401k rolls back the whole
  // import. The commit must collapse such ownership to a single owner.

  it("collapses a joint owners[] on a retirement account to the client at 100%", async () => {
    const { tx, calls, setSelectResult } = makeFakeTx();
    setSelectResult("family_members", [
      { id: "fm-client", role: "client" },
      { id: "fm-spouse", role: "spouse" },
    ]);
    const payload: ImportPayload = {
      ...emptyPayload(),
      accounts: [
        {
          name: "Schwab - Inherited IRA",
          category: "retirement",
          subType: "traditional_ira",
          owner: "joint",
          owners: [
            { kind: "family_member", familyMemberId: "fm-client", percent: 0.5 },
            { kind: "family_member", familyMemberId: "fm-spouse", percent: 0.5 },
          ],
          match: { kind: "new" },
        },
      ],
    };
    await commitAccounts(tx, payload, ctx);
    const ownerInserts = callsForTable(calls, "account_owners").filter((c) => c.op === "insert");
    expect(ownerInserts).toHaveLength(1);
    const rows = ownerRows(ownerInserts[0]);
    expect(rows).toHaveLength(1);
    expect(rows[0].familyMemberId).toBe("fm-client");
    expect(rows[0].percent).toBe("1.0000");
  });

  it("collapses owner='joint' synthesis on a retirement account to the client at 100%", async () => {
    const { tx, calls, setSelectResult } = makeFakeTx();
    setSelectResult("family_members", [
      { id: "fm-client", role: "client" },
      { id: "fm-spouse", role: "spouse" },
    ]);
    const payload: ImportPayload = {
      ...emptyPayload(),
      accounts: [
        {
          name: "Rollover 401k",
          category: "retirement",
          subType: "401k",
          owner: "joint",
          match: { kind: "new" },
        },
      ],
    };
    await commitAccounts(tx, payload, ctx);
    const ownerInserts = callsForTable(calls, "account_owners").filter((c) => c.op === "insert");
    expect(ownerInserts).toHaveLength(1);
    const rows = ownerRows(ownerInserts[0]);
    expect(rows).toHaveLength(1);
    expect(rows[0].familyMemberId).toBe("fm-client");
    expect(rows[0].percent).toBe("1.0000");
  });

  it("keeps a spouse-owned retirement account assigned to the spouse at 100%", async () => {
    const { tx, calls, setSelectResult } = makeFakeTx();
    setSelectResult("family_members", [
      { id: "fm-client", role: "client" },
      { id: "fm-spouse", role: "spouse" },
    ]);
    const payload: ImportPayload = {
      ...emptyPayload(),
      accounts: [
        {
          name: "Spouse Rollover IRA",
          category: "retirement",
          subType: "roth_ira",
          owner: "spouse",
          match: { kind: "new" },
        },
      ],
    };
    await commitAccounts(tx, payload, ctx);
    const ownerInserts = callsForTable(calls, "account_owners").filter((c) => c.op === "insert");
    expect(ownerInserts).toHaveLength(1);
    const rows = ownerRows(ownerInserts[0]);
    expect(rows).toHaveLength(1);
    expect(rows[0].familyMemberId).toBe("fm-spouse");
    expect(rows[0].percent).toBe("1.0000");
  });

  it("preserves an explicit single-owner owners[] on a retirement account", async () => {
    const { tx, calls, setSelectResult } = makeFakeTx();
    setSelectResult("family_members", [
      { id: "fm-client", role: "client" },
      { id: "fm-spouse", role: "spouse" },
    ]);
    const payload: ImportPayload = {
      ...emptyPayload(),
      accounts: [
        {
          name: "Spouse Roth",
          category: "retirement",
          subType: "roth_ira",
          owner: "spouse",
          owners: [{ kind: "family_member", familyMemberId: "fm-spouse", percent: 1 }],
          match: { kind: "new" },
        },
      ],
    };
    await commitAccounts(tx, payload, ctx);
    const ownerInserts = callsForTable(calls, "account_owners").filter((c) => c.op === "insert");
    expect(ownerInserts).toHaveLength(1);
    const rows = ownerRows(ownerInserts[0]);
    expect(rows).toHaveLength(1);
    expect(rows[0].familyMemberId).toBe("fm-spouse");
    expect(Number(rows[0].percent)).toBe(1);
  });

  it("synthesizes a life-insurance policy row for a new life_insurance account", async () => {
    const { tx, calls, setSelectResult } = makeFakeTx();
    setSelectResult("family_members", [{ id: "fm-client", role: "client" }]);
    const payload: ImportPayload = {
      ...emptyPayload(),
      accounts: [
        {
          name: "Old Whole Life",
          category: "life_insurance",
          subType: "whole_life",
          value: 25000,
          owner: "client",
          match: { kind: "new" },
        },
      ],
    };
    const result = await commitAccounts(tx, payload, ctx);
    expect(result.created).toBe(1);
    const policyInserts = callsForTable(calls, "life_insurance_policies").filter((c) => c.op === "insert");
    expect(policyInserts).toHaveLength(1);
    const v = (policyInserts[0] as { values: Record<string, unknown> }).values;
    expect(v.policyType).toBe("whole");
  });

  it("does NOT synthesize a policy row for a non-life account", async () => {
    const { tx, calls, setSelectResult } = makeFakeTx();
    setSelectResult("family_members", [{ id: "fm-client", role: "client" }]);
    const payload: ImportPayload = {
      ...emptyPayload(),
      accounts: [
        { name: "Brokerage", category: "taxable", value: 1000, owner: "client", match: { kind: "new" } },
      ],
    };
    await commitAccounts(tx, payload, ctx);
    expect(callsForTable(calls, "life_insurance_policies")).toHaveLength(0);
  });

  it("inserts holdings for a new account", async () => {
    const { tx, calls, setSelectResult, setInsertId } = makeFakeTx();
    setSelectResult("family_members", [{ id: "fm-client", role: "client" }]);
    setInsertId("accounts", "acct-new");
    const resolved = new Map([["VTI", { securityId: "sec-vti", price: 210, asOf: "2026-06-09" }]]);
    const payload: ImportPayload = {
      ...emptyPayload(),
      accounts: [
        {
          name: "Brokerage", category: "taxable", owner: "client", match: { kind: "new" },
          holdings: [
            { ticker: "VTI", shares: 10, costBasis: 1500 },
            { name: "Cash", shares: 500 },
          ],
        },
      ],
    };
    const holdingsAccountIds: string[] = [];
    await commitAccounts(tx, payload, { ...ctx, resolvedHoldings: resolved, holdingsAccountIds });
    const hInserts = callsForTable(calls, "account_holdings").filter((c) => c.op === "insert");
    expect(hInserts).toHaveLength(1);
    const rows = (hInserts[0] as { values: Record<string, unknown>[] }).values;
    expect(rows).toHaveLength(2);
    expect(rows[0].securityId).toBe("sec-vti");
    expect(rows[0].price).toBe("210");
    expect(rows[1].securityId).toBeNull();
    expect(rows[1].price).toBe("1"); // cash defaulted
    expect(holdingsAccountIds).toEqual(["acct-new"]);
  });

  it("replaces holdings on an exact-matched account", async () => {
    const { tx, calls } = makeFakeTx();
    const payload: ImportPayload = {
      ...emptyPayload(),
      accounts: [
        {
          name: "Brokerage", category: "taxable", match: { kind: "exact", existingId: "acct-1" },
          holdings: [{ ticker: "VTI", shares: 1, costBasis: 100 }],
        },
      ],
    };
    const resolved = new Map([["VTI", { securityId: "sec-vti", price: null, asOf: null }]]);
    await commitAccounts(tx, payload, { ...ctx, resolvedHoldings: resolved, holdingsAccountIds: [] });
    expect(callsForTable(calls, "account_holdings").filter((c) => c.op === "delete")).toHaveLength(1);
    expect(callsForTable(calls, "account_holdings").filter((c) => c.op === "insert")).toHaveLength(1);
  });

  it("does not touch holdings when the account has none", async () => {
    const { tx, calls } = makeFakeTx();
    const payload: ImportPayload = {
      ...emptyPayload(),
      accounts: [{ name: "X", category: "taxable", match: { kind: "exact", existingId: "acct-9" } }],
    };
    await commitAccounts(tx, payload, { ...ctx, holdingsAccountIds: [] });
    expect(callsForTable(calls, "account_holdings")).toHaveLength(0);
  });

  it("persists statement marketValue for an untickered bond holding", async () => {
    const { tx, calls, setSelectResult, setInsertId } = makeFakeTx();
    setSelectResult("family_members", [{ id: "fm-client", role: "client" }]);
    setInsertId("accounts", "acct-new");
    const resolved = new Map(); // no tickers resolved
    const payload: ImportPayload = {
      ...emptyPayload(),
      accounts: [
        {
          name: "Bond Account",
          category: "taxable",
          owner: "client",
          match: { kind: "new" },
          holdings: [
            // Bond: price is per $100 of par; statement marketValue is authoritative
            { name: "US Treasury 4.5% 2034 CUSIP 912828YY0", shares: 25000, price: 109.81, marketValue: 27452.5, costBasis: 25000 },
          ],
        },
      ],
    };
    await commitAccounts(tx, payload, { ...ctx, resolvedHoldings: resolved, holdingsAccountIds: [] });
    const hInserts = callsForTable(calls, "account_holdings").filter((c) => c.op === "insert");
    expect(hInserts).toHaveLength(1);
    const rows = (hInserts[0] as { values: Record<string, unknown>[] }).values;
    expect(rows).toHaveLength(1);
    expect(rows[0].marketValue).toBe("27452.5");
  });

  it("stores null marketValue for a tickered (resolved) holding", async () => {
    const { tx, calls, setSelectResult, setInsertId } = makeFakeTx();
    setSelectResult("family_members", [{ id: "fm-client", role: "client" }]);
    setInsertId("accounts", "acct-new");
    const resolved = new Map([["VTI", { securityId: "sec-vti", price: 210, asOf: "2026-06-12" }]]);
    const payload: ImportPayload = {
      ...emptyPayload(),
      accounts: [
        {
          name: "Brokerage",
          category: "taxable",
          owner: "client",
          match: { kind: "new" },
          holdings: [
            { ticker: "VTI", shares: 10, price: 200, marketValue: 2000, costBasis: 1500 },
          ],
        },
      ],
    };
    await commitAccounts(tx, payload, { ...ctx, resolvedHoldings: resolved, holdingsAccountIds: [] });
    const hInserts = callsForTable(calls, "account_holdings").filter((c) => c.op === "insert");
    expect(hInserts).toHaveLength(1);
    const rows = (hInserts[0] as { values: Record<string, unknown>[] }).values;
    expect(rows).toHaveLength(1);
    expect(rows[0].marketValue).toBeNull();
  });

  it("stores null marketValue for an untickered holding with no marketValue", async () => {
    const { tx, calls, setSelectResult, setInsertId } = makeFakeTx();
    setSelectResult("family_members", [{ id: "fm-client", role: "client" }]);
    setInsertId("accounts", "acct-new");
    const resolved = new Map();
    const payload: ImportPayload = {
      ...emptyPayload(),
      accounts: [
        {
          name: "Cash Account",
          category: "cash",
          owner: "client",
          match: { kind: "new" },
          holdings: [
            { name: "Cash", shares: 5000 },
          ],
        },
      ],
    };
    await commitAccounts(tx, payload, { ...ctx, resolvedHoldings: resolved, holdingsAccountIds: [] });
    const hInserts = callsForTable(calls, "account_holdings").filter((c) => c.op === "insert");
    expect(hInserts).toHaveLength(1);
    const rows = (hInserts[0] as { values: Record<string, unknown>[] }).values;
    expect(rows).toHaveLength(1);
    expect(rows[0].marketValue).toBeNull();
  });
});

describe("commitIncomes", () => {
  it("inserts new with defaulted year window", async () => {
    const { tx, calls } = makeFakeTx();
    const year = new Date().getUTCFullYear();
    const payload: ImportPayload = {
      ...emptyPayload(),
      incomes: [
        {
          name: "Salary",
          type: "salary",
          annualAmount: 100000,
          owner: "client",
          match: { kind: "new" },
        },
      ],
    };
    await commitIncomes(tx, payload, ctx);
    const inserts = callsForTable(calls, "incomes").filter((c) => c.op === "insert");
    const v = (inserts[0] as { values: Record<string, unknown> }).values;
    expect(v.startYear).toBe(year);
    expect(v.endYear).toBe(year + 30);
    expect(v.annualAmount).toBe("100000");
  });

  it("updates exact-matched income preserving type/name", async () => {
    const { tx, calls } = makeFakeTx();
    const payload: ImportPayload = {
      ...emptyPayload(),
      incomes: [
        {
          name: "renamed-from-extraction",
          type: "salary",
          annualAmount: 105000,
          match: { kind: "exact", existingId: "inc-1" },
        },
      ],
    };
    const result = await commitIncomes(tx, payload, ctx);
    expect(result.updated).toBe(1);
    const updates = callsForTable(calls, "incomes").filter((c) => c.op === "update");
    const v = (updates[0] as { values: Record<string, unknown> }).values;
    expect(v.annualAmount).toBe("105000");
    expect(v.name).toBeUndefined();
    expect(v.type).toBeUndefined();
  });
});

// Social Security is special: the whole SS UI is per-person (the card renders a
// client slot and a spouse slot, each matched by owner). A generic insert with
// owner='joint' shows up in the cash-flow SS line (the engine sums every
// social_security row) but is orphaned in the editor. So the commit must
// reconcile extracted SS into the seeded per-person slots rather than insert
// raw rows. See create-client.ts for the seeded `social_security` slots.
describe("commitIncomes — Social Security reconciliation", () => {
  function ssSlot(owner: "client" | "spouse", extra: Record<string, unknown> = {}) {
    return {
      id: `ss-${owner}`,
      type: "social_security",
      owner,
      annualAmount: "0",
      // Distinct claim ages per slot so tests can prove each update hit the
      // right person's row (the fake tx doesn't capture the WHERE target).
      claimingAge: owner === "client" ? 66 : 68,
      claimingAgeMode: null,
      growthRate: "0.02",
      ...extra,
    };
  }

  function values(call: FakeTxCall): Record<string, unknown> {
    return (call as { values: Record<string, unknown> }).values;
  }

  it("splits a joint Social Security row 50/50 across the seeded client and spouse slots", async () => {
    const { tx, calls, setSelectResult } = makeFakeTx();
    setSelectResult("incomes", [ssSlot("client"), ssSlot("spouse")]);
    const payload: ImportPayload = {
      ...emptyPayload(),
      incomes: [
        { name: "Social Security", type: "social_security", owner: "joint", annualAmount: 78000, match: { kind: "new" } },
      ],
    };
    const result = await commitIncomes(tx, payload, ctx);

    const incomeCalls = callsForTable(calls, "incomes");
    // No raw joint row is inserted — the orphaning bug.
    expect(incomeCalls.filter((c) => c.op === "insert")).toHaveLength(0);
    const updates = incomeCalls.filter((c) => c.op === "update");
    expect(updates).toHaveLength(2);
    const vs = updates.map(values);
    expect(vs.every((v) => v.annualAmount === "39000")).toBe(true);
    expect(vs.every((v) => v.ssBenefitMode === "manual_amount")).toBe(true);
    // Each slot keeps its own claim age → proves the two updates targeted the
    // two distinct per-person rows.
    expect(vs.map((v) => v.claimingAge).sort()).toEqual([66, 68]);
    expect(result.updated).toBe(2);
    expect(result.created).toBe(0);
  });

  it("merges a client-owned Social Security row into the client slot, carrying benefit mode + claiming age", async () => {
    const { tx, calls, setSelectResult } = makeFakeTx();
    setSelectResult("incomes", [ssSlot("client"), ssSlot("spouse")]);
    const payload: ImportPayload = {
      ...emptyPayload(),
      incomes: [
        { name: "Harold's Social Security", type: "social_security", owner: "client", annualAmount: 35472, claimingAge: 70, match: { kind: "new" } },
      ],
    };
    const result = await commitIncomes(tx, payload, ctx);

    const updates = callsForTable(calls, "incomes").filter((c) => c.op === "update");
    expect(updates).toHaveLength(1);
    const v = values(updates[0]);
    expect(v.annualAmount).toBe("35472");
    expect(v.ssBenefitMode).toBe("manual_amount");
    expect(v.claimingAge).toBe(70);
    expect(v.claimingAgeMode).toBe("years");
    expect(callsForTable(calls, "incomes").filter((c) => c.op === "insert")).toHaveLength(0);
    expect(result.updated).toBe(1);
  });

  it("assigns a joint Social Security row entirely to the client when there is no spouse slot", async () => {
    const { tx, calls, setSelectResult } = makeFakeTx();
    setSelectResult("incomes", [ssSlot("client")]); // unmarried household — no spouse slot
    const payload: ImportPayload = {
      ...emptyPayload(),
      incomes: [
        { name: "Social Security", type: "social_security", owner: "joint", annualAmount: 50000, match: { kind: "new" } },
      ],
    };
    const result = await commitIncomes(tx, payload, ctx);

    const updates = callsForTable(calls, "incomes").filter((c) => c.op === "update");
    expect(updates).toHaveLength(1);
    expect(values(updates[0]).annualAmount).toBe("50000");
    expect(result.updated).toBe(1);
    expect(result.created).toBe(0);
  });

  it("sums multiple Social Security rows into the per-person slots (preserving the projection total)", async () => {
    const { tx, calls, setSelectResult } = makeFakeTx();
    setSelectResult("incomes", [ssSlot("client"), ssSlot("spouse")]);
    const payload: ImportPayload = {
      ...emptyPayload(),
      incomes: [
        { name: "Social Security", type: "social_security", owner: "joint", annualAmount: 78000, match: { kind: "new" } },
        { name: "Future Social Security", type: "social_security", owner: "joint", annualAmount: 85289, match: { kind: "new" } },
      ],
    };
    await commitIncomes(tx, payload, ctx);

    const updates = callsForTable(calls, "incomes").filter((c) => c.op === "update");
    expect(updates).toHaveLength(2);
    // (78000 + 85289) / 2 = 81644.5 per person; total preserved at 163289.
    expect(updates.map((u) => values(u).annualAmount)).toEqual(["81644.5", "81644.5"]);
  });

  it("skips a fuzzy-matched Social Security row", async () => {
    const { tx, calls, setSelectResult } = makeFakeTx();
    setSelectResult("incomes", [ssSlot("client"), ssSlot("spouse")]);
    const payload: ImportPayload = {
      ...emptyPayload(),
      incomes: [
        { name: "SS", type: "social_security", owner: "client", annualAmount: 1000, match: { kind: "fuzzy", candidates: [{ id: "x", score: 0.5 }] } },
      ],
    };
    const result = await commitIncomes(tx, payload, ctx);

    expect(result.skipped).toBe(1);
    expect(callsForTable(calls, "incomes").filter((c) => c.op === "update")).toHaveLength(0);
    expect(callsForTable(calls, "incomes").filter((c) => c.op === "insert")).toHaveLength(0);
  });

  it("processes a generic income normally while reconciling Social Security separately", async () => {
    const { tx, calls, setSelectResult } = makeFakeTx();
    setSelectResult("incomes", [ssSlot("client"), ssSlot("spouse")]);
    const payload: ImportPayload = {
      ...emptyPayload(),
      incomes: [
        { name: "Salary", type: "salary", owner: "client", annualAmount: 100000, match: { kind: "new" } },
        { name: "Social Security", type: "social_security", owner: "joint", annualAmount: 40000, match: { kind: "new" } },
      ],
    };
    await commitIncomes(tx, payload, ctx);

    const inserts = callsForTable(calls, "incomes").filter((c) => c.op === "insert");
    const updates = callsForTable(calls, "incomes").filter((c) => c.op === "update");
    expect(inserts).toHaveLength(1); // the salary is still a normal insert
    expect(values(inserts[0]).type).toBe("salary");
    expect(updates).toHaveLength(2); // SS split into both seeded slots
  });
});

describe("commitExpenses", () => {
  it("inserts new with defaults", async () => {
    const { tx, calls } = makeFakeTx();
    const payload: ImportPayload = {
      ...emptyPayload(),
      expenses: [
        { name: "Living", annualAmount: 50000, match: { kind: "new" } },
      ],
    };
    const result = await commitExpenses(tx, payload, ctx);
    expect(result.created).toBe(1);
    const v = (
      callsForTable(calls, "expenses").filter((c) => c.op === "insert")[0] as {
        values: Record<string, unknown>;
      }
    ).values;
    expect(v.type).toBe("living");
    expect(v.annualAmount).toBe("50000");
  });

  it("fills a living slot by amount and preserves its year window", async () => {
    const { tx, calls, setSelectResult } = makeFakeTx();
    setSelectResult("expenses", [{ id: "slot-current" }]);
    const payload: ImportPayload = {
      ...emptyPayload(),
      expenses: [
        {
          name: "Living Expenses",
          annualAmount: 60000,
          startYear: 2050,
          startYearRef: "plan_start",
          match: { kind: "exact", existingId: "slot-current" },
        },
      ],
    };
    const result = await commitExpenses(tx, payload, ctx);
    expect(result.updated).toBe(1);
    const upd = callsForTable(calls, "expenses").find((c) => c.op === "update") as {
      values: Record<string, unknown>;
    };
    expect(upd.values.annualAmount).toBe("60000");
    expect(upd.values.startYear).toBeUndefined();
    expect(upd.values.startYearRef).toBeUndefined();
    expect(upd.values.endYear).toBeUndefined();
  });

  it("still updates timing for a non-slot exact match", async () => {
    const { tx, calls, setSelectResult } = makeFakeTx();
    setSelectResult("expenses", []); // no isDefault slots
    const payload: ImportPayload = {
      ...emptyPayload(),
      expenses: [
        {
          name: "Housing",
          annualAmount: 24000,
          startYear: 2040,
          match: { kind: "exact", existingId: "exp-housing" },
        },
      ],
    };
    await commitExpenses(tx, payload, ctx);
    const upd = callsForTable(calls, "expenses").find((c) => c.op === "update") as {
      values: Record<string, unknown>;
    };
    expect(upd.values.annualAmount).toBe("24000");
    expect(upd.values.startYear).toBe(2040);
  });
});

describe("commitLiabilities", () => {
  it("inserts new with default term and synthesized client owner", async () => {
    const { tx, calls, setSelectResult } = makeFakeTx();
    setSelectResult("family_members", [{ id: "fm-client", role: "client" }]);
    const payload: ImportPayload = {
      ...emptyPayload(),
      liabilities: [
        {
          name: "Mortgage",
          balance: 250000,
          interestRate: 0.045,
          monthlyPayment: 1500,
          match: { kind: "new" },
        },
      ],
    };
    const result = await commitLiabilities(tx, payload, ctx);
    expect(result.created).toBe(1);
    const liInserts = callsForTable(calls, "liabilities").filter((c) => c.op === "insert");
    expect((liInserts[0] as { values: Record<string, unknown> }).values.termMonths).toBe(360);
    const ownerInserts = callsForTable(calls, "liability_owners").filter((c) => c.op === "insert");
    expect(ownerInserts).toHaveLength(1);
    const v = (ownerInserts[0] as { values: Record<string, unknown> }).values;
    expect(v.familyMemberId).toBe("fm-client");
  });

  it("auto-links a new mortgage to a matching real-estate account", async () => {
    const { tx, calls, setSelectResult } = makeFakeTx();
    setSelectResult("family_members", [{ id: "fm-client", role: "client" }]);
    setSelectResult("accounts", [{ id: "p-austin-home", name: "Home - Austin" }]);
    const payload: ImportPayload = {
      ...emptyPayload(),
      liabilities: [
        { name: "Mortgage - Austin Home", balance: 1200000, match: { kind: "new" } },
      ],
    };
    const result = await commitLiabilities(tx, payload, ctx);
    expect(result.created).toBe(1);
    const insert = callsForTable(calls, "liabilities").filter((c) => c.op === "insert")[0];
    expect((insert as { values: Record<string, unknown> }).values.linkedPropertyId).toBe("p-austin-home");
  });
});

describe("commitLifeInsurance", () => {
  it("inserts both account and policy rows on new", async () => {
    const { tx, calls, setSelectResult } = makeFakeTx();
    setSelectResult("family_members", [{ id: "fm-client", role: "client" }]);
    const payload: ImportPayload = {
      ...emptyPayload(),
      lifePolicies: [
        {
          accountName: "Term Life",
          policyType: "term",
          insuredPerson: "client",
          faceValue: 1000000,
          carrier: "Acme",
          match: { kind: "new" },
        },
      ],
    };
    const result = await commitLifeInsurance(tx, payload, ctx);
    expect(result.created).toBe(1);
    const acctInserts = callsForTable(calls, "accounts").filter((c) => c.op === "insert");
    expect(acctInserts).toHaveLength(1);
    expect((acctInserts[0] as { values: Record<string, unknown> }).values.subType).toBe("term");
    const policyInserts = callsForTable(calls, "life_insurance_policies").filter((c) => c.op === "insert");
    expect(policyInserts).toHaveLength(1);
    expect((policyInserts[0] as { values: Record<string, unknown> }).values.faceValue).toBe("1000000");
    expect(callsForTable(calls, "account_owners").filter((c) => c.op === "insert")).toHaveLength(1);
  });

  it("stores cash value on the account row when extracted", async () => {
    const { tx, calls, setSelectResult } = makeFakeTx();
    setSelectResult("family_members", [{ id: "fm-client", role: "client" }]);
    const payload: ImportPayload = {
      ...emptyPayload(),
      lifePolicies: [
        {
          accountName: "Brighthouse",
          policyType: "universal",
          insuredPerson: "spouse",
          faceValue: 3_000_000,
          cashValue: 588_000,
          match: { kind: "new" },
        },
      ],
    };
    const result = await commitLifeInsurance(tx, payload, ctx);
    expect(result.created).toBe(1);
    const acctInsert = callsForTable(calls, "accounts").filter((c) => c.op === "insert")[0];
    expect((acctInsert as { values: Record<string, unknown> }).values.value).toBe("588000");
    const policyInsert = callsForTable(calls, "life_insurance_policies").filter((c) => c.op === "insert")[0];
    expect((policyInsert as { values: Record<string, unknown> }).values.faceValue).toBe("3000000");
  });

  it("updates both account and policy rows on exact match", async () => {
    const { tx, calls, setSelectResult } = makeFakeTx();
    setSelectResult("family_members", []);
    const payload: ImportPayload = {
      ...emptyPayload(),
      lifePolicies: [
        {
          accountName: "Whole Life",
          policyType: "whole",
          insuredPerson: "spouse",
          faceValue: 500000,
          match: { kind: "exact", existingId: "acct-life-1" },
        },
      ],
    };
    const result = await commitLifeInsurance(tx, payload, ctx);
    expect(result.updated).toBe(1);
    const acctUpdates = callsForTable(calls, "accounts").filter((c) => c.op === "update");
    expect(acctUpdates).toHaveLength(1);
    const v = (acctUpdates[0] as { values: Record<string, unknown> }).values;
    expect(v.insuredPerson).toBe("spouse");
    expect(v.subType).toBe("whole_life");
    expect(callsForTable(calls, "life_insurance_policies").filter((c) => c.op === "update")).toHaveLength(1);
  });
});

describe("commitEntities", () => {
  it("inserts new with default trust type", async () => {
    const { tx, calls } = makeFakeTx();
    const payload: ImportPayload = {
      ...emptyPayload(),
      entities: [{ name: "Family Trust", match: { kind: "new" } }],
    };
    const result = await commitEntities(tx, payload, ctx);
    expect(result.created).toBe(1);
    const v = (callsForTable(calls, "entities")[0] as { values: Record<string, unknown> }).values;
    expect(v.entityType).toBe("trust");
  });

  it("updates exact-matched entity, preserving name", async () => {
    const { tx, calls } = makeFakeTx();
    const payload: ImportPayload = {
      ...emptyPayload(),
      entities: [
        {
          name: "Updated Name",
          entityType: "llc",
          match: { kind: "exact", existingId: "ent-1" },
        },
      ],
    };
    await commitEntities(tx, payload, ctx);
    const updates = callsForTable(calls, "entities").filter((c) => c.op === "update");
    const v = (updates[0] as { values: Record<string, unknown> }).values;
    expect(v.entityType).toBe("llc");
    expect(v.name).toBeUndefined();
  });
});

describe("commitWills", () => {
  function makeWill(overrides: Partial<CommitWill> = {}): CommitWill {
    return {
      grantor: "client",
      executor: "Jane Smith",
      bequests: [
        {
          recipientNameHint: "Sam",
          assetDescriptionHint: "Brokerage",
          percentage: 100,
          kind: "asset",
          name: "Brokerage to Sam",
          assetMode: "specific",
          accountId: "acct-1",
          condition: "always",
          recipients: [
            { recipientKind: "family_member", recipientId: "fm-sam", percentage: 100 },
          ],
        },
      ],
      ...overrides,
    };
  }

  it("inserts new will + bequests + recipients", async () => {
    const { tx, calls } = makeFakeTx();
    const payload: ImportPayload = {
      ...emptyPayload(),
      wills: [{ ...(makeWill() as object), match: { kind: "new" } }] as Annotated<
        ReturnType<typeof makeWill>
      >[] as unknown as ImportPayload["wills"],
    };
    const result = await commitWills(tx, payload, ctx);
    expect(result.created).toBe(1);
    expect(callsForTable(calls, "wills").filter((c) => c.op === "insert")).toHaveLength(1);
    expect(callsForTable(calls, "will_bequests").filter((c) => c.op === "insert")).toHaveLength(1);
    expect(callsForTable(calls, "will_bequest_recipients").filter((c) => c.op === "insert")).toHaveLength(1);
  });

  it("rejects an asset bequest with assetMode='specific' and no accountId", async () => {
    const { tx } = makeFakeTx();
    const will = makeWill({
      bequests: [
        {
          recipientNameHint: "Sam",
          assetDescriptionHint: "Anything",
          percentage: 100,
          kind: "asset",
          name: "Unmapped",
          assetMode: "specific",
          accountId: null,
          condition: "always",
          recipients: [
            { recipientKind: "family_member", recipientId: "fm-sam", percentage: 100 },
          ],
        },
      ],
    });
    const payload: ImportPayload = {
      ...emptyPayload(),
      wills: [{ ...(will as object), match: { kind: "new" } }] as unknown as ImportPayload["wills"],
    };
    await expect(commitWills(tx, payload, ctx)).rejects.toBeInstanceOf(WillCommitValidationError);
  });

  it("rejects a liability bequest with no liabilityId", async () => {
    const { tx } = makeFakeTx();
    const will = makeWill({
      bequests: [
        {
          recipientNameHint: "Sam",
          assetDescriptionHint: "Mortgage",
          percentage: 100,
          kind: "liability",
          name: "Mortgage liability",
          liabilityId: null,
          condition: "always",
          recipients: [
            { recipientKind: "family_member", recipientId: "fm-sam", percentage: 100 },
          ],
        },
      ],
    });
    const payload: ImportPayload = {
      ...emptyPayload(),
      wills: [{ ...(will as object), match: { kind: "new" } }] as unknown as ImportPayload["wills"],
    };
    await expect(commitWills(tx, payload, ctx)).rejects.toBeInstanceOf(WillCommitValidationError);
  });

  it("updates existing will, deleting prior bequests first", async () => {
    const { tx, calls } = makeFakeTx();
    const payload: ImportPayload = {
      ...emptyPayload(),
      wills: [
        {
          ...(makeWill() as object),
          match: { kind: "exact", existingId: "will-1" },
        },
      ] as unknown as ImportPayload["wills"],
    };
    const result = await commitWills(tx, payload, ctx);
    expect(result.updated).toBe(1);
    expect(callsForTable(calls, "will_bequests").filter((c) => c.op === "delete")).toHaveLength(1);
    expect(callsForTable(calls, "wills").filter((c) => c.op === "update")).toHaveLength(1);
    expect(callsForTable(calls, "will_bequests").filter((c) => c.op === "insert")).toHaveLength(1);
  });
});
