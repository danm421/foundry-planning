import { describe, it, expect } from "vitest";

import { commitGoals } from "../goals";
import { emptyImportPayload, type ImportPayload } from "../../types";
import type { EducationGoal, HomePurchaseGoal } from "../../assemble/types";
import { callsForTable, makeFakeTx, type FakeTx, type FakeTxCall } from "../../__tests__/commit-test-helpers";

/**
 * DEFECT 1 (brief vs. real tree): the brief's Step 8.1 was written against a
 * `seedClient()` / `seedAccount()` / `seedFamilyMember()` live-DB harness plus
 * real `db.transaction(...)` + SELECTs. None of that exists anywhere in
 * `src/` — every other `commit/__tests__/*.test.ts` suite (plan-basics,
 * living-fold) drives its module through the hand-rolled `makeFakeTx()` fake
 * from `commit-test-helpers.ts`. These tests follow that established
 * precedent instead: seed `accounts` / `family_members` SELECT results via
 * `fake.setSelectResult(...)`, then assert on the recorded `insert`/`update`
 * calls rather than reading rows back from a real database. Every assertion
 * the brief's tests made is preserved — only the mechanism for observing it
 * changed.
 */

const CTX = { clientId: "client-1", scenarioId: "scenario-1", orgId: "org-1", userId: "user-1" } as const;

function completeEducationGoal(overrides: Partial<EducationGoal> = {}): EducationGoal {
  return {
    id: "edu:test",
    name: { value: "Education Goal", provenance: "derived" },
    forFamilyMemberName: { value: null, provenance: "derived" },
    annualAmount: { value: 30000, provenance: "stated" },
    startYear: { value: 2028, provenance: "derived", reason: "First year of college." },
    years: { value: 4, provenance: "derived", reason: "Assumes a 4-year programme." },
    growthRate: { value: 0.05, provenance: "derived", reason: "Tuition inflation." },
    payShortfallOutOfPocket: { value: false, provenance: "derived" },
    dedicatedAccountNames: [],
    ...overrides,
  };
}

/** Spreads `overrides` over a complete, valid `EducationGoal`, wrapped in an `ImportPayload`. */
function payloadWithEducationGoal(overrides: Partial<EducationGoal> = {}): ImportPayload {
  return {
    ...emptyImportPayload(),
    goals: { education: [completeEducationGoal(overrides)], homePurchases: [] },
  };
}

function completeHomePurchase(overrides: Partial<HomePurchaseGoal> = {}): HomePurchaseGoal {
  return {
    id: "home-1",
    name: "Austin home",
    year: "2029",
    assetName: "123 Main St",
    assetSubType: "primary_residence",
    purchasePrice: "700000",
    growthRate: "0.04",
    basis: "",
    fundingAccountId: "",
    showMortgage: true,
    mortgageAmount: "560000",
    mortgageRate: "0.0625",
    mortgageTermMonths: "360",
    ...overrides,
  };
}

/** Spreads `overrides` over a complete, valid `HomePurchaseGoal`, wrapped in an `ImportPayload`. */
function payloadWithHomePurchase(overrides: Partial<HomePurchaseGoal> = {}): ImportPayload {
  return {
    ...emptyImportPayload(),
    goals: { education: [], homePurchases: [completeHomePurchase(overrides)] },
  };
}

function insertValues(fake: FakeTx, table: string): Record<string, unknown> {
  const call = callsForTable(fake.calls, table).find((c) => c.op === "insert") as
    | { values: Record<string, unknown> }
    | undefined;
  if (!call) throw new Error(`no insert recorded for table "${table}"`);
  return call.values;
}

/** Same as `insertValues`, for insert calls whose recorded `values` is an array (join-table writes). */
function insertValuesArray(fake: FakeTx, table: string): Record<string, unknown>[] {
  const call = callsForTable(fake.calls, table).find((c) => c.op === "insert") as
    | { values: Record<string, unknown>[] }
    | undefined;
  if (!call) throw new Error(`no insert recorded for table "${table}"`);
  return call.values;
}

function insertCalls(fake: FakeTx, table: string): FakeTxCall[] {
  return callsForTable(fake.calls, table).filter((c) => c.op === "insert");
}

function updateCalls(fake: FakeTx, table: string): FakeTxCall[] {
  return callsForTable(fake.calls, table).filter((c) => c.op === "update");
}

