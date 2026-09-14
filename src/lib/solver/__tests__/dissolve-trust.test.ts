// src/lib/solver/__tests__/dissolve-trust.test.ts
//
// Dissolving a trust in the solver returns whatever it holds to the grantor's
// household and clears every reference to it. The sharp edge is dangling
// references: a trust is pointed at from several places besides account
// ownership, and each one is a way for value to be paid to an entity that no
// longer exists. Those cases assert against the APPLIED tree, not the mutation
// list — a shape assertion cannot catch them.
//
// The lever must also emit at most ONE mutation per key. The working set is a
// keyed Map (live-solver-workspace.tsx:1034, use-solver-draft.ts:81), so a
// second `account-upsert` for the same account REPLACES the first instead of
// composing with it — and its `{...a}` spread would restore the very owners the
// retitle just removed.
import { describe, it, expect } from "vitest";
import { buildDissolveTrustMutations } from "@/lib/solver/trust-levers";
import { applyMutations } from "@/lib/solver/apply-mutations";
import { SOLVER_MUTATION_SCHEMA } from "@/lib/solver/mutation-schema";
import { isBaseSavableMutation } from "@/lib/solver/mutations-to-base-updates";
import { mutationsToScenarioChanges } from "@/lib/solver/mutations-to-scenario-changes";
import { mutationKey } from "@/lib/solver/types";
import { buildCltRemainderGiftMutation } from "@/lib/solver/split-interest-levers";
import { applyWillSpecificBequests } from "@/engine/death-event/shared";
import { runProjection } from "@/engine/projection";
import {
  entityCheckingId,
  makeEntityCheckingAccount,
} from "@/lib/entities/entity-checking";
import type { Account, FamilyMember } from "@/engine/types";
import type { ClientData, EntitySummary, Will } from "@/engine/types";

const ilit: EntitySummary = {
  id: "ent-ilit",
  name: "Smith Family ILIT",
  entityType: "trust",
  trustSubType: "ilit",
  isIrrevocable: true,
  isGrantor: false,
  includeInPortfolio: false,
  grantor: "client",
};

const planSettings = {
  planStartYear: 2026,
  planEndYear: 2060,
  inflationRate: 0.02,
  taxInflationRate: 0.02,
};

function tree(over: Record<string, unknown> = {}): ClientData {
  return {
    client: { dateOfBirth: "1970-01-01", spouseDob: "1972-01-01" },
    accounts: [],
    savingsRules: [],
    incomes: [],
    expenses: [],
    liabilities: [],
    entities: [ilit],
    gifts: [],
    giftEvents: [],
    taxYearRows: [],
    familyMembers: [
      { id: "fm-client", role: "client", firstName: "Dan", lastName: "S", dateOfBirth: "1970-01-01" },
      { id: "fm-spouse", role: "spouse", firstName: "Amy", lastName: "S", dateOfBirth: "1972-01-01" },
    ],
    planSettings,
    withdrawalStrategy: [],
    ...over,
  } as unknown as ClientData;
}

const trustAccount = {
  id: "acct-1",
  name: "Trust brokerage",
  category: "taxable",
  subType: "brokerage",
  value: 500_000,
  basis: 400_000,
  growthRate: 0.05,
  rmdEnabled: false,
  owners: [{ kind: "entity", entityId: "ent-ilit", percent: 1 }],
};

const accountById = (t: ClientData, id: string) => t.accounts.find((a) => a.id === id)!;

// ── The lever: returning assets ──────────────────────────────────────────────

