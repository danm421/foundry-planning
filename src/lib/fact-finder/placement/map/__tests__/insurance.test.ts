// src/lib/fact-finder/placement/map/__tests__/insurance.test.ts
import { describe, expect, it } from "vitest";
import { ltcPolicyProblems, type LtcCrossFieldInput } from "@/lib/schemas/ltc-policies";
import { findSection } from "../../../schema";
import type { FFRow } from "../../../types";
import { bookWith, contextOf, hendricksBook, linkedTo, recordOf, rowOf, stateWith } from "../../__tests__/fixtures";
import type { ChangeLine } from "../../../change-set";
import { diffDrafts } from "../../diff";
import { lineValues, payloadFor, type Resolve } from "../../payload";
import { NO_CO_CLIENT_REASON } from "../../refs";
import type { BookRecord, RecordBook, TargetDraft } from "../../types";
import { validateLines } from "../../validate";
import { columnFeeding } from "../index";
import { DISABILITY_MAP, INSURANCE_NOTES_MAP, LIFE_MAP, LTC_MAP } from "../insurance";
import type { SectionMap } from "../types";

const client = { ref: "person", role: "client" } as const;
const spouse = { ref: "person", role: "spouse" } as const;
const emma = { ref: "record", target: "family_member", id: "fm-emma" } as const;
const lucas = { ref: "record", target: "family_member", id: "fm-lucas" } as const;
const kids = {
  family_member: [
    recordOf("fm-emma", "Emma Hendricks", { firstName: "Emma", lastName: "Hendricks" }),
    recordOf("fm-lucas", "Lucas Hendricks", { firstName: "Lucas", lastName: "Hendricks" }),
  ],
};

/** `map.place` over these rows (other sections alongside) against `book` — Mark & Laura and their kids by default. */
function place(map: SectionMap, rows: FFRow[], book: RecordBook = hendricksBook(kids), other: Record<string, FFRow[]> = {}) {
  const { ctx, notices } = contextOf(stateWith({ [map.sectionId]: rows, ...other }), book);
  return { drafts: map.place(rows, ctx), notices };
}
const at = (sectionId: string, rowId: string) => (columnId: string) => ({ sectionId, rowId, columnId });
const values = (d: TargetDraft) => Object.fromEntries(d.fields.map((f) => [f.key, f.value]));
const fieldOf = (d: TargetDraft, key: string) => d.fields.find((f) => f.key === key);

describe("placements", () => {
  it.each([LIFE_MAP, INSURANCE_NOTES_MAP, DISABILITY_MAP, LTC_MAP])("$sectionId declares every column exactly once", (map) => {
    expect(Object.keys(map.placements).sort()).toEqual(findSection(map.sectionId)!.columns.map((c) => c.id).sort());
  });

  it("Group / employer coverage is a note for the AI step — the map places nothing", () => {
    expect(INSURANCE_NOTES_MAP.placements).toEqual({ notes: { note: "insurance" } });
    expect(place(INSURANCE_NOTES_MAP, [rowOf("insurance_notes:Notes", { notes: "Group life 2x salary through Acme" })]).drafts).toEqual([]);
  });
});

