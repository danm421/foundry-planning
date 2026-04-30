import { describe, expect, it } from "vitest";

import { commitAccounts } from "@/lib/imports/commit/accounts";
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

import { callsForTable, makeFakeTx } from "./commit-test-helpers";

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

describe("commitClientsIdentity", () => {
  it("skips when neither primary nor spouse is present", async () => {
    const { tx, calls } = makeFakeTx();
    const result = await commitClientsIdentity(tx, emptyPayload(), ctx);
    expect(result).toEqual({ created: 0, updated: 0, skipped: 1 });
    expect(calls).toHaveLength(0);
  });

  it("updates client row with primary + spouse fields", async () => {
    const { tx, calls } = makeFakeTx();
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
    const updates = callsForTable(calls, "clients");
    expect(updates).toHaveLength(1);
    const setValues = updates[0].op === "update" ? (updates[0].values as Record<string, unknown>) : {};
    expect(setValues.firstName).toBe("Jordan");
    expect(setValues.lastName).toBe("Doe");
    expect(setValues.dateOfBirth).toBe("1980-01-01");
    expect(setValues.filingStatus).toBe("married_filing_jointly");
    expect(setValues.spouseName).toBe("Riley");
    expect(setValues.spouseLastName).toBe("Doe");
    expect(setValues.spouseDob).toBe("1982-02-02");
  });

  it("skips empty fields rather than overwriting with undefined", async () => {
    const { tx, calls } = makeFakeTx();
    const payload: ImportPayload = {
      ...emptyPayload(),
      primary: { firstName: "Jordan" },
    };
    await commitClientsIdentity(tx, payload, ctx);
    const updates = callsForTable(calls, "clients");
    const setValues = updates[0].op === "update" ? (updates[0].values as Record<string, unknown>) : {};
    expect(setValues.firstName).toBe("Jordan");
    expect(setValues.lastName).toBeUndefined();
    expect(setValues.spouseName).toBeUndefined();
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
    const v = (callsForTable(calls, "expenses")[0] as { values: Record<string, unknown> }).values;
    expect(v.type).toBe("living");
    expect(v.annualAmount).toBe("50000");
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