describe("buildDissolveTrustMutations — returning assets", () => {
  it("retitles a trust-owned account to the client grantor", () => {
    const t = tree({ accounts: [trustAccount] });
    const out = applyMutations(t, buildDissolveTrustMutations(t, ilit));
    expect(accountById(out, "acct-1").owners).toEqual([
      { kind: "family_member", familyMemberId: "fm-client", percent: 1 },
    ]);
  });

  it("retitles to the co-client when the trust names the spouse as grantor", () => {
    const spousal: EntitySummary = { ...ilit, grantor: "spouse" };
    const t = tree({ accounts: [trustAccount], entities: [spousal] });
    const out = applyMutations(t, buildDissolveTrustMutations(t, spousal));
    expect(accountById(out, "acct-1").owners).toEqual([
      { kind: "family_member", familyMemberId: "fm-spouse", percent: 1 },
    ]);
  });

  it("falls back to the primary client for a third-party trust with no grantor", () => {
    const thirdParty: EntitySummary = { ...ilit, grantor: undefined };
    const t = tree({ accounts: [trustAccount], entities: [thirdParty] });
    const out = applyMutations(t, buildDissolveTrustMutations(t, thirdParty));
    expect(accountById(out, "acct-1").owners).toEqual([
      { kind: "family_member", familyMemberId: "fm-client", percent: 1 },
    ]);
  });

  it("returns a trust-held liability", () => {
    const t = tree({
      liabilities: [
        {
          id: "liab-1", name: "Trust mortgage", balance: 100_000, interestRate: 0.05,
          monthlyPayment: 800, startYear: 2020, startMonth: 1, termMonths: 240,
          extraPayments: [], owners: [{ kind: "entity", entityId: "ent-ilit", percent: 1 }],
        },
      ],
    });
    const out = applyMutations(t, buildDissolveTrustMutations(t, ilit));
    expect(out.liabilities[0].owners[0]).toEqual({
      kind: "family_member", familyMemberId: "fm-client", percent: 1,
    });
  });

  it("returns a business the trust owns", () => {
    const llc: EntitySummary = {
      id: "ent-llc", name: "Smith LLC", entityType: "llc",
      isGrantor: false, includeInPortfolio: true,
      owners: [{ kind: "entity", entityId: "ent-ilit", percent: 1 }],
    };
    const t = tree({ entities: [ilit, llc] });
    const out = applyMutations(t, buildDissolveTrustMutations(t, ilit));
    const after = out.entities?.find((e) => e.id === "ent-llc");
    expect(after?.owners).toEqual([
      { kind: "family_member", familyMemberId: "fm-client", percent: 1 },
    ]);
  });

  it("deletes the entity last, so no intermediate tree points at a dead trust", () => {
    const t = tree({ accounts: [trustAccount] });
    const muts = buildDissolveTrustMutations(t, ilit);
    const deleteIdx = muts.findIndex(
      (m) => m.kind === "entity-upsert" && m.id === "ent-ilit" && m.value === null,
    );
    expect(deleteIdx).toBe(muts.length - 1);
  });

  it("throws rather than guessing when the household has no client family member", () => {
    const t = tree({ accounts: [trustAccount], familyMembers: [] });
    expect(() => buildDissolveTrustMutations(t, ilit)).toThrow(/no client family member/);
  });
});

// ── Spec §4 step 5: entity-scoped incomes and expenses ───────────────────────
//
// An Income/Expense still carrying `ownerEntityId = <dissolved trust>` does not
// come home — it VANISHES. It is excluded from household income
// (projection.ts:1308 requires ownerEntityId == null), from grantor income
// (:1322 looks the entity up in entityMap and it is gone), and from household
// expenses (:1340); its cash routes to entityCheckingByEntityId[deadId] →
// undefined with no throw (:781-786). So these cases assert against the
// PROJECTION, with a pre-dissolve control proving the assertion is not vacuous.

describe("buildDissolveTrustMutations — entity-scoped flows come home", () => {
  const trustIncome = {
    id: "inc-trust",
    type: "trust",
    name: "IDGT distribution",
    annualAmount: 60_000,
    startYear: 2026,
    endYear: 2060,
    growthRate: 0,
    owner: "client",
    ownerEntityId: "ent-ilit",
  };
  const trustExpense = {
    id: "exp-trust",
    type: "other",
    name: "Trustee fee",
    annualAmount: 12_000,
    startYear: 2026,
    endYear: 2060,
    growthRate: 0,
    ownerEntityId: "ent-ilit",
  };

  it("returns a trust-owned income to the household, in the PROJECTION not just the tree", () => {
    const t = tree({ accounts: [trustAccount], incomes: [trustIncome] });
    // Control: while the trust lives, this is entity income and contributes
    // nothing to the household total. Without it the assertion below could pass
    // on a row that was always there.
    expect(runProjection(t)[0].income.bySource["inc-trust"]).toBeUndefined();

    const out = applyMutations(t, buildDissolveTrustMutations(t, ilit));
    const after = out.incomes.find((i) => i.id === "inc-trust")!;
    expect(after.ownerEntityId).toBeUndefined();
    expect(after.owner).toBe("client");
    // A string here makes the engine concatenate rather than add.
    expect(typeof after.annualAmount).toBe("number");
    expect(runProjection(out)[0].income.bySource["inc-trust"]).toBe(60_000);
  });

  it("returns a trust-owned expense to the household, in the PROJECTION not just the tree", () => {
    const t = tree({ accounts: [trustAccount], expenses: [trustExpense] });
    expect(runProjection(t)[0].expenses.bySource["exp-trust"]).toBeUndefined();

    const out = applyMutations(t, buildDissolveTrustMutations(t, ilit));
    const after = out.expenses.find((e) => e.id === "exp-trust")!;
    expect(after.ownerEntityId).toBeUndefined();
    expect(typeof after.annualAmount).toBe("number");
    expect(runProjection(out)[0].expenses.bySource["exp-trust"]).toBe(12_000);
  });

  it("returns the flow to the co-client when the trust names the spouse as grantor", () => {
    const spousal: EntitySummary = { ...ilit, grantor: "spouse" };
    const t = tree({ entities: [spousal], incomes: [trustIncome] });
    const out = applyMutations(t, buildDissolveTrustMutations(t, spousal));
    expect(out.incomes.find((i) => i.id === "inc-trust")!.owner).toBe("spouse");
  });

  it("clears a cashAccountId pointing at the trust's cash bucket, which the dissolve deletes", () => {
    const bucket = makeEntityCheckingAccount("ent-ilit", "Smith Family ILIT");
    const t = tree({
      accounts: [bucket],
      incomes: [{ ...trustIncome, cashAccountId: bucket.id }],
      expenses: [{ ...trustExpense, cashAccountId: bucket.id }],
    });
    const out = applyMutations(t, buildDissolveTrustMutations(t, ilit));
    // Positive first: the bucket really is gone, so a stale pointer would be
    // a deposit into an account that does not exist.
    expect(out.accounts.some((a) => a.id === entityCheckingId("ent-ilit"))).toBe(false);
    expect(out.incomes.find((i) => i.id === "inc-trust")!.cashAccountId).toBeUndefined();
    expect(out.expenses.find((e) => e.id === "exp-trust")!.cashAccountId).toBeUndefined();
  });

  it("keeps a cashAccountId naming an account that SURVIVES the dissolve", () => {
    const t = tree({
      accounts: [trustAccount],
      incomes: [{ ...trustIncome, cashAccountId: "acct-1" }],
    });
    const out = applyMutations(t, buildDissolveTrustMutations(t, ilit));
    expect(out.incomes.find((i) => i.id === "inc-trust")!.cashAccountId).toBe("acct-1");
  });

  it("leaves household flows and other entities' flows alone", () => {
    const other = { ...trustIncome, id: "inc-other", ownerEntityId: "ent-other" };
    const household = { ...trustIncome, id: "inc-hh", ownerEntityId: undefined };
    const t = tree({ incomes: [other, household] });
    const keys = buildDissolveTrustMutations(t, ilit).map(mutationKey);
    expect(keys).not.toContain("income-upsert:inc-other");
    expect(keys).not.toContain("income-upsert:inc-hh");
  });

  it("emits the flow upserts BEFORE the entity delete", () => {
    const t = tree({ incomes: [trustIncome], expenses: [trustExpense] });
    const muts = buildDissolveTrustMutations(t, ilit);
    const keys = muts.map(mutationKey);
    expect(keys.indexOf("income-upsert:inc-trust")).toBeGreaterThan(-1);
    expect(keys.indexOf("expense-upsert:exp-trust")).toBeGreaterThan(-1);
    expect(keys.indexOf("income-upsert:inc-trust")).toBeLessThan(keys.length - 1);
    expect(keys.indexOf("expense-upsert:exp-trust")).toBeLessThan(keys.length - 1);
  });
});