describe("LIFE_MAP", () => {
  const c = at("life", "life-1");
  const filled = rowOf("life-1", {
    policyName: "NWM Term 20", carrier: "Northwestern Mutual", policyType: "Term", insured: "Client", owner: "Client",
    deathBenefit: 1000000, cashValue: 0, costBasis: 18000, annualPremium: 1200, premiumPaidBy: "Owner",
    premiumPaymentYears: 20, termIssueYear: 2015, termLengthYears: 20, termEndsAtRetirement: "No",
    policyNumber: "NW-0098-4321", primaryBeneficiary: "Laura 100%", contingentBeneficiary: "Emma 50%, Lucas 50%",
    ownerEntity: "Hendricks ILIT", // not read: Owner isn't "Trust / entity"
  });

  it("a filled policy: every field from its cell, and the beneficiaries as a second line hanging off it", () => {
    expect(place(LIFE_MAP, [filled]).drafts).toEqual([
      {
        lineId: "life-1/life_insurance_policy",
        sectionId: "life",
        rowId: "life-1",
        target: "life_insurance_policy",
        recordId: null,
        label: "NWM Term 20",
        fields: [
          { key: "name", value: "NWM Term 20", from: [c("policyName")] },
          { key: "carrier", value: "Northwestern Mutual", from: [c("carrier")] },
          { key: "policyNumberLast4", value: "4321", from: [c("policyNumber")] },
          { key: "policyType", value: "term", from: [c("policyType")] },
          { key: "insuredPerson", value: "client", from: [c("insured")] },
          { key: "ownerRef", value: client, from: [c("owner")] },
          { key: "faceValue", value: 1000000, from: [c("deathBenefit")] },
          { key: "cashValue", value: 0, from: [c("cashValue")] },
          { key: "costBasis", value: 18000, from: [c("costBasis")] },
          { key: "premiumAmount", value: 1200, from: [c("annualPremium")] },
          { key: "premiumPayer", value: "owner", from: [c("premiumPaidBy")] },
          { key: "premiumYears", value: 20, from: [c("premiumPaymentYears")] },
          { key: "termIssueYear", value: 2015, from: [c("termIssueYear")] },
          { key: "termLengthYears", value: 20, from: [c("termLengthYears")], with: { endsAtInsuredRetirement: false } },
          { key: "endsAtInsuredRetirement", value: false, from: [c("termEndsAtRetirement")] },
        ],
        warnings: [],
      },
      {
        lineId: "life-1/life_insurance_policy_beneficiary",
        sectionId: "life",
        rowId: "life-1",
        target: "life_insurance_policy_beneficiary",
        recordId: null,
        label: "NWM Term 20 — beneficiaries",
        fields: [
          {
            key: "beneficiaries",
            value: [
              { tier: "primary", who: spouse, percentage: 100 },
              { tier: "contingent", who: emma, percentage: 50 },
              { tier: "contingent", who: lucas, percentage: 50 },
            ],
            from: [c("primaryBeneficiary"), c("contingentBeneficiary")],
          },
        ],
        warnings: [],
        parent: { ref: "line", target: "life_insurance_policy", lineId: "life-1/life_insurance_policy" },
        dependsOn: ["life-1/life_insurance_policy"],
      },
    ]);
  });

  it("Policy # keeps only its last 4 — and with no policy name, carrier and last 4 name the line", () => {
    const [unnamed] = place(LIFE_MAP, [rowOf("life-1", { carrier: "MetLife", policyNumber: "ML 77-1234-5678" })]).drafts;
    expect(unnamed.label).toBe("MetLife ··5678");
    expect(values(unnamed)).toEqual({ carrier: "MetLife", policyNumberLast4: "5678" });
    expect(values(place(LIFE_MAP, [rowOf("life-1", { policyName: "Group life", policyNumber: "A12" })]).drafts[0])).toEqual({ name: "Group life" });
  });

  it("a blank cell makes no field, and no beneficiaries make no beneficiaries line", () => {
    const { drafts } = place(LIFE_MAP, [rowOf("life-1", { policyName: "Whole Life", deathBenefit: 500000, owner: null, primaryBeneficiary: "" })]);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].fields.map((f) => f.key)).toEqual(["name", "faceValue"]);
  });

  it("Owner Co-client or Joint — each needs a co-client", () => {
    const owned = (owner: string, book?: RecordBook) => place(LIFE_MAP, [rowOf("life-1", { policyName: "Term", owner })], book).drafts[0];
    expect(fieldOf(owned("Co-client"), "ownerRef")).toEqual({ key: "ownerRef", value: spouse, from: [c("owner")] });
    expect(values(owned("Joint")).ownerRef).toBe("joint");
    const alone = owned("Joint", bookWith({}));
    expect(alone.blocked).toEqual({ reason: NO_CO_CLIENT_REASON, cell: c("owner") });
    expect(values(alone).ownerRef).toBeUndefined();
  });

  it("Owner Trust / entity names a trust in the Trusts section or on the plan; blank is blocked", () => {
    const owned = (ownerEntity: string | null) => rowOf("life-1", { policyName: "Survivorship", owner: "Trust / entity", ownerEntity });
    const trustRow = rowOf("trust-1", { trustName: "Hendricks ILIT", trustType: "ILIT" });
    const [fromRow] = place(LIFE_MAP, [owned("Hendricks ILIT")], hendricksBook(kids), { trusts: [trustRow] }).drafts;
    expect(fieldOf(fromRow, "ownerRef")).toEqual({
      key: "ownerRef",
      value: { ref: "line", target: "entity", lineId: "trust-1/entity" },
      from: [c("owner"), c("ownerEntity")],
    });
    expect(fromRow.dependsOn).toEqual(["trust-1/entity"]);
    const trustOnRecord = hendricksBook({ ...kids, entity: [recordOf("ent-1", "Hendricks ILIT", { name: "Hendricks ILIT" })] });
    expect(values(place(LIFE_MAP, [owned("Hendricks ILIT")], trustOnRecord).drafts[0]).ownerRef).toEqual({ ref: "record", target: "entity", id: "ent-1" });
    expect(place(LIFE_MAP, [owned(null)]).drafts[0].blocked).toEqual({ reason: "Pick which trust or entity owns it.", cell: c("ownerEntity") });
  });

  it('Owner "Other" blocks a new policy, and is left out of a policy on record with a warning', () => {
    const fresh = place(LIFE_MAP, [rowOf("life-1", { policyName: "NWM Term 20", owner: "Other" })]).drafts[0];
    expect(fresh.blocked).toEqual({ reason: 'Owner "Other" needs a name — pick another owner, or add this policy in Details.', cell: c("owner") });
    const book = hendricksBook({ ...kids, life_insurance_policy: [recordOf("pol-1", "NWM Term 20", { name: "NWM Term 20" })] });
    const linked = place(LIFE_MAP, [rowOf("life-1", { policyName: "NWM Term 20", owner: "Other" }, { link: linkedTo("pol-1") })], book).drafts[0];
    expect(linked.recordId).toBe("pol-1");
    expect(linked.blocked).toBeUndefined();
    expect(values(linked)).toEqual({ name: "NWM Term 20" });
    expect(linked.warnings).toEqual(['Owner "Other" names no one, so the owner on record stays.']);
  });

  it("insuring the co-client, or both, needs a co-client", () => {
    const insured = (who: string, book?: RecordBook) => place(LIFE_MAP, [rowOf("life-1", { policyName: "Term", insured: who })], book).drafts[0];
    expect(values(insured("Joint (survivorship)")).insuredPerson).toBe("joint");
    expect(insured("Co-client").blocked).toBeUndefined();
    expect(insured("Joint (survivorship)", bookWith({})).blocked).toEqual({ reason: NO_CO_CLIENT_REASON, cell: c("insured") });
  });

  it("a term ends after its length or at the insured's retirement, never both — each clears the other", () => {
    const both = place(LIFE_MAP, [rowOf("life-1", { policyName: "Term", termLengthYears: 20, termEndsAtRetirement: "Yes" })]).drafts[0];
    expect(both.fields).toEqual([
      { key: "name", value: "Term", from: [c("policyName")] },
      { key: "endsAtInsuredRetirement", value: true, from: [c("termEndsAtRetirement")], with: { termLengthYears: null } },
    ]);
    expect(both.warnings).toEqual(["A term policy ends after its length or at the insured's retirement, not both — the term length isn't saved."]);
    const length = place(LIFE_MAP, [rowOf("life-1", { termLengthYears: 20 })]).drafts[0];
    expect(length.fields).toEqual([{ key: "termLengthYears", value: 20, from: [c("termLengthYears")], with: { endsAtInsuredRetirement: false } }]);
    expect(length.warnings).toEqual([]);
  });

  describe("beneficiaries", () => {
    const policy = recordOf("pol-1", "NWM Term 20", { name: "NWM Term 20" });
    const onRecord = recordOf("pol-1", "NWM Term 20", {
      beneficiaries: [
        { tier: "primary", who: spouse, percentage: 100 },
        { tier: "contingent", who: emma, percentage: 100 },
      ],
    });
    const book = hendricksBook({ ...kids, life_insurance_policy: [policy], life_insurance_policy_beneficiary: [onRecord] });

    it("on a policy on record: its id and the record as parent — and a blank tier keeps that tier's rows on record", () => {
      const row = rowOf("life-1", { policyName: "NWM Term 20", contingentBeneficiary: "Emma 50%, Lucas 50%" }, { link: linkedTo("pol-1") });
      expect(place(LIFE_MAP, [row], book).drafts[1]).toEqual({
        lineId: "life-1/life_insurance_policy_beneficiary",
        sectionId: "life",
        rowId: "life-1",
        target: "life_insurance_policy_beneficiary",
        recordId: "pol-1",
        label: "NWM Term 20 — beneficiaries",
        fields: [
          {
            key: "beneficiaries",
            value: [
              { tier: "primary", who: spouse, percentage: 100 },
              { tier: "contingent", who: emma, percentage: 50 },
              { tier: "contingent", who: lucas, percentage: 50 },
            ],
            from: [c("contingentBeneficiary")],
          },
        ],
        warnings: [{ text: "These beneficiaries replace the ones on record.", field: "beneficiaries" }],
        parent: { ref: "record", target: "life_insurance_policy", id: "pol-1" },
      });
    });

    it("the warning only when the record names someone (any tier) — with no one on record there's nothing to replace", () => {
      const row = rowOf("life-1", { policyName: "NWM Term 20", primaryBeneficiary: "Laura" }, { link: linkedTo("pol-1") });
      const warningsWith = (beneficiaries: BookRecord["values"][string]) =>
        place(LIFE_MAP, [row], hendricksBook({ ...kids, life_insurance_policy: [policy], life_insurance_policy_beneficiary: [recordOf("pol-1", "NWM Term 20", { beneficiaries })] }))
          .drafts[1].warnings;
      expect(warningsWith([])).toEqual([]);
      expect(warningsWith([{ tier: "contingent", who: emma, percentage: 100 }])).toEqual([{ text: "These beneficiaries replace the ones on record.", field: "beneficiaries" }]);
    });

    it("a name that doesn't resolve blocks the beneficiaries line, not the policy", () => {
      const [policyLine, names] = place(LIFE_MAP, [rowOf("life-1", { policyName: "NWM Term 20", primaryBeneficiary: "Laura 50%, Olivia 50%" })]).drafts;
      expect(policyLine.blocked).toBeUndefined();
      expect(names.fields).toEqual([]);
      expect(names.blocked).toEqual({ reason: 'No one named "Olivia" in this fact finder or on the plan.', cell: c("primaryBeneficiary") });
    });
  });

  it("a row linked to a record not in the book never updates it", () => {
    const row = rowOf("life-1", { policyName: "NWM Term 20", primaryBeneficiary: "Laura" }, { link: linkedTo("pol-of-another-client") });
    const { drafts } = place(LIFE_MAP, [row]);
    expect(drafts.map((d) => d.recordId)).toEqual([null, null]);
    expect(drafts[1].parent).toEqual({ ref: "line", target: "life_insurance_policy", lineId: "life-1/life_insurance_policy" });
    expect(drafts[1].warnings).toEqual([]);
  });
});

