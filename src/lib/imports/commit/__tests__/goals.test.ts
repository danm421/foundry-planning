import { describe, it, expect } from "vitest";

import { commitGoals } from "../goals";
import { emptyImportPayload, type ImportPayload } from "../../types";
import type { EducationGoal, HomePurchaseGoal } from "../../assemble/types";
import { blank } from "../../assemble/field";
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
    goals: { education: [completeEducationGoal(overrides)], homePurchases: [], riskTolerance: blank<string>() },
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
    // PERCENT STRINGS, not decimals. `HomePurchaseGoal` mirrors `BuyLegDraft`
    // field-for-field, and `BuyLegDraft` documents `growthRate`/`mortgageRate`
    // as percent strings (asset-transaction-leg-model.ts:38,43) because the
    // `PercentInput`s in `BuyLegEditor` write the raw typed percent onto goal
    // state. The advisor-facing path divides by 100 on submit (`optDec` in
    // use-asset-transaction-legs.ts); `commitGoals` must do the same. This
    // fixture previously carried decimals ("0.04"/"0.0625") — a contract the
    // UI never produces — which hid a 100x error all the way to the DB.
    growthRate: "4",
    basis: "",
    fundingAccountId: "",
    showMortgage: true,
    mortgageAmount: "560000",
    mortgageRate: "6.25",
    mortgageTermMonths: "360",
    ...overrides,
  };
}

/** Spreads `overrides` over a complete, valid `HomePurchaseGoal`, wrapped in an `ImportPayload`. */
function payloadWithHomePurchase(overrides: Partial<HomePurchaseGoal> = {}): ImportPayload {
  return {
    ...emptyImportPayload(),
    goals: { education: [], homePurchases: [completeHomePurchase(overrides)], riskTolerance: blank<string>() },
  };
}

/**
 * A complete education-savings 529 account row as returned by the `accounts`
 * SELECT — the shape `commitGoals` reads. Overrides only what a test varies
 * (id / name / the two beneficiary fields). NON-education accounts stay inline
 * so their off-default category/subType reads at the call site.
 */
type EduAccountRow = {
  id: string;
  name: string;
  category: string;
  subType: string;
  beneficiaryFamilyMemberId: string | null;
  beneficiaryName: string | null;
};