// ── R5: an owners[] rewrite moves real value ─────────────────────────────────

describe("buildDissolveTrustMutations — co-owners keep their share", () => {
  it("moves only the trust's half of a 50/50 trust + spouse account", () => {
    const shared = {
      ...trustAccount,
      owners: [
        { kind: "entity", entityId: "ent-ilit", percent: 0.5 },
        { kind: "family_member", familyMemberId: "fm-spouse", percent: 0.5 },
      ],
    };
    const t = tree({ accounts: [shared] });
    const out = applyMutations(t, buildDissolveTrustMutations(t, ilit));
    expect(accountById(out, "acct-1").owners).toEqual([
      { kind: "family_member", familyMemberId: "fm-client", percent: 0.5 },
      { kind: "family_member", familyMemberId: "fm-spouse", percent: 0.5 },
    ]);
  });

  it("maps a gifted_away slice pointed at the trust — that is how a gift INTO a trust is titled", () => {
    const gifted = {
      ...trustAccount,
      owners: [
        { kind: "gifted_away", recipient: { kind: "entity", id: "ent-ilit" }, percent: 1 },
      ],
    };
    const t = tree({ accounts: [gifted] });
    const out = applyMutations(t, buildDissolveTrustMutations(t, ilit));
    const owners = accountById(out, "acct-1").owners;
    expect(owners).toEqual([
      { kind: "family_member", familyMemberId: "fm-client", percent: 1 },
    ]);
    expect(
      owners.some(
        (o) =>
          (o.kind === "entity" && o.entityId === "ent-ilit") ||
          (o.kind === "gifted_away" && o.recipient.id === "ent-ilit"),
      ),
    ).toBe(false);
  });

  it("merges a trust slice and a gifted-away-to-trust slice into ONE heir row", () => {
    const both = {
      ...trustAccount,
      owners: [
        { kind: "entity", entityId: "ent-ilit", percent: 0.4 },
        { kind: "gifted_away", recipient: { kind: "entity", id: "ent-ilit" }, percent: 0.6 },
      ],
    };
    const t = tree({ accounts: [both] });
    const out = applyMutations(t, buildDissolveTrustMutations(t, ilit));
    expect(accountById(out, "acct-1").owners).toEqual([
      { kind: "family_member", familyMemberId: "fm-client", percent: 1 },
    ]);
  });

  it("merges the returned slice into an existing heir slice rather than emitting two rows", () => {
    const split = {
      ...trustAccount,
      owners: [
        { kind: "family_member", familyMemberId: "fm-client", percent: 0.25 },
        { kind: "entity", entityId: "ent-ilit", percent: 0.75 },
      ],
    };
    const t = tree({ accounts: [split] });
    const out = applyMutations(t, buildDissolveTrustMutations(t, ilit));
    expect(accountById(out, "acct-1").owners).toEqual([
      { kind: "family_member", familyMemberId: "fm-client", percent: 1 },
    ]);
  });

  it("keeps a business co-owner's share when the trust holds only part of it", () => {
    const llc: EntitySummary = {
      id: "ent-llc", name: "Smith LLC", entityType: "llc",
      isGrantor: false, includeInPortfolio: true,
      owners: [
        { kind: "entity", entityId: "ent-ilit", percent: 0.6 },
        { kind: "family_member", familyMemberId: "fm-spouse", percent: 0.4 },
      ],
    };
    const t = tree({ entities: [ilit, llc] });
    const out = applyMutations(t, buildDissolveTrustMutations(t, ilit));
    expect(out.entities?.find((e) => e.id === "ent-llc")?.owners).toEqual([
      { kind: "family_member", familyMemberId: "fm-client", percent: 0.6 },
      { kind: "family_member", familyMemberId: "fm-spouse", percent: 0.4 },
    ]);
  });

  it("keeps a co-owner's share on a jointly-held liability", () => {
    const t = tree({
      liabilities: [
        {
          id: "liab-1", name: "Trust mortgage", balance: 100_000, interestRate: 0.05,
          monthlyPayment: 800, startYear: 2020, startMonth: 1, termMonths: 240,
          extraPayments: [],
          owners: [
            { kind: "entity", entityId: "ent-ilit", percent: 0.5 },
            { kind: "family_member", familyMemberId: "fm-spouse", percent: 0.5 },
          ],
        },
      ],
    });
    const out = applyMutations(t, buildDissolveTrustMutations(t, ilit));
    expect(out.liabilities[0].owners).toEqual([
      { kind: "family_member", familyMemberId: "fm-client", percent: 0.5 },
      { kind: "family_member", familyMemberId: "fm-spouse", percent: 0.5 },
    ]);
  });
});