describe("DISABILITY_MAP", () => {
  const c = at("disability", "di-1");
  const RUNS = '"…to age / for years" is saved only when Benefits run is "To age" or "For a number of years".';
  const onRecord = (values: Record<string, string>) =>
    hendricksBook({ disability_policy: [recordOf("di-rec", "Acme LTD", { name: "Acme LTD", ...values })] });
  const linkedRow = (cells: Parameters<typeof rowOf>[1]) => rowOf("di-1", cells, { link: linkedTo("di-rec") });

  it("a filled policy: every field from its cell, percents as fractions, the benefit period by its mode", () => {
    const row = rowOf("di-1", {
      policyName: "Acme LTD", carrier: "Unum", whoIsCovered: "Client", coveredEarnings: "Stated amount", coveredEarningsAmount: 180000,
      shortTerm: "Yes", stdWaitingDays: 7, stdBenefitPercent: 60, stdDurationWeeks: 13, stdMonthlyCap: 5000,
      longTerm: "Yes", ltdWaitingDays: 90, ltdBenefitPercent: 65, ltdMonthlyCap: 12000, benefitsRun: "To age", benefitsRunValue: 65,
      benefitsTaxable: "No", annualIncrease: 2.5, annualPremium: 1800, premiumPayer: "Insured",
    });
    expect(place(DISABILITY_MAP, [row]).drafts).toEqual([
      {
        lineId: "di-1/disability_policy",
        sectionId: "disability",
        rowId: "di-1",
        target: "disability_policy",
        recordId: null,
        label: "Acme LTD",
        fields: [
          { key: "name", value: "Acme LTD", from: [c("policyName")] },
          { key: "carrier", value: "Unum", from: [c("carrier")] },
          { key: "insured", value: "client", from: [c("whoIsCovered")] },
          { key: "coveredEarningsMode", value: "manual", from: [c("coveredEarnings")] },
          { key: "coveredEarningsAmount", value: 180000, from: [c("coveredEarningsAmount")] },
          { key: "hasShortTerm", value: true, from: [c("shortTerm")] },
          { key: "stdEliminationDays", value: 7, from: [c("stdWaitingDays")] },
          { key: "stdBenefitPct", value: 0.6, from: [c("stdBenefitPercent")] },
          { key: "stdDurationWeeks", value: 13, from: [c("stdDurationWeeks")] },
          { key: "stdMonthlyMax", value: 5000, from: [c("stdMonthlyCap")] },
          { key: "hasLongTerm", value: true, from: [c("longTerm")] },
          { key: "ltdEliminationDays", value: 90, from: [c("ltdWaitingDays")] },
          { key: "ltdBenefitPct", value: 0.65, from: [c("ltdBenefitPercent")] },
          { key: "ltdMonthlyMax", value: 12000, from: [c("ltdMonthlyCap")] },
          { key: "ltdBenefitPeriodMode", value: "to_age", from: [c("benefitsRun")] },
          { key: "ltdBenefitPeriodAge", value: 65, from: [c("benefitsRunValue")] },
          { key: "benefitTaxable", value: false, from: [c("benefitsTaxable")] },
          { key: "colaRate", value: 0.025, from: [c("annualIncrease")] },
          { key: "annualPremium", value: 1800, from: [c("annualPremium")] },
          { key: "premiumPayer", value: "insured", from: [c("premiumPayer")] },
        ],
        warnings: [],
      },
    ]);
  });

  it("…to age / for years goes to the field its mode needs: the row's mode, else the record's, else To age (a new policy's)", () => {
    const years = place(DISABILITY_MAP, [rowOf("di-1", { benefitsRun: "For a number of years", benefitsRunValue: 5 })]).drafts[0];
    expect(fieldOf(years, "ltdBenefitPeriodYears")).toEqual({ key: "ltdBenefitPeriodYears", value: 5, from: [c("benefitsRunValue")] });
    for (const mode of ["Lifetime", "To SS normal retirement age"]) {
      const none = place(DISABILITY_MAP, [rowOf("di-1", { benefitsRun: mode, benefitsRunValue: 5 })]).drafts[0];
      expect(values(none)).toEqual({ ltdBenefitPeriodMode: mode === "Lifetime" ? "lifetime" : "to_ssnra" });
      expect(none.warnings).toEqual([RUNS]);
    }
    expect(values(place(DISABILITY_MAP, [rowOf("di-1", { benefitsRunValue: 67 })]).drafts[0])).toEqual({ ltdBenefitPeriodAge: 67 });
    const linked = place(DISABILITY_MAP, [linkedRow({ benefitsRunValue: 5 })], onRecord({ ltdBenefitPeriodMode: "years" })).drafts[0];
    expect(linked.recordId).toBe("di-rec");
    expect(values(linked)).toEqual({ ltdBenefitPeriodYears: 5 });
  });

  it("a covered earnings amount is saved only under Stated amount — the row's, else the record's (a new policy's is Salary)", () => {
    const salary = place(DISABILITY_MAP, [rowOf("di-1", { coveredEarnings: "Salary", coveredEarningsAmount: 180000 })]).drafts[0];
    expect(values(salary)).toEqual({ coveredEarningsMode: "salary" });
    expect(salary.warnings).toEqual(['"Covered earnings amount" is saved only when Covered earnings is "Stated amount".']);
    expect(values(place(DISABILITY_MAP, [rowOf("di-1", { coveredEarningsAmount: 180000 })]).drafts[0])).toEqual({});
    const linked = place(DISABILITY_MAP, [linkedRow({ coveredEarningsAmount: 180000 })], onRecord({ coveredEarningsMode: "manual" })).drafts[0];
    expect(values(linked)).toEqual({ coveredEarningsAmount: 180000 });
    expect(linked.warnings).toEqual([]);
  });

  it("a blank monthly cap is no field (uncapped) — never a 0, which pays nothing; a typed $0 isn't saved", () => {
    expect(values(place(DISABILITY_MAP, [rowOf("di-1", { policyName: "Group LTD", stdMonthlyCap: null })]).drafts[0])).toEqual({ name: "Group LTD" });
    const zero = place(DISABILITY_MAP, [rowOf("di-1", { policyName: "Group LTD", stdMonthlyCap: 0, ltdMonthlyCap: 0 })]).drafts[0];
    expect(values(zero)).toEqual({ name: "Group LTD" });
    expect(zero.warnings).toEqual([
      `"STD monthly cap" of $0 would pay nothing, so it isn't saved — leave it blank for no cap.`,
      `"LTD monthly cap" of $0 would pay nothing, so it isn't saved — leave it blank for no cap.`,
    ]);
  });

  it("covering the co-client needs a co-client; a row linked to a record not in the book never updates it", () => {
    const covered = rowOf("di-1", { policyName: "Group LTD", whoIsCovered: "Co-client" });
    expect(place(DISABILITY_MAP, [covered], bookWith({})).drafts[0].blocked).toEqual({ reason: NO_CO_CLIENT_REASON, cell: c("whoIsCovered") });
    expect(place(DISABILITY_MAP, [covered]).drafts[0].blocked).toBeUndefined();
    const elsewhere = rowOf("di-1", { policyName: "Acme LTD" }, { link: linkedTo("di-of-another-client") });
    expect(place(DISABILITY_MAP, [elsewhere]).drafts[0].recordId).toBeNull();
  });
});