describe("commitGoals — education", () => {
  it("writes an education expense with its 529 join row", async () => {
    const fake = makeFakeTx();
    fake.setSelectResult("accounts", [
      { id: "acct-emma-529", name: "Emma 529 Plan", beneficiaryFamilyMemberId: null, beneficiaryName: null },
    ]);
    fake.setSelectResult("family_members", [{ id: "fm-emma", firstName: "Emma" }]);

    const payload = payloadWithEducationGoal({
      name: { value: "Emma — College", provenance: "document" },
      forFamilyMemberName: { value: "Emma", provenance: "document" },
      annualAmount: { value: 45000, provenance: "stated" },
      startYear: { value: 2028, provenance: "derived", reason: "..." },
      years: { value: 4, provenance: "derived", reason: "..." },
      growthRate: { value: 0.05, provenance: "derived", reason: "..." },
      payShortfallOutOfPocket: { value: true, provenance: "stated" },
      dedicatedAccountNames: ["Emma 529 Plan"],
    });

    const result = await commitGoals(fake.tx, payload, CTX);

    expect(result.created).toBe(1);
    const expenseValues = insertValues(fake, "expenses");
    expect(expenseValues).toMatchObject({
      type: "education",
      name: "Emma — College",
      annualAmount: "45000",
      startYear: 2028,
      endYear: 2031, // start + years - 1
      forFamilyMemberId: "fm-emma",
      payShortfallOutOfPocket: true,
      source: "extracted",
    });

    const joinValues = insertValuesArray(fake, "expense_dedicated_accounts");
    expect(joinValues.map((j) => j.accountId)).toEqual(["acct-emma-529"]);
  });

  it("does not write a goal whose annual amount is blank", async () => {
    const fake = makeFakeTx();
    const payload = payloadWithEducationGoal({ annualAmount: { value: null, provenance: "derived" } });

    const result = await commitGoals(fake.tx, payload, CTX);

    expect(result.created).toBe(0);
    expect(result.skipped).toBe(1);
    expect(callsForTable(fake.calls, "expenses").filter((c) => c.op === "insert")).toHaveLength(0);
  });

  it("records a warning when a named 529 cannot be resolved", async () => {
    const fake = makeFakeTx();
    fake.setSelectResult("accounts", []);
    const payload = payloadWithEducationGoal({
      dedicatedAccountNames: ["Nonexistent 529"],
      annualAmount: { value: 30000, provenance: "stated" },
    });

    const result = await commitGoals(fake.tx, payload, CTX);

    expect(result.created).toBe(1);
    expect(result.warnings.join(" ")).toContain("Nonexistent 529");
  });

  it("fills a null 529 beneficiary with the confirmed student", async () => {
    const fake = makeFakeTx();
    fake.setSelectResult("accounts", [
      { id: "acct-emma-529", name: "Emma 529 Plan", beneficiaryFamilyMemberId: null, beneficiaryName: null },
    ]);
    fake.setSelectResult("family_members", [{ id: "fm-emma", firstName: "Emma" }]);
    const payload = payloadWithEducationGoal({
      dedicatedAccountNames: ["Emma 529 Plan"],
      forFamilyMemberName: { value: "Emma", provenance: "document" },
      annualAmount: { value: 45000, provenance: "stated" },
    });

    await commitGoals(fake.tx, payload, CTX);

    const acctUpdates = updateCalls(fake, "accounts");
    expect(acctUpdates).toHaveLength(1);
    expect((acctUpdates[0] as { values: Record<string, unknown> }).values).toMatchObject({
      beneficiaryFamilyMemberId: "fm-emma",
    });
  });

  it("never overwrites a beneficiary someone already set", async () => {
    const fake = makeFakeTx();
    fake.setSelectResult("accounts", [
      {
        id: "acct-emma-529",
        name: "Emma 529 Plan",
        beneficiaryFamilyMemberId: "fm-noah", // set by someone else already
        beneficiaryName: null,
      },
    ]);
    fake.setSelectResult("family_members", [{ id: "fm-emma", firstName: "Emma" }]);
    const payload = payloadWithEducationGoal({
      dedicatedAccountNames: ["Emma 529 Plan"],
      forFamilyMemberName: { value: "Emma", provenance: "document" },
      annualAmount: { value: 45000, provenance: "stated" },
    });

    await commitGoals(fake.tx, payload, CTX);

    // No update issued at all — the pre-existing beneficiary is left alone.
    expect(updateCalls(fake, "accounts")).toHaveLength(0);
  });

  it("resolves two same-named accounts to two DISTINCT ids, one per goal (Defect 2 fix)", async () => {
    // Two 529s both named "529 Plan" and two goals each naming it. A plain
    // `Map(name -> id)` keeps only the LAST-seen id, so both goals would
    // resolve to the SAME account — orphaning the first account and joining
    // the second to two different expenses. The per-name queue must instead
    // consume one distinct id per goal.
    const fake = makeFakeTx();
    fake.setSelectResult("accounts", [
      { id: "acct-1", name: "529 Plan", beneficiaryFamilyMemberId: null, beneficiaryName: null },
      { id: "acct-2", name: "529 Plan", beneficiaryFamilyMemberId: null, beneficiaryName: null },
    ]);
    fake.setSelectResult("family_members", []);
    const payload: ImportPayload = {
      ...emptyImportPayload(),
      goals: {
        education: [
          completeEducationGoal({
            id: "edu:1",
            dedicatedAccountNames: ["529 Plan"],
            annualAmount: { value: 10000, provenance: "stated" },
          }),
          completeEducationGoal({
            id: "edu:2",
            dedicatedAccountNames: ["529 Plan"],
            annualAmount: { value: 20000, provenance: "stated" },
          }),
        ],
        homePurchases: [],
      },
    };

    const result = await commitGoals(fake.tx, payload, CTX);

    expect(result.created).toBe(2);
    expect(result.warnings).toEqual([]);
    const joinInserts = insertCalls(fake, "expense_dedicated_accounts");
    expect(joinInserts).toHaveLength(2);
    const linkedAccountIds = joinInserts.map(
      (c) => ((c as { values: { accountId: string }[] }).values)[0].accountId,
    );
    expect(new Set(linkedAccountIds).size).toBe(2); // distinct — not both "acct-2"
    expect(linkedAccountIds.sort()).toEqual(["acct-1", "acct-2"]);
  });

  it("falls through to the not-found warning once a name's queue is exhausted", async () => {
    // Only ONE "529 Plan" account exists but TWO goals name it. The first goal
    // claims it; the second must warn rather than reusing the same id again.
    const fake = makeFakeTx();
    fake.setSelectResult("accounts", [
      { id: "acct-1", name: "529 Plan", beneficiaryFamilyMemberId: null, beneficiaryName: null },
    ]);
    fake.setSelectResult("family_members", []);
    const payload: ImportPayload = {
      ...emptyImportPayload(),
      goals: {
        education: [
          completeEducationGoal({
            id: "edu:1",
            dedicatedAccountNames: ["529 Plan"],
            annualAmount: { value: 10000, provenance: "stated" },
          }),
          completeEducationGoal({
            id: "edu:2",
            dedicatedAccountNames: ["529 Plan"],
            annualAmount: { value: 20000, provenance: "stated" },
          }),
        ],
        homePurchases: [],
      },
    };

    const result = await commitGoals(fake.tx, payload, CTX);

    expect(result.created).toBe(2);
    const joinInserts = insertCalls(fake, "expense_dedicated_accounts");
    expect(joinInserts).toHaveLength(1); // only the first goal got a join row
    expect(result.warnings.join(" ")).toContain("529 Plan");
    expect(result.warnings.join(" ")).toContain("created without dedicated funding");
  });
});