// ── R4: one mutation per key, or the second cancels the first ────────────────

describe("buildDissolveTrustMutations — one mutation per key", () => {
  const ilitPolicy = {
    id: "acct-pol",
    name: "Term policy",
    category: "life_insurance",
    subType: "term",
    value: 0,
    basis: 0,
    growthRate: 0,
    rmdEnabled: false,
    owners: [{ kind: "entity", entityId: "ent-ilit", percent: 1 }],
    beneficiaries: [
      { id: "b1", tier: "primary", percentage: 100, entityIdRef: "ent-ilit", sortOrder: 0 },
      { id: "b2", tier: "contingent", percentage: 100, familyMemberId: "fm-spouse", sortOrder: 1 },
    ],
  };

  it("retitles AND clears the beneficiary on an ILIT's own policy in one pass", () => {
    const t = tree({ accounts: [ilitPolicy] });
    const out = applyMutations(t, buildDissolveTrustMutations(t, ilit));
    const after = accountById(out, "acct-pol");
    expect(after.owners).toEqual([
      { kind: "family_member", familyMemberId: "fm-client", percent: 1 },
    ]);
    expect((after.beneficiaries ?? []).map((b) => b.entityIdRef)).not.toContain("ent-ilit");
    expect((after.beneficiaries ?? []).map((b) => b.id)).toEqual(["b2"]);
  });

  it("emits exactly one account-upsert keyed to that policy", () => {
    const t = tree({ accounts: [ilitPolicy] });
    const keys = buildDissolveTrustMutations(t, ilit).map(mutationKey);
    expect(keys.filter((k) => k === "account-upsert:acct-pol")).toHaveLength(1);
  });

  it("collapses the business retitle and the remainder-beneficiary clear into one entity-upsert", () => {
    const llc: EntitySummary = {
      id: "ent-llc", name: "Smith LLC", entityType: "llc",
      isGrantor: false, includeInPortfolio: true,
      owners: [{ kind: "entity", entityId: "ent-ilit", percent: 1 }],
      remainderBeneficiaries: [{ entityIdRef: "ent-ilit", percentage: 100, distributionForm: "outright" }],
    };
    const t = tree({ entities: [ilit, llc] });
    const muts = buildDissolveTrustMutations(t, ilit);
    expect(muts.map(mutationKey).filter((k) => k === "entity-upsert:ent-llc")).toHaveLength(1);

    const after = applyMutations(t, muts).entities?.find((e) => e.id === "ent-llc");
    expect(after?.owners).toEqual([
      { kind: "family_member", familyMemberId: "fm-client", percent: 1 },
    ]);
    expect((after?.remainderBeneficiaries ?? []).map((r) => r.entityIdRef)).not.toContain("ent-ilit");
  });
});

// ── Dangling references ─────────────────────────────────────────────────────