function eduAccount(overrides: Partial<EduAccountRow> = {}): EduAccountRow {
  return {
    id: "acct-emma-529",
    name: "Emma 529 Plan",
    category: "education_savings",
    subType: "529",
    beneficiaryFamilyMemberId: null,
    beneficiaryName: null,
    ...overrides,
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
    fake.setSelectResult("accounts", [eduAccount()]);
    fake.setSelectResult("family_members", [{ id: "fm-emma", firstName: "Emma" }]);

    const payload = payloadWithEducationGoal({
      name: { value: "Emma — College", provenance: "document" },
      forFamilyMemberName: { value: "Emma", provenance: "document" },
      annualAmount: { value: 45000, provenance: "stated" },
      startYear: { value: 2028, provenance: "derived", reason: "..." },
      years: { value: 4, provenance: "derived", reason: "..." },
      growthRate: { value: 0.06, provenance: "derived", reason: "..." },
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
      growthRate: "0.06",
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
    fake.setSelectResult("accounts", [eduAccount()]);
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
      // beneficiary already set by someone else
      eduAccount({ beneficiaryFamilyMemberId: "fm-noah" }),
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

  it("never overwrites a beneficiary set by NAME (external, no family member row)", async () => {
    // Covers the OTHER half of the never-overwrite guard: `beneficiaryName` set
    // (an external/outside beneficiary) with `beneficiaryFamilyMemberId` still
    // null. Checking only `beneficiaryFamilyMemberId == null` would wrongly
    // treat this account as unclaimed and clobber the external beneficiary.
    const fake = makeFakeTx();
    fake.setSelectResult("accounts", [
      // beneficiary set by name (external), not by family-member id
      eduAccount({ beneficiaryName: "Grandma Jones" }),
    ]);
    fake.setSelectResult("family_members", [{ id: "fm-emma", firstName: "Emma" }]);
    const payload = payloadWithEducationGoal({
      dedicatedAccountNames: ["Emma 529 Plan"],
      forFamilyMemberName: { value: "Emma", provenance: "document" },
      annualAmount: { value: 45000, provenance: "stated" },
    });

    await commitGoals(fake.tx, payload, CTX);

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
      eduAccount({ id: "acct-1", name: "529 Plan" }),
      eduAccount({ id: "acct-2", name: "529 Plan" }),
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
        riskTolerance: blank<string>(),
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
      eduAccount({ id: "acct-1", name: "529 Plan" }),
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
        riskTolerance: blank<string>(),
      },
    };

    const result = await commitGoals(fake.tx, payload, CTX);

    expect(result.created).toBe(2);
    const joinInserts = insertCalls(fake, "expense_dedicated_accounts");
    expect(joinInserts).toHaveLength(1); // only the first goal got a join row
    expect(result.warnings.join(" ")).toContain("529 Plan");
    expect(result.warnings.join(" ")).toContain("created without dedicated funding");
  });

  it("does not resolve an education goal's dedicated-account name against a same-named NON-education account (FIX 1)", async () => {
    // A checking account happens to share a display name with what the goal
    // calls its funding 529 (e.g. a rename, or a coincidental name collision).
    // Scoping to education accounts (category === "education_savings" ||
    // subType === "529") — the same way mortgage-link.ts scopes candidates to
    // category:"real_estate" before matching — must keep this checking
    // account out of the candidate pool entirely.
    const fake = makeFakeTx();
    fake.setSelectResult("accounts", [
      {
        id: "acct-checking",
        name: "529 Plan", // coincidentally same name, but NOT an education account
        category: "cash",
        subType: "checking",
        beneficiaryFamilyMemberId: null,
        beneficiaryName: null,
      },
    ]);
    fake.setSelectResult("family_members", []);
    const payload = payloadWithEducationGoal({
      dedicatedAccountNames: ["529 Plan"],
      annualAmount: { value: 10000, provenance: "stated" },
    });

    const result = await commitGoals(fake.tx, payload, CTX);

    expect(result.created).toBe(1);
    // The checking account must never be joined as dedicated funding.
    expect(insertCalls(fake, "expense_dedicated_accounts")).toHaveLength(0);
    expect(result.warnings.join(" ")).toContain("529 Plan");
    expect(result.warnings.join(" ")).toContain("created without dedicated funding");
  });

  it("skips a goal with no start year and warns, rather than writing an unbounded window", async () => {
    const fake = makeFakeTx();
    const payload = payloadWithEducationGoal({
      startYear: { value: null, provenance: "derived" },
      annualAmount: { value: 30000, provenance: "stated" },
    });

    const result = await commitGoals(fake.tx, payload, CTX);

    expect(result.created).toBe(0);
    expect(result.skipped).toBe(1);
    expect(callsForTable(fake.calls, "expenses").filter((c) => c.op === "insert")).toHaveLength(0);
    expect(result.warnings.join(" ")).toContain("no start year");
  });

  it("defaults a null years count to 1 and floors a non-positive count at 1", async () => {
    const fake = makeFakeTx();
    const nullYears = payloadWithEducationGoal({
      startYear: { value: 2028, provenance: "derived" },
      years: { value: null, provenance: "derived" },
      annualAmount: { value: 10000, provenance: "stated" },
    });
    const zeroYears = payloadWithEducationGoal({
      startYear: { value: 2028, provenance: "derived" },
      years: { value: 0, provenance: "derived" },
      annualAmount: { value: 10000, provenance: "stated" },
    });

    await commitGoals(fake.tx, nullYears, CTX);
    await commitGoals(fake.tx, zeroYears, CTX);

    const expenseInserts = callsForTable(fake.calls, "expenses").filter((c) => c.op === "insert") as {
      values: Record<string, unknown>;
    }[];
    expect(expenseInserts).toHaveLength(2);
    // Both a null years count (defaults to 1) and a 0 years count (floored to
    // 1 by Math.max) land on the SAME one-year window: end === start.
    expect(expenseInserts[0].values).toMatchObject({ startYear: 2028, endYear: 2028 });
    expect(expenseInserts[1].values).toMatchObject({ startYear: 2028, endYear: 2028 });
  });

  it("does not blame the whole goal when only SOME of its named accounts fail to resolve", async () => {
    // One of two named accounts resolves, the other doesn't. The warning must
    // say the account "was not linked" — NOT that "the goal was created
    // without dedicated funding" (which is only true when NOTHING resolved).
    const fake = makeFakeTx();
    fake.setSelectResult("accounts", [eduAccount({ id: "acct-real" })]);
    fake.setSelectResult("family_members", []);
    const payload = payloadWithEducationGoal({
      dedicatedAccountNames: ["Emma 529 Plan", "Nonexistent 529"],
      annualAmount: { value: 30000, provenance: "stated" },
    });

    const result = await commitGoals(fake.tx, payload, CTX);

    expect(result.created).toBe(1);
    // One join row landed, for the account that DID resolve.
    expect(insertCalls(fake, "expense_dedicated_accounts")).toHaveLength(1);
    expect(result.warnings.join(" ")).toContain("Nonexistent 529");
    expect(result.warnings.join(" ")).toContain("was not linked as dedicated funding");
    expect(result.warnings.join(" ")).not.toContain("created without dedicated funding");
  });
});