describe("commitGoals — home purchase", () => {
  it("writes a buy asset transaction with the mortgage triple and no sell-side fields", async () => {
    const fake = makeFakeTx();
    fake.setSelectResult("accounts", [
      { id: "acct-checking", name: "Joint Checking", beneficiaryFamilyMemberId: null, beneficiaryName: null },
    ]);

    const payload = payloadWithHomePurchase({ fundingAccountId: "acct-checking" });

    const result = await commitGoals(fake.tx, payload, CTX);

    expect(result.created).toBe(1);
    const txValues = insertValues(fake, "asset_transactions");
    expect(txValues).toMatchObject({
      type: "buy",
      year: 2029,
      purchasePrice: "700000",
      assetCategory: "real_estate",
      fundingAccountId: "acct-checking",
      mortgageAmount: "560000",
    });
    // Buy rows carry no sell-side fields (CHECK asset_transactions_buy_no_source_check).
    // The fake tx cannot enforce the DB CHECK constraint, so this documents intent
    // by asserting the module never SETS these keys on a buy row at all.
    expect(txValues.accountId).toBeUndefined();
    expect(txValues.purchaseTransactionId).toBeUndefined();
    expect(txValues.businessAccountId).toBeUndefined();
    expect(txValues.fractionSold).toBeUndefined();
  });

  it("skips a purchase with neither a name nor a price", async () => {
    const fake = makeFakeTx();
    const payload = payloadWithHomePurchase({ name: "", assetName: "", purchasePrice: "" });

    const result = await commitGoals(fake.tx, payload, CTX);

    expect(result.created).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it("omits the mortgage entirely when the advisor never expanded that section", async () => {
    const fake = makeFakeTx();
    const payload = payloadWithHomePurchase({
      showMortgage: false,
      mortgageAmount: "560000",
      purchasePrice: "700000",
    });

    await commitGoals(fake.tx, payload, CTX);

    const txValues = insertValues(fake, "asset_transactions");
    expect(txValues.mortgageAmount).toBeNull();
  });

  it("drops a funding account id that does not belong to this client", async () => {
    const fake = makeFakeTx();
    fake.setSelectResult("accounts", []); // the id below belongs to nobody in scope
    const payload = payloadWithHomePurchase({
      fundingAccountId: "00000000-0000-0000-0000-000000000000",
      purchasePrice: "700000",
    });

    const result = await commitGoals(fake.tx, payload, CTX);

    const txValues = insertValues(fake, "asset_transactions");
    expect(txValues.fundingAccountId).toBeNull();
    expect(result.warnings.join(" ")).toContain("no longer available");
  });
});