describe("buildDissolveTrustMutations — dangling references", () => {
  it("clears a policy beneficiary designation naming the trust", () => {
    const policy = {
      id: "acct-pol", name: "Term policy", category: "life_insurance", subType: "term",
      value: 0, basis: 0, growthRate: 0, rmdEnabled: false,
      owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
      beneficiaries: [{ id: "b1", tier: "primary", percentage: 100, entityIdRef: "ent-ilit", sortOrder: 0 }],
    };
    const t = tree({ accounts: [policy] });
    const out = applyMutations(t, buildDissolveTrustMutations(t, ilit));
    const refs = (accountById(out, "acct-pol").beneficiaries ?? []).map((b) => b.entityIdRef);
    expect(refs).not.toContain("ent-ilit");
  });

  it("clears a will bequest recipient naming the trust", () => {
    const t = tree({
      wills: [
        {
          id: "will-1", grantor: "client",
          bequests: [
            {
              id: "bq-1", name: "To the ILIT", kind: "asset", assetMode: "specific",
              accountId: "acct-1", entityId: null, liabilityId: null, percentage: 100,
              condition: "always", sortOrder: 0,
              recipients: [
                { recipientKind: "entity", recipientId: "ent-ilit", percentage: 100, sortOrder: 0 },
                { recipientKind: "family_member", recipientId: "fm-spouse", percentage: 0, sortOrder: 1 },
              ],
            },
          ],
        },
      ],
    });
    const out = applyMutations(t, buildDissolveTrustMutations(t, ilit));
    const ids = out.wills?.[0].bequests[0].recipients.map((r) => r.recipientId) ?? [];
    expect(ids).not.toContain("ent-ilit");
    expect(ids).toEqual(["fm-spouse"]);
  });

  it("drops a bequest the trust was the ONLY recipient of, so a sibling clause is not pro-rated down", () => {
    // An emptied clause is NOT inert. `specifics` is filtered by account id
    // alone (death-event/shared.ts:916-921) and its `percentage` still lands in
    // `rawTotal` (:942-945), so two 60% clauses on one account over-allocate and
    // BOTH scale to 50% (:947-951) — the spouse silently loses ten points of the
    // account. `cascadeResolution.ts:243-247` drops such a row on a saved-
    // scenario reload too, so keeping it would also split preview from save.
    const toTrust = {
      id: "bq-trust", name: "To the ILIT", kind: "asset", assetMode: "specific",
      accountId: "acct-1", entityId: null, liabilityId: null, percentage: 60,
      condition: "always", sortOrder: 0,
      recipients: [{ recipientKind: "entity", recipientId: "ent-ilit", percentage: 100, sortOrder: 0 }],
    };
    const toSpouse = {
      id: "bq-spouse", name: "To Amy", kind: "asset", assetMode: "specific",
      accountId: "acct-1", entityId: null, liabilityId: null, percentage: 60,
      condition: "always", sortOrder: 1,
      recipients: [{ recipientKind: "family_member", recipientId: "fm-spouse", percentage: 100, sortOrder: 0 }],
    };
    const t = tree({
      accounts: [trustAccount],
      wills: [{ id: "will-1", grantor: "client", bequests: [toTrust, toSpouse] }],
    });
    const after = applyMutations(t, buildDissolveTrustMutations(t, ilit)).wills![0];
    expect(after.bequests.map((b) => b.id)).toEqual(["bq-spouse"]);

    // Run the engine's own specific-bequest pass over both shapes. The control
    // (the emptied clause kept) is what proves this is not a vacuous assertion:
    // it really does move 10% of the account and raise a bogus warning.
    const source = t.accounts[0] as Account;
    const fms = t.familyMembers as FamilyMember[];
    const run = (will: typeof after) =>
      applyWillSpecificBequests(source, 1, will, 1, "spouse", "fm-spouse", fms, [], [], undefined);

    const dropped = run(after);
    expect(dropped.fractionClaimed).toBeCloseTo(0.6, 10);
    expect(dropped.warnings).toEqual([]);

    const kept = run({
      ...after,
      bequests: [{ ...toTrust, recipients: [] }, after.bequests[0]] as typeof after.bequests,
    });
    expect(kept.fractionClaimed).toBeCloseTo(0.5, 10);
    expect(kept.warnings).toContain("over_allocation_in_will:acct-1");
  });

  it("clears a will residuary recipient naming the trust", () => {
    const t = tree({
      wills: [
        {
          id: "will-1", grantor: "client", bequests: [],
          residuaryRecipients: [
            { recipientKind: "entity", recipientId: "ent-ilit", percentage: 60, sortOrder: 0 },
            { recipientKind: "family_member", recipientId: "fm-spouse", percentage: 40, sortOrder: 1 },
          ],
        },
      ],
    });
    const out = applyMutations(t, buildDissolveTrustMutations(t, ilit));
    const residuary = out.wills?.[0].residuaryRecipients ?? [];
    expect(residuary.map((r) => r.recipientId)).not.toContain("ent-ilit");
    // The surviving row must keep its share as a NUMBER — a string percentage
    // makes the engine concatenate rather than add.
    expect(typeof residuary[0].percentage).toBe("number");
    expect(residuary[0].percentage).toBe(40);
  });

  it("leaves a will that never named the trust alone", () => {
    const t = tree({
      wills: [
        {
          id: "will-1", grantor: "client", bequests: [],
          residuaryRecipients: [
            { recipientKind: "family_member", recipientId: "fm-spouse", percentage: 100, sortOrder: 0 },
          ],
        },
      ],
    });
    expect(buildDissolveTrustMutations(t, ilit).some((m) => m.kind === "will-upsert")).toBe(false);
  });

  it("clears another trust's remainder beneficiary naming this trust", () => {
    const crt: EntitySummary = {
      id: "ent-crt", name: "Smith CRT", entityType: "trust", trustSubType: "crt",
      isGrantor: false, includeInPortfolio: false,
      remainderBeneficiaries: [
        { entityIdRef: "ent-ilit", percentage: 60, distributionForm: "outright" },
        { familyMemberId: "fm-spouse", percentage: 40, distributionForm: "outright" },
      ],
    };
    const t = tree({ entities: [ilit, crt] });
    const out = applyMutations(t, buildDissolveTrustMutations(t, ilit));
    const after = out.entities?.find((e) => e.id === "ent-crt");
    expect((after?.remainderBeneficiaries ?? []).map((r) => r.entityIdRef)).not.toContain("ent-ilit");
    // Positive assertion: the sibling must SURVIVE, or dropping the whole array
    // would satisfy the `not.toContain` above vacuously.
    expect(after?.remainderBeneficiaries).toHaveLength(1);
    expect(after?.remainderBeneficiaries?.[0].familyMemberId).toBe("fm-spouse");
  });

  it("clears another trust's income beneficiary naming this trust", () => {
    const crt: EntitySummary = {
      id: "ent-crt", name: "Smith CRT", entityType: "trust", trustSubType: "crt",
      isGrantor: false, includeInPortfolio: false,
      incomeBeneficiaries: [
        { entityId: "ent-ilit", percentage: 100 },
        { familyMemberId: "fm-spouse", percentage: 0 },
      ],
    };
    const t = tree({ entities: [ilit, crt] });
    const out = applyMutations(t, buildDissolveTrustMutations(t, ilit));
    const after = out.entities?.find((e) => e.id === "ent-crt");
    expect((after?.incomeBeneficiaries ?? []).map((r) => r.entityId)).not.toContain("ent-ilit");
    expect(after?.incomeBeneficiaries).toHaveLength(1);
  });

  it("clears another trust's own beneficiary designation naming this trust", () => {
    const crt: EntitySummary = {
      id: "ent-crt", name: "Smith CRT", entityType: "trust", trustSubType: "crt",
      isGrantor: false, includeInPortfolio: false,
      beneficiaries: [
        { id: "eb1", tier: "primary", percentage: 100, entityIdRef: "ent-ilit", sortOrder: 0 },
        { id: "eb2", tier: "contingent", percentage: 100, familyMemberId: "fm-spouse", sortOrder: 1 },
      ],
    };
    const t = tree({ entities: [ilit, crt] });
    const out = applyMutations(t, buildDissolveTrustMutations(t, ilit));
    const after = out.entities?.find((e) => e.id === "ent-crt");
    expect((after?.beneficiaries ?? []).map((b) => b.entityIdRef)).not.toContain("ent-ilit");
    // Positive assertion — see the remainder case above.
    expect((after?.beneficiaries ?? []).map((b) => b.id)).toEqual(["eb2"]);
  });
});

