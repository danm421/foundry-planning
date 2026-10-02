// Pure tests of the scenario writer's field diff (`buildFieldDiff`), which
// decides whether a save stores an edit row at all: an empty diff deletes the
// row (idempotent revert), so a phantom difference here is a phantom change in
// the Changes list. No DB — the writer's live-DB suite lives beside this file.
import { describe, it, expect } from "vitest";
import { buildFieldDiff } from "../changes-writer";
import { scenarioAccountEditFields } from "@/lib/accounts/scenario-account-fields";
import { withoutRestatedInflationStart } from "@/lib/todays-dollars";

/** A base life policy as `loadPolicies` builds it — `faceValue` first. */
const LOADED_POLICY = {
  faceValue: 750_000,
  costBasis: 60_000,
  premiumAmount: 12_000,
  premiumYears: 20,
  premiumPayer: "owner",
  policyType: "whole",
  termIssueYear: null,
  termLengthYears: null,
  endsAtInsuredRetirement: false,
  cashValueGrowthMode: "free_form",
  premiumScheduleMode: "scheduled",
  deathBenefitScheduleMode: "scheduled",
  incomeScheduleMode: "scheduled",
  postPayoutGrowthRate: 0.06,
  postPayoutModelPortfolioId: null,
  cashValueSchedule: [
    { year: 2026, cashValue: 85_000, premiumAmount: 12_000 },
    { year: 2027, cashValue: 97_000, premiumAmount: 12_000 },
  ],
};

/** The same values as the policy dialog's `buildLifeInsurance` emits them —
 *  `policyType` first, schedule rows with their keys in another order. */
const DIALOG_POLICY = {
  policyType: "whole",
  faceValue: 750_000,
  costBasis: 60_000,
  premiumAmount: 12_000,
  premiumYears: 20,
  premiumPayer: "owner",
  termIssueYear: null,
  termLengthYears: null,
  endsAtInsuredRetirement: false,
  cashValueGrowthMode: "free_form",
  premiumScheduleMode: "scheduled",
  deathBenefitScheduleMode: "scheduled",
  incomeScheduleMode: "scheduled",
  postPayoutGrowthRate: 0.06,
  postPayoutModelPortfolioId: null,
  cashValueSchedule: [
    { premiumAmount: 12_000, cashValue: 85_000, year: 2026 },
    { premiumAmount: 12_000, cashValue: 97_000, year: 2027 },
  ],
};

const base = { id: "acct-1", name: "Whole Life", lifeInsurance: LOADED_POLICY };

describe("buildFieldDiff — nested objects compare canonically", () => {
  it("an unchanged policy save in a different key order diffs nothing", () => {
    expect(
      buildFieldDiff({ name: "Whole Life", lifeInsurance: DIALOG_POLICY }, base),
    ).toEqual({});
  });

  it("a real policy field change still diffs the policy", () => {
    const changed = { ...DIALOG_POLICY, faceValue: 800_000 };
    expect(buildFieldDiff({ lifeInsurance: changed }, base)).toEqual({
      lifeInsurance: { from: LOADED_POLICY, to: changed },
    });
  });

  it("array order is still significant", () => {
    const reordered = {
      ...DIALOG_POLICY,
      cashValueSchedule: [...DIALOG_POLICY.cashValueSchedule].reverse(),
    };
    expect(Object.keys(buildFieldDiff({ lifeInsurance: reordered }, base))).toEqual([
      "lifeInsurance",
    ]);
  });

  it("owner rows in another key order diff nothing", () => {
    const withOwners = {
      id: "acct-2",
      owners: [{ kind: "family_member", familyMemberId: "fm-1", percent: 1 }],
    };
    expect(
      buildFieldDiff(
        { owners: [{ percent: 1, familyMemberId: "fm-1", kind: "family_member" }] },
        withOwners,
      ),
    ).toEqual({});
  });

  it("keeps the numeric-string and null ≡ undefined rules", () => {
    expect(
      buildFieldDiff({ annualAmount: 250000, notes: undefined }, {
        id: "inc-1",
        annualAmount: "250000.00",
        notes: null,
      }),
    ).toEqual({});
  });
});

// Browser pass A: a one-field edit also recorded a second field as null —
// `growthRate` on a default-growth Taxable account (the form sends null for a
// derived rate; the base tree holds the RESOLVED rate) and `inflationStartYear`
// on an income (the form's null restates the row's "inflate from start", which
// the base stores as the start year itself). The producers now leave those out.
describe("a one-field scenario edit records exactly that field", () => {
  it("account: a value edit on a default-growth account diffs only `value`", () => {
    const base = { id: "acct-1", name: "Taxable Account", value: 185405.09, growthRate: 0.03235347, growthSource: "default" };
    const formBody = { name: "Taxable Account", value: "1111111", growthRate: null, growthSource: "default" };
    expect(Object.keys(buildFieldDiff(formBody, base))).toEqual(["value", "growthRate"]); // the defect
    expect(Object.keys(buildFieldDiff(scenarioAccountEditFields(formBody), base))).toEqual(["value"]);
  });

  it("account: a custom rate is still sent", () => {
    const body = { value: "1", growthRate: "0.07", growthSource: "custom" };
    expect(scenarioAccountEditFields(body)).toEqual(body);
  });

  it("income: an amount edit on a nominal-dollars row diffs only `annualAmount`", () => {
    const base = { id: "inc-1", annualAmount: 250000, startYear: 2026, inflationStartYear: 2026 };
    const formBody = { annualAmount: "111111", startYear: "2026", inflationStartYear: null };
    expect(Object.keys(buildFieldDiff(formBody, base))).toEqual(["annualAmount", "inflationStartYear"]); // the defect
    const fields = withoutRestatedInflationStart(formBody, base);
    expect(Object.keys(buildFieldDiff(fields, base))).toEqual(["annualAmount"]);
  });

  it("income: a moved start year still sends the null (the stored year would mean today's dollars)", () => {
    const row = { startYear: 2026, inflationStartYear: 2026 };
    const body = { annualAmount: "1", startYear: "2030", inflationStartYear: null };
    expect(withoutRestatedInflationStart(body, row)).toEqual(body);
  });

  it("income: turning today's dollars off a today's-dollars row still sends the null", () => {
    const row = { startYear: 2035, inflationStartYear: 2026 };
    const body = { annualAmount: "1", startYear: "2035", inflationStartYear: null };
    expect(withoutRestatedInflationStart(body, row)).toEqual(body);
  });
});