describe("LTC_MAP", () => {
  const c = at("ltc", "ltc-1");
  const lifeRow = rowOf("life-1", { policyName: "NWM Whole Life", carrier: "Northwestern Mutual", policyNumber: "4321", insured: "Client" });
  const withLife = (cells: Parameters<typeof rowOf>[1], book: RecordBook = hendricksBook()) =>
    place(LTC_MAP, [rowOf("ltc-1", cells)], book, { life: [lifeRow] }).drafts[0];
  const RIDER = "Rider on a life policy";
  const RIDER_TERMS = { riderBenefitMode: "pct_of_face", riderMonthlyPct: 0.02, riderMaxPct: 1, extensionYears: 0, residualDeathBenefit: 0 };
  /** What a rider stores that a standalone policy may not — the type clears them (LTC_RIDER_DEFAULTS). */
  const RIDER_WITH = { ...RIDER_TERMS, annualPremium: 0, sharedCare: false };
  /** What a standalone policy may not keep from a rider. */
  const STANDALONE_WITH = { lifePolicyAccountId: null, riderBenefitMode: null, riderMonthlyPct: null, riderMaxPct: null };

  it("a filled standalone policy: every field from its cell, percents as fractions, years and premiums by their modes", () => {
    const row = rowOf("ltc-1", {
      policyName: "Genworth LTC", carrier: "Genworth", whoIsCovered: "Co-client", policyType: "Traditional standalone",
      issueYear: 2015, benefitAmount: 6000, benefitPer: "Month", benefitsLast: "For a number of years", benefitYears: 3,
      waitingDays: 90, homeCarePercent: 75, policyPays: "Actual costs (reimbursement)", sharedCare: "Yes", statePartnership: "No",
      inflationProtection: "Compound", inflationRate: 3, annualPremium: 2400, premiumsPaid: "To age", premiumsPaidValue: 65,
    });
    expect(place(LTC_MAP, [row]).drafts).toEqual([
      {
        lineId: "ltc-1/ltc_policy",
        sectionId: "ltc",
        rowId: "ltc-1",
        target: "ltc_policy",
        recordId: null,
        label: "Genworth LTC",
        fields: [
          { key: "name", value: "Genworth LTC", from: [c("policyName")] },
          { key: "carrier", value: "Genworth", from: [c("carrier")] },
          { key: "insured", value: "spouse", from: [c("whoIsCovered")] },
          { key: "kind", value: "standalone", from: [c("policyType")], with: STANDALONE_WITH },
          { key: "issueYear", value: 2015, from: [c("issueYear")] },
          { key: "benefitAmount", value: 6000, from: [c("benefitAmount")] },
          { key: "benefitUnit", value: "month", from: [c("benefitPer")] },
          { key: "eliminationDays", value: 90, from: [c("waitingDays")] },
          { key: "homeCarePct", value: 0.75, from: [c("homeCarePercent")] },
          { key: "benefitType", value: "reimbursement", from: [c("policyPays")] },
          { key: "partnership", value: false, from: [c("statePartnership")] },
          { key: "inflationRider", value: "compound", from: [c("inflationProtection")] },
          { key: "inflationRate", value: 0.03, from: [c("inflationRate")] },
          { key: "benefitPeriodMode", value: "years", from: [c("benefitsLast")] },
          { key: "benefitPeriodYears", value: 3, from: [c("benefitYears")] },
          { key: "sharedCare", value: true, from: [c("sharedCare")] },
          { key: "annualPremium", value: 2400, from: [c("annualPremium")] },
          { key: "premiumPayMode", value: "to_age", from: [c("premiumsPaid")] },
          { key: "premiumPayToAge", value: 65, from: [c("premiumsPaidValue")] },
        ],
        warnings: [],
      },
    ]);
  });

  it("a standalone policy saves no life policy; Benefit years and premium years go where their modes say", () => {
    const d = withLife({
      policyType: "Traditional standalone", riderLifePolicy: "NWM Whole Life", benefitsLast: "Lifetime", benefitYears: 3,
      premiumsPaid: "For a number of years", premiumsPaidValue: 10,
    });
    expect(values(d)).toEqual({ kind: "standalone", benefitPeriodMode: "lifetime", premiumPayMode: "years", premiumPayYears: 10 });
    expect(d.dependsOn).toBeUndefined();
    expect(d.warnings).toEqual([
      `Only a rider is linked to a life policy, so "Life policy (if rider)" isn't saved.`,
      '"Benefit years" is saved only when Benefits last is "For a number of years".',
    ]);
  });

  it("blank modes: Benefits last has none on a new policy, Premiums paid is Lifetime; on a policy on record, the record's", () => {
    const fresh = place(LTC_MAP, [rowOf("ltc-1", { policyName: "Genworth LTC", benefitYears: 3, premiumsPaidValue: 65 })]).drafts[0];
    expect(values(fresh)).toEqual({ name: "Genworth LTC" });
    expect(fresh.warnings).toEqual([
      '"Benefit years" is saved only when Benefits last is "For a number of years".',
      '"…to age / for years" is saved only when Premiums paid is "To age" or "For a number of years".',
    ]);
    const book = hendricksBook({
      ltc_policy: [recordOf("ltc-rec", "Genworth LTC", { name: "Genworth LTC", kind: "standalone", benefitPeriodMode: "years", premiumPayMode: "to_age" })],
    });
    const linked = place(LTC_MAP, [rowOf("ltc-1", { benefitYears: 4, premiumsPaidValue: 70 }, { link: linkedTo("ltc-rec") })], book).drafts[0];
    expect(linked.recordId).toBe("ltc-rec");
    expect(values(linked)).toEqual({ benefitPeriodYears: 4, premiumPayToAge: 70 });
  });

  it("a new rider: its life policy from the Life section, the standard rider terms with its type, and what a rider doesn't keep", () => {
    const d = withLife({
      policyName: "NWM LTC rider", whoIsCovered: "Client", policyType: RIDER, riderLifePolicy: "NWM Whole Life",
      issueYear: 2018, waitingDays: 90, benefitsLast: "Lifetime", sharedCare: "Yes", annualPremium: 300, premiumsPaid: "Paid up",
    });
    expect(d.fields).toEqual([
      { key: "name", value: "NWM LTC rider", from: [c("policyName")] },
      { key: "insured", value: "client", from: [c("whoIsCovered")] },
      { key: "kind", value: "life_rider", from: [c("policyType")], with: RIDER_WITH },
      { key: "issueYear", value: 2018, from: [c("issueYear")] },
      { key: "eliminationDays", value: 90, from: [c("waitingDays")] },
      { key: "lifePolicyAccountId", value: { ref: "line", target: "life_insurance_policy", lineId: "life-1/life_insurance_policy" }, from: [c("riderLifePolicy")] },
    ]);
    expect(d.dependsOn).toEqual(["life-1/life_insurance_policy"]);
    expect(d.blocked).toBeUndefined();
    expect(d.warnings).toEqual([
      "Rider terms use the standard defaults (2% of the death benefit a month, up to 100%) — check them in Details.",
      'Not saved for a rider (only a standalone policy keeps them): "Benefits last", "Shared care?".',
      `A rider has no premium of its own — its cost is in the life policy's premium, so "Annual premium" isn't saved.`,
    ]);
  });

  it("a rider with a stated benefit amount pays that amount: the amount, after the type, makes its benefit fixed", () => {
    const d = withLife({ policyType: RIDER, riderLifePolicy: "NWM Whole Life", benefitAmount: 5000, benefitPer: "Month" });
    expect(d.fields.map((f) => f.key)).toEqual(["kind", "benefitAmount", "benefitUnit", "lifePolicyAccountId"]);
    expect(fieldOf(d, "benefitAmount")).toEqual({
      key: "benefitAmount", value: 5000, from: [c("benefitAmount")], with: { riderBenefitMode: "fixed", riderMonthlyPct: null },
    });
    expect(d.warnings).toEqual(["Rider terms use the standard defaults (up to 100% of the death benefit) — check them in Details."]);
    expect(values(withLife({ policyType: RIDER, riderLifePolicy: "NWM Whole Life", benefitAmount: 0 })).benefitAmount).toBeUndefined();
  });

  it("a rider needs its life policy: blank or not found is blocked", () => {
    expect(withLife({ policyType: RIDER }).blocked).toEqual({ reason: "Name the life policy this rider is on.", cell: c("riderLifePolicy") });
    expect(withLife({ policyType: RIDER, riderLifePolicy: "Prudential UL" }).blocked).toEqual({
      reason: 'No life policy named "Prudential UL" in this fact finder or on the plan.',
      cell: c("riderLifePolicy"),
    });
  });

  it("a rider on a policy on record; a rider on record keeps its life policy and its terms", () => {
    const policy = recordOf("pol-1", "NWM Whole Life", { name: "NWM Whole Life", carrier: "Northwestern Mutual", policyNumberLast4: "4321" });
    const riderOnRecord = recordOf("ltc-rec", "NWM LTC rider", {
      name: "NWM LTC rider", kind: "life_rider", lifePolicyAccountId: { ref: "record", target: "life_insurance_policy", id: "pol-1" },
    });
    const book = hendricksBook({ life_insurance_policy: [policy], ltc_policy: [riderOnRecord] });
    const fresh = place(LTC_MAP, [rowOf("ltc-1", { policyType: RIDER, riderLifePolicy: "Northwestern ··4321" })], book).drafts[0];
    expect(values(fresh).lifePolicyAccountId).toEqual({ ref: "record", target: "life_insurance_policy", id: "pol-1" });
    expect(fresh.dependsOn).toBeUndefined();
    const linked = place(LTC_MAP, [rowOf("ltc-1", { policyType: RIDER, waitingDays: 60 }, { link: linkedTo("ltc-rec") })], book).drafts[0];
    expect(linked.recordId).toBe("ltc-rec");
    expect(linked.blocked).toBeUndefined();
    expect(linked.warnings).toEqual([]);
  });

  it("a standalone policy on record that the fact finder calls a rider takes the rider terms with its new type", () => {
    const book = hendricksBook({
      ltc_policy: [recordOf("ltc-rec", "Genworth LTC", { name: "Genworth LTC", kind: "standalone", lifePolicyAccountId: null })],
    });
    const d = place(LTC_MAP, [rowOf("ltc-1", { policyType: RIDER, riderLifePolicy: "NWM Whole Life" }, { link: linkedTo("ltc-rec") })], book, { life: [lifeRow] }).drafts[0];
    expect(fieldOf(d, "kind")?.with).toEqual(RIDER_WITH);
    expect(d.warnings).toEqual(["Rider terms use the standard defaults (2% of the death benefit a month, up to 100%) — check them in Details."]);
  });

  describe("changing a policy on record between standalone and rider saves", () => {
    /** The policy as the edit route checks it: the stored row with the line's values (fields and their `with`) over it. */
    const savedAs = (record: BookRecord, d: TargetDraft, book: RecordBook) => {
      const [line] = diffDrafts([d], book);
      return { line, problems: ltcPolicyProblems({ ...record.values, ...lineValues(line) } as LtcCrossFieldInput) };
    };
    const standalone = recordOf("ltc-rec", "Genworth LTC", {
      name: "Genworth LTC", kind: "standalone", lifePolicyAccountId: null, benefitAmount: 6000, benefitUnit: "month",
      benefitPeriodMode: "years", benefitPeriodYears: 3, riderBenefitMode: null, riderMonthlyPct: null, riderMaxPct: null,
      annualPremium: 2400, sharedCare: true, premiumPayMode: "lifetime",
    });
    const rider = recordOf("ltc-rec", "NWM LTC rider", {
      name: "NWM LTC rider", kind: "life_rider", lifePolicyAccountId: { ref: "record", target: "life_insurance_policy", id: "pol-1" },
      benefitAmount: 0, benefitUnit: "month", benefitPeriodMode: null, benefitPeriodYears: null, riderBenefitMode: "pct_of_face",
      riderMonthlyPct: 0.02, riderMaxPct: 1, annualPremium: 0, sharedCare: false, premiumPayMode: "paid_up",
    });
    const flip = (record: BookRecord, cells: Parameters<typeof rowOf>[1]) => {
      const book = hendricksBook({ ltc_policy: [record] });
      const d = place(LTC_MAP, [rowOf("ltc-1", cells, { link: linkedTo("ltc-rec") })], book, { life: [lifeRow] }).drafts[0];
      return { d, ...savedAs(record, d, book) };
    };

    it("standalone → rider: the type clears the premium and shared care the standalone policy had", () => {
      const { d, problems } = flip(standalone, { policyType: RIDER, riderLifePolicy: "NWM Whole Life" });
      expect(fieldOf(d, "kind")?.with).toEqual(RIDER_WITH);
      expect(d.blocked).toBeUndefined();
      expect(problems).toEqual([]);
    });

    it("standalone → rider with the same benefit amount: the type still makes the benefit fixed", () => {
      const { d, line, problems } = flip(standalone, { policyType: RIDER, riderLifePolicy: "NWM Whole Life", benefitAmount: 6000 });
      expect(fieldOf(d, "kind")?.with).toEqual({ ...RIDER_WITH, riderBenefitMode: "fixed", riderMonthlyPct: null });
      expect(line.fields.map((f) => f.key)).not.toContain("benefitAmount");   // equal to the record's: the diff drops it
      expect(lineValues(line).riderBenefitMode).toBe("fixed");
      expect(problems).toEqual([]);
    });

    it("rider → standalone with its benefit amount and how long benefits last: the type clears the rider's life policy and terms", () => {
      const { d, problems } = flip(rider, { policyType: "Traditional standalone", benefitAmount: 6000, benefitsLast: "Lifetime" });
      expect(fieldOf(d, "kind")?.with).toEqual(STANDALONE_WITH);
      expect(d.blocked).toBeUndefined();
      expect(problems).toEqual([]);
    });

    it("a standalone line — new, or a rider made standalone — passes the save's payload and checks, its life policy link cleared", () => {
      const validate = (lines: ChangeLine[]) => validateLines(lines, (l, key) => columnFeeding(l.sectionId, l.target, key));
      const ids: Resolve = { id: (ref) => (ref.ref === "record" ? ref.id : "00000000-0000-4000-8000-000000000001"), year: () => 2026 };

      const book = hendricksBook();
      const fresh = rowOf("ltc-1", {
        policyName: "Genworth LTC", whoIsCovered: "Client", policyType: "Traditional standalone", issueYear: 2015, benefitAmount: 6000, benefitsLast: "Lifetime",
      });
      const [created] = validate(diffDrafts(place(LTC_MAP, [fresh], book).drafts, book));
      expect([created.action, created.blocked]).toEqual(["create", undefined]);
      expect(payloadFor("ltc_policy", lineValues(created), ids)).toMatchObject({ kind: "standalone", lifePolicyAccountId: null, riderBenefitMode: null });

      const { line } = flip(rider, { policyType: "Traditional standalone", benefitAmount: 6000, benefitsLast: "Lifetime" });
      const [updated] = validate([line]);
      expect([updated.action, updated.blocked]).toEqual(["update", undefined]);
      expect(payloadFor("ltc_policy", lineValues(updated), ids)).toMatchObject({ kind: "standalone", lifePolicyAccountId: null });
    });

    it("rider → standalone without its benefit amount or how long benefits last is blocked on the cell to fill", () => {
      const why = "A standalone policy needs its benefit amount and how long benefits last.";
      expect(flip(rider, { policyType: "Traditional standalone" }).d.blocked).toEqual({ reason: why, cell: c("benefitsLast") });
      expect(flip(rider, { policyType: "Traditional standalone", benefitAmount: 6000 }).d.blocked).toEqual({ reason: why, cell: c("benefitsLast") });
      expect(flip(rider, { policyType: "Traditional standalone", benefitsLast: "Lifetime" }).d.blocked).toEqual({ reason: why, cell: c("benefitAmount") });
      expect(flip(rider, { policyType: "Traditional standalone", benefitsLast: "For a number of years" }).d.blocked).toEqual({ reason: why, cell: c("benefitAmount") });
      expect(flip(rider, { policyType: "Traditional standalone", benefitAmount: 6000, benefitsLast: "For a number of years" }).d.blocked).toEqual({
        reason: why, cell: c("benefitYears"),
      });
      // A fixed-benefit rider's amount on record is enough.
      const fixed = { ...rider, values: { ...rider.values, riderBenefitMode: "fixed", riderMonthlyPct: null, benefitAmount: 5000 } };
      expect(flip(fixed, { policyType: "Traditional standalone", benefitsLast: "Lifetime" }).d.blocked).toBeUndefined();
    });
  });

  it("covering the co-client needs a co-client; a row linked to a record not in the book never updates it", () => {
    const covered = rowOf("ltc-1", { policyName: "Genworth LTC", whoIsCovered: "Co-client" });
    expect(place(LTC_MAP, [covered], bookWith({})).drafts[0].blocked).toEqual({ reason: NO_CO_CLIENT_REASON, cell: c("whoIsCovered") });
    const elsewhere = rowOf("ltc-1", { policyName: "Genworth LTC" }, { link: linkedTo("ltc-of-another-client") });
    expect(place(LTC_MAP, [elsewhere]).drafts[0].recordId).toBeNull();
  });
});