// ── Gifts. R11: the id a gift-upsert must carry is the CONSUMER's key ────────

describe("buildDissolveTrustMutations — gifts aimed at the trust", () => {
  it("removes a cash gift to the trust from the APPLIED tree, not just the list", () => {
    const t = tree({
      gifts: [
        {
          id: "gift-1", year: 2027, amount: 20_000, grantor: "client",
          recipientEntityId: "ent-ilit", useCrummeyPowers: false,
        },
      ],
      giftEvents: [
        {
          kind: "cash", year: 2027, amount: 20_000, grantor: "client",
          recipientEntityId: "ent-ilit", useCrummeyPowers: false, sourceGiftId: "gift-1",
        },
      ],
    });
    const muts = buildDissolveTrustMutations(t, ilit);
    expect(muts).toContainEqual({ kind: "gift-upsert", id: "gift-1", value: null });

    const out = applyMutations(t, muts);
    expect(out.gifts ?? []).toHaveLength(0);
    expect(out.giftEvents).toHaveLength(0);
  });

  it("removes a gift SERIES aimed at the trust — a series never reaches tree.gifts", () => {
    const t = tree({
      giftEvents: [
        { kind: "cash", year: 2027, amount: 18_000, grantor: "client", recipientEntityId: "ent-ilit", useCrummeyPowers: true, seriesId: "series-1" },
        { kind: "cash", year: 2028, amount: 18_000, grantor: "client", recipientEntityId: "ent-ilit", useCrummeyPowers: true, seriesId: "series-1" },
      ],
    });
    const muts = buildDissolveTrustMutations(t, ilit);
    expect(muts.filter((m) => m.kind === "gift-upsert")).toEqual([
      { kind: "gift-upsert", id: "series-1", value: null },
    ]);
    expect(applyMutations(t, muts).giftEvents).toHaveLength(0);
  });

  it("removes an ASSET gift aimed at the trust — also absent from tree.gifts", () => {
    const t = tree({
      giftEvents: [
        { kind: "asset", year: 2027, accountId: "acct-9", percent: 1, grantor: "client", recipientEntityId: "ent-ilit", sourceGiftId: "gift-asset" },
        { kind: "liability", year: 2027, liabilityId: "liab-9", percent: 1, grantor: "client", recipientEntityId: "ent-ilit", parentGiftId: "gift-asset" },
      ],
    });
    const muts = buildDissolveTrustMutations(t, ilit);
    expect(muts.filter((m) => m.kind === "gift-upsert")).toEqual([
      { kind: "gift-upsert", id: "gift-asset", value: null },
    ]);
    expect(applyMutations(t, muts).giftEvents).toHaveLength(0);
  });

  it("does NOT try to delete a synthesized premium gift — it has no gift row to delete", () => {
    // withSynthesizedPremiumGifts re-derives these from the policy on every
    // apply; they carry sourcePolicyAccountId and no gift id at all, so a
    // gift-upsert keyed on one would write a scenario `remove` for a row that
    // does not exist.
    const t = tree({
      giftEvents: [
        {
          kind: "cash", year: 2027, amount: 12_000, grantor: "client",
          recipientEntityId: "ent-ilit", useCrummeyPowers: true, sourcePolicyAccountId: "acct-pol",
        },
      ],
    });
    expect(buildDissolveTrustMutations(t, ilit).some((m) => m.kind === "gift-upsert")).toBe(false);
  });

  it("clears a CLT's auto-emitted remainder-interest gift — the one removeTrust used to clear by hand", () => {
    // This is the behaviour `useSolverEstateEditor.removeTrust` carried in
    // `draft.remainderGiftId`. The gift is emitted at CLT inception as a
    // gift-upsert, so it lives in the WORKING tree — which is the tree the
    // lever reads — under the very id the delete has to carry.
    const clt: EntitySummary = {
      ...ilit, id: "ent-clt", name: "Smith CLT", trustSubType: "clt", isGrantor: true,
    };
    const snapshot = {
      inceptionYear: 2027, inceptionValue: 1_000_000, payoutType: "annuity" as const,
      payoutPercent: null, payoutAmount: 50_000, irc7520Rate: 0.05,
      termType: "years" as const, termYears: 20,
      measuringLife1Id: null, measuringLife2Id: null, charityId: "eb-charity",
      originalIncomeInterest: 623_110, originalRemainderInterest: 376_890,
    };
    const working = applyMutations(tree({ entities: [clt] }), [
      buildCltRemainderGiftMutation("ent-clt", snapshot, "client", "gift-clt-remainder"),
    ]);
    expect((working.gifts ?? []).map((g) => g.id)).toEqual(["gift-clt-remainder"]);

    const muts = buildDissolveTrustMutations(working, clt);
    expect(muts).toContainEqual({ kind: "gift-upsert", id: "gift-clt-remainder", value: null });
    expect(applyMutations(working, muts).gifts ?? []).toHaveLength(0);
  });

  it("leaves a gift aimed at somebody else alone", () => {
    const t = tree({
      gifts: [
        {
          id: "gift-2", year: 2027, amount: 20_000, grantor: "client",
          recipientFamilyMemberId: "fm-spouse", useCrummeyPowers: false,
        },
      ],
    });
    expect(buildDissolveTrustMutations(t, ilit).some((m) => m.kind === "gift-upsert")).toBe(false);
  });
});