describe("commitGoals — home purchase", () => {
  it("writes a buy asset transaction with the mortgage triple and no sell-side fields", async () => {
    const fake = makeFakeTx();
    fake.setSelectResult("accounts", [
      { id: "acct-checking", name: "Joint Checking", beneficiaryFamilyMemberId: null, beneficiaryName: null },
    ]);

    const payload = payloadWithHomePurchase({ fundingAccountId: "acct-checking", basis: "50000" });

    const result = await commitGoals(fake.tx, payload, CTX);

    expect(result.created).toBe(1);
    const txValues = insertValues(fake, "asset_transactions");
    expect(txValues).toMatchObject({
      type: "buy",
      year: 2029,
      assetName: "123 Main St",
      purchasePrice: "700000",
      // "4" in, 0.04 stored — the percent→decimal conversion the columns
      // (decimal(5,4)) and the engine both require.
      growthRate: "0.04",
      basis: "50000",
      assetCategory: "real_estate",
      assetSubType: "primary_residence",
      fundingAccountId: "acct-checking",
      mortgageAmount: "560000",
      mortgageRate: "0.0625",
      mortgageTermMonths: 360,
    });
    // Buy rows carry no sell-side fields (CHECK asset_transactions_buy_no_source_check).
    // The fake tx cannot enforce the DB CHECK constraint, so this documents intent
    // by asserting the module never SETS these keys on a buy row at all.
    expect(txValues.accountId).toBeUndefined();
    expect(txValues.purchaseTransactionId).toBeUndefined();
    expect(txValues.businessAccountId).toBeUndefined();
    expect(txValues.fractionSold).toBeUndefined();
  });

  /**
   * REGRESSION GUARD — do not delete, do not "simplify" by folding the
   * expected values back into the input. `growthRate` and `mortgageRate` are
   * the ONLY two percent-string fields on `HomePurchaseGoal`; every other
   * numeric field here is a plain dollar amount from a `CurrencyInput` and
   * must pass through untouched. Writing "3.5" into a decimal(5,4) column
   * raises no error (ceiling 9.9999) — it just runs the projection at 350%
   * annual home appreciation, silently.
   */
  it("converts ONLY growthRate and mortgageRate from percent to decimal", async () => {
    const fake = makeFakeTx();
    const payload = payloadWithHomePurchase({
      purchasePrice: "700000",
      basis: "50000",
      growthRate: "3.5",
      showMortgage: true,
      mortgageAmount: "560000",
      mortgageRate: "6.75",
    });

    await commitGoals(fake.tx, payload, CTX);

    const txValues = insertValues(fake, "asset_transactions");
    expect(txValues.growthRate).toBe("0.035");
    expect(txValues.mortgageRate).toBe("0.0675");
    // Dollar fields are NOT percentages — untouched.
    expect(txValues.purchasePrice).toBe("700000");
    expect(txValues.basis).toBe("50000");
    expect(txValues.mortgageAmount).toBe("560000");
  });

  it("leaves a blank growth/mortgage rate null rather than converting it to 0", async () => {
    const fake = makeFakeTx();
    const payload = payloadWithHomePurchase({
      growthRate: "",
      showMortgage: true,
      mortgageRate: "   ",
    });

    await commitGoals(fake.tx, payload, CTX);

    const txValues = insertValues(fake, "asset_transactions");
    expect(txValues.growthRate).toBeNull();
    expect(txValues.mortgageRate).toBeNull();
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