// ── The trust's own cash bucket ─────────────────────────────────────────────

describe("buildDissolveTrustMutations — the trust's default checking account", () => {
  // A REAL id, not the deterministic `entity-checking-<id>` one: applyMutations
  // strips the synthesized bucket by that id on the entity delete anyway
  // (apply-mutations.ts:374), so a synthetic-id fixture could not tell the
  // lever's own decision from that sweep. The API path creates a real
  // `<entity> — Cash` row per base scenario, and only a real row can hold money.
  const bucket = (value: number) => ({
    id: "acct-trust-cash",
    name: "Smith Family ILIT — Cash",
    category: "cash",
    subType: "checking",
    value,
    basis: value,
    growthRate: 0,
    rmdEnabled: false,
    isDefaultChecking: true,
    owners: [{ kind: "entity", entityId: "ent-ilit", percent: 1 }],
  });

  it("drops an empty one rather than handing the household a junk account", () => {
    const t = tree({ accounts: [bucket(0)] });
    const muts = buildDissolveTrustMutations(t, ilit);
    expect(muts).toContainEqual({ kind: "account-upsert", id: "acct-trust-cash", value: null });
    expect(applyMutations(t, muts).accounts.find((a) => a.id === "acct-trust-cash")).toBeUndefined();
  });

  it("returns one that holds money, but clears isDefaultChecking so it cannot hijack household cash", () => {
    // projection.ts:683-685 resolves the household's cash hub with a `.find()`
    // over isDefaultChecking — a second flagged household account can capture
    // every household cash flow.
    const t = tree({ accounts: [bucket(45_000)] });
    const out = applyMutations(t, buildDissolveTrustMutations(t, ilit));
    const after = accountById(out, "acct-trust-cash");
    expect(after.value).toBe(45_000);
    expect(after.isDefaultChecking).toBe(false);
    expect(after.owners).toEqual([
      { kind: "family_member", familyMemberId: "fm-client", percent: 1 },
    ]);
  });
});

// ── The `will-upsert` kind this lever needed ─────────────────────────────────

const will: Will = {
  id: "will-1",
  grantor: "client",
  bequests: [
    {
      id: "bq-1", name: "The lake house", kind: "asset", assetMode: "specific",
      accountId: "acct-1", entityId: null, liabilityId: null, percentage: 100,
      condition: "always", sortOrder: 0,
      recipients: [
        { recipientKind: "family_member", recipientId: "fm-spouse", percentage: 100, sortOrder: 0 },
      ],
    },
  ],
  residuaryRecipients: [
    { recipientKind: "family_member", recipientId: "fm-spouse", percentage: 100, sortOrder: 0 },
  ],
};

describe("will-upsert — wire schema", () => {
  it("accepts a will", () => {
    expect(
      SOLVER_MUTATION_SCHEMA.safeParse({ kind: "will-upsert", id: will.id, value: will }).success,
    ).toBe(true);
  });

  it("accepts a null value (remove)", () => {
    expect(
      SOLVER_MUTATION_SCHEMA.safeParse({ kind: "will-upsert", id: will.id, value: null }).success,
    ).toBe(true);
  });

  it("does not strip bequests or residuary recipients — clearing them IS the mutation", () => {
    const r = SOLVER_MUTATION_SCHEMA.safeParse({ kind: "will-upsert", id: will.id, value: will });
    expect(r.success).toBe(true);
    const parsed = r.success && r.data.kind === "will-upsert" ? r.data.value : null;
    expect(parsed?.bequests).toHaveLength(1);
    expect(parsed?.residuaryRecipients).toHaveLength(1);
    expect(parsed).toEqual(will);
  });

  it("accepts a bequest whose recipients have all been cleared", () => {
    const emptied: Will = {
      ...will,
      bequests: [{ ...will.bequests[0], recipients: [] }],
      residuaryRecipients: [],
    };
    expect(
      SOLVER_MUTATION_SCHEMA.safeParse({ kind: "will-upsert", id: will.id, value: emptied }).success,
    ).toBe(true);
  });
});

describe("will-upsert — mutation key", () => {
  it("keys by will id so re-editing replaces rather than stacks", () => {
    expect(mutationKey({ kind: "will-upsert", id: "will-1", value: will })).toBe("will-upsert:will-1");
  });
});

describe("applyMutations — will-upsert", () => {
  it("adds a will to a tree that has none", () => {
    const out = applyMutations(tree(), [{ kind: "will-upsert", id: will.id, value: will }]);
    expect(out.wills).toHaveLength(1);
  });

  it("replaces an existing will by id", () => {
    const t = tree({ wills: [will] });
    const out = applyMutations(t, [
      { kind: "will-upsert", id: will.id, value: { ...will, residuaryRecipients: [] } },
    ]);
    expect(out.wills).toHaveLength(1);
    expect(out.wills?.[0].residuaryRecipients).toEqual([]);
  });

  it("removes a will when value is null", () => {
    const t = tree({ wills: [will] });
    const out = applyMutations(t, [{ kind: "will-upsert", id: will.id, value: null }]);
    expect(out.wills).toHaveLength(0);
  });
});

describe("will-upsert — base savability", () => {
  it("reports NOT base-savable, so Save-to-base cannot silently drop an edited will", () => {
    expect(isBaseSavableMutation({ kind: "will-upsert", id: will.id, value: will })).toBe(false);
  });
});

describe("mutationsToScenarioChanges — will-upsert", () => {
  it("writes an `add` change for a will the source tree lacks", () => {
    const drafts = mutationsToScenarioChanges(tree(), "client-1", [
      { kind: "will-upsert", id: will.id, value: will },
    ]);
    const change = drafts.find((d) => d.targetKind === "will");
    expect(change?.opType).toBe("add");
    expect(change?.targetId).toBe("will-1");
  });

  it("writes an `edit` change carrying only the arrays that moved", () => {
    const drafts = mutationsToScenarioChanges(tree({ wills: [will] }), "client-1", [
      { kind: "will-upsert", id: will.id, value: { ...will, residuaryRecipients: [] } },
    ]);
    const change = drafts.find((d) => d.targetKind === "will");
    expect(change?.opType).toBe("edit");
    expect(Object.keys(change?.payload as Record<string, unknown>)).toEqual(["residuaryRecipients"]);
  });

  it("writes a `remove` change for a null value against an existing will", () => {
    const drafts = mutationsToScenarioChanges(tree({ wills: [will] }), "client-1", [
      { kind: "will-upsert", id: will.id, value: null },
    ]);
    expect(drafts.find((d) => d.targetKind === "will")?.opType).toBe("remove");
  });
});
