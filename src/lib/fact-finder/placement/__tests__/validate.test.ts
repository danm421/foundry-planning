import { describe, expect, it } from "vitest";
import type { ChangeLine, PlacedValue, RecordRef, TargetKind } from "../../change-set";
import { TARGETS } from "../targets";
import { validateLines } from "../validate";

const client: RecordRef = { ref: "person", role: "client" };
const spouse: RecordRef = { ref: "person", role: "spouse" };
const emma: RecordRef = { ref: "record", target: "family_member", id: "6f1c2d3e-0000-4000-8000-000000000001" };
const newLucas: RecordRef = { ref: "line", target: "family_member", lineId: "fam-2/family_member" };
const newTrust: RecordRef = { ref: "line", target: "entity", lineId: "trust-1/entity" };
const charity: RecordRef = { ref: "record", target: "external_beneficiary", id: "ext-1" };
const newAccount: RecordRef = { ref: "line", target: "account", lineId: "cash-1/account" };
const newPolicy: RecordRef = { ref: "line", target: "life_insurance_policy", lineId: "life-1/life_insurance_policy" };

interface LineSpec {
  action?: "create" | "update";
  fixed?: Record<string, PlacedValue>;
  with?: Record<string, Record<string, PlacedValue>>;
}

/** A line as the diff makes it: each field from the cell named after its key. */
function line(target: TargetKind, values: Record<string, PlacedValue>, spec: LineSpec = {}): ChangeLine {
  const action = spec.action ?? "create";
  return {
    id: `row-1/${target}`, page: "accounts", sectionId: "sec", rowId: "row-1", target, action,
    recordId: action === "create" ? null : "11111111-1111-4111-8111-111111111111",
    label: "Test line", warnings: [],
    ...(spec.fixed ? { fixed: spec.fixed } : {}),
    fields: Object.entries(values).map(([key, next]) => ({
      key, label: TARGETS[target].fields[key].label, next, shown: { next: String(next) }, ticked: true,
      from: [{ sectionId: "sec", rowId: "row-1", columnId: key }],
      ...(spec.with?.[key] ? { with: spec.with[key] } : {}),
    })),
  };
}

/** Stands in for Task 13's columnFeeding: the column that feeds a key. */
const feeding = (_line: ChangeLine, key: string) => `col:${key}`;
const fromCell = (columnId: string) => ({ sectionId: "sec", rowId: "row-1", columnId });
const blockedOf = (l: ChangeLine) => validateLines([l], feeding)[0].blocked;

const tranches = [{ vestDate: "2027-03-01", shares: 500 }, { vestDate: "2028-03-01", shares: 500 }];

/** [target, a valid line, an invalid one, its reason, the cell it points at] — every target with a Details check. */
const CASES: [TargetKind, ChangeLine, ChangeLine, string, ReturnType<typeof fromCell> | undefined][] = [
  [
    "client_household",
    line("client_household", { firstName: "Mark", dateOfBirth: "1970-03-04", retirementAge: 65, retirementMonth: 6, employer: "Acme" }, { action: "update" }),
    line("client_household", { retirementAge: 15 }, { action: "update" }),
    "Retirement age: must be 18 or more.", fromCell("retirementAge"),
  ],
  [
    "plan_settings_tax_rates",
    line("plan_settings_tax_rates", { coveredByWorkplacePlan: "yes", residenceState: "CA" }, { action: "update" }),
    line("plan_settings_tax_rates", { residenceState: "XX" }, { action: "update" }),
    "State of residence: this value can't be saved.", fromCell("residenceState"),
  ],
  [
    "family_member",
    line("family_member", { firstName: "Emma", lastName: "Hendricks", relationship: "child", dateOfBirth: "2005-09-01", claimedAsDependent: "yes" }),
    line("family_member", { lastName: "Hendricks", relationship: "child" }),
    "Needs First name.", fromCell("col:firstName"),
  ],
  [
    "external_beneficiary",
    line("external_beneficiary", { name: "Red Cross", kind: "charity", charityType: "public" }),
    line("external_beneficiary", { name: "Red Cross", kind: "trust" }),
    "Kind: pick one of the options.", fromCell("kind"),
  ],
  [
    "related_party",
    line("related_party", { firstName: "Jane", lastName: "Smith", employer: "Smith & Co" }, { fixed: { relationshipLabel: "Estate attorney" } }),
    line("related_party", { firstName: "Jane" }, { fixed: { relationshipLabel: "Estate attorney" } }),
    "Needs Last name.", fromCell("col:lastName"),
  ],
  [
    "account",
    line(
      "account",
      { name: "Joint Checking", value: 12000, subType: "checking", owners: [{ who: client, percent: 0.5 }, { who: spouse, percent: 0.5 }], titlingType: "jtwros", growthRate: 0.045, propertyAddress: "1 Main St", accountNumberLast4: "1234" },
      { fixed: { category: "cash" }, with: { growthRate: { growthSource: "custom" } } },
    ),
    line("account", { value: 12000 }, { fixed: { category: "cash" } }),
    "Needs Account name.", fromCell("col:name"),
  ],
  [
    "business_account",
    line(
      "business_account",
      { name: "Acme LLC", businessType: "llc", value: 900000, basis: 100000, owners: [{ who: client, percent: 0.6 }, { who: newTrust, percent: 0.4 }], businessTaxTreatment: "qbi", distributionPolicyPercent: 0.5 },
      { fixed: { category: "business" } },
    ),
    line(
      "business_account",
      { name: "Acme LLC", businessType: "llc", value: 900000, basis: 100000, owners: [{ who: client, percent: 0.5 }, { who: spouse, percent: 0.4 }] },
      { fixed: { category: "business" } },
    ),
    "Owners: ownership percentages must sum to 100%.", fromCell("owners"),
  ],
  [
    "account_beneficiary_designation",
    line("account_beneficiary_designation", { beneficiaries: [{ tier: "primary", who: spouse, percentage: 100 }, { tier: "contingent", who: emma, percentage: 50 }, { tier: "contingent", who: newLucas, percentage: 50 }] }),
    line("account_beneficiary_designation", { beneficiaries: [{ tier: "primary", who: emma, percentage: 50 }, { tier: "primary", who: newLucas, percentage: 40 }] }),
    "Beneficiaries: primary percentages must sum to 100 (got 90.00).", fromCell("beneficiaries"),
  ],
  [
    "annuity_contract",
    line("annuity_contract", { costBasis: 50000, productType: "fixed", incomeMode: "none" }),
    line("annuity_contract", { costBasis: -5, productType: "fixed" }),
    "Cost basis: must be zero or more.", fromCell("costBasis"),
  ],
  [
    "stock_option_account",
    line("stock_option_account", { name: "Globex", ticker: "GBX", owner: "client" }),
    line("stock_option_account", { name: "Globex" }),
    "Needs Owner.", fromCell("col:owner"),
  ],
  [
    "stock_option_grant",
    line("stock_option_grant", { grantType: "rsu", grantNumber: "R-1", grantDate: "2025-03-01", sharesGranted: 1000, tranches }),
    line("stock_option_grant", { grantType: "nqso", grantDate: "2025-03-01", sharesGranted: 1000, tranches }),
    "Needs Strike price.", fromCell("col:strikePrice"),
  ],
  [
    "note_receivable",
    line("note_receivable", {
      name: "Loan to Sam", faceValue: 50000, basis: 50000, asOfBalance: 42000, balanceAsOf: "2026-01", interestRate: 0.05,
      paymentType: "amortizing", monthlyPayment: 530, start: "2020-06", termMonths: 120, owners: [{ who: client, percent: 1 }],
    }),
    line("note_receivable", { name: "Loan to Sam", faceValue: 50000, basis: 50000, interestRate: 0.05, paymentType: "amortizing", termMonths: 120, owners: [{ who: client, percent: 1 }] }),
    "Needs Start.", fromCell("col:start"),
  ],
  [
    "liability",
    line("liability", {
      name: "Mortgage", liabilityType: "mortgage", owners: [{ who: client, percent: 1 }], balance: 310000, balanceAsOf: "2026-03",
      interestRate: 0.0625, monthlyPayment: 2100, start: "2015-07", termMonths: 360, isInterestDeductible: true, linkedPropertyId: newAccount,
    }),
    line("liability", { name: "Mortgage", start: "2015-07", termMonths: 13000 }),
    "Term (months): must be 12000 or less.", fromCell("termMonths"),
  ],
  [
    "income",
    line(
      "income",
      { annualAmount: 150000, growthRate: 0.03, start: 2026, end: { yearRef: "client_retirement" } },
      { fixed: { type: "salary", owner: "client", name: "Salary — Acme" }, with: { growthRate: { growthSource: "custom" } } },
    ),
    line("income", { annualAmount: 150000, end: { yearRef: "client_retirement" } }, { fixed: { type: "salary", owner: "client", name: "Salary" } }),
    "Needs Starts.", fromCell("col:start"),
  ],
  [
    "expense",
    line("expense", {
      name: "Travel", type: "other", annualAmount: 10000, start: 2026, end: { yearRef: "plan_end" }, isGoal: true,
      livingItems: [{ name: "Groceries", amount: 800, frequency: "monthly" }],
    }),
    line("expense", { type: "other", annualAmount: 10000, start: 2026, end: 2040 }),
    "Needs Name.", fromCell("col:name"),
  ],
  [
    "savings_rule",
    line("savings_rule", { accountId: newAccount, annualAmount: 23000, rothPercent: 0.5, employerMatchPct: 0.5, employerMatchCap: 0.06, start: 2026, end: { yearRef: "client_retirement" } }),
    line("savings_rule", { annualAmount: 23000, start: 2026, end: 2040 }),
    "Needs Account.", fromCell("col:accountId"),
  ],
  [
    "life_insurance_policy",
    line("life_insurance_policy", {
      name: "Term Life", carrier: "Prudential", policyNumberLast4: "9876", policyType: "term", insuredPerson: "client",
      ownerRef: client, faceValue: 1000000, premiumAmount: 1200, termIssueYear: 2015, termLengthYears: 20,
    }),
    line("life_insurance_policy", { name: "Term Life", policyType: "term", insuredPerson: "client", ownerRef: "joint", faceValue: 1000000, termLengthYears: 20 }),
    "Term issue year: term policies need a term issue year.", fromCell("col:termIssueYear"),
  ],
  [
    "life_insurance_policy_beneficiary",
    line("life_insurance_policy_beneficiary", { beneficiaries: [{ tier: "primary", who: newTrust, percentage: 100 }] }),
    line("life_insurance_policy_beneficiary", { beneficiaries: [{ tier: "primary", who: newTrust, percentage: 0 }] }),
    "Beneficiaries: must be more than 0.", fromCell("beneficiaries"),
  ],
  [
    "disability_policy",
    line("disability_policy", { name: "Group LTD", insured: "client", ltdBenefitPeriodMode: "to_age", ltdBenefitPeriodAge: 65, ltdBenefitPct: 0.6 }),
    line("disability_policy", { name: "Group LTD", insured: "client" }),
    "Benefits run to age: a to-age benefit period requires an age.", fromCell("col:ltdBenefitPeriodAge"),
  ],
  [
    "ltc_policy",
    line("ltc_policy", { name: "Genworth LTC", insured: "spouse", kind: "standalone", issueYear: 2015, benefitAmount: 6000, benefitUnit: "month", benefitPeriodMode: "years", benefitPeriodYears: 3 }),
    line("ltc_policy", { name: "Genworth LTC", insured: "spouse", kind: "standalone", issueYear: 2015, benefitAmount: 6000 }),
    "Benefits last: choose how long benefits last.", fromCell("col:benefitPeriodMode"),
  ],
  [
    "entity",
    line("entity", { name: "Hendricks ILIT", trustSubType: "ilit", grantor: "none", trustee: "Jane Smith", crummeyPowers: true }, { fixed: { entityType: "trust", isIrrevocable: true } }),
    line("entity", { name: "Hendricks ILIT", grantor: "client" }, { fixed: { entityType: "trust", isIrrevocable: true } }),
    "Needs Trust type.", fromCell("col:trustSubType"),
  ],
  [
    "trust_beneficiary_designation",
    line("trust_beneficiary_designation", { beneficiaries: [{ tier: "income", who: spouse, percentage: 100 }, { tier: "remainder", who: charity, percentage: 100 }] }),
    line("trust_beneficiary_designation", { beneficiaries: [{ tier: "remainder", who: emma, percentage: 80 }] }),
    "Beneficiaries: remainder percentages must sum to 100 (got 80.00).", fromCell("beneficiaries"),
  ],
  [
    "revocable_trust",
    line("revocable_trust", { name: "Hendricks Family Trust" }),
    line("revocable_trust", { name: "   " }),
    "Needs Trust name.", fromCell("name"),
  ],
  [
    "will",
    line("will", { grantor: "client" }),
    line("will", { grantor: "joint" }),
    "Will of: pick one of the options.", fromCell("grantor"),
  ],
  [
    "will_bequest",
    line(
      "will_bequest",
      { kind: "asset", accountId: newAccount, percentage: 100, recipients: [{ who: spouse, percentage: 100 }], condition: "always" },
      { fixed: { name: "Joint Checking", sortOrder: 0 }, with: { kind: { assetMode: "specific" } } },
    ),
    line(
      "will_bequest",
      { kind: "asset", accountId: newAccount, percentage: 100, recipients: [{ who: emma, percentage: 60 }, { who: newLucas, percentage: 30 }], condition: "always" },
      { fixed: { name: "Joint Checking", sortOrder: 0 }, with: { kind: { assetMode: "specific" } } },
    ),
    "Will provision: recipient percentages must sum to 100 (got 90).", undefined,
  ],
  [
    "will_residuary_recipient",
    line("will_residuary_recipient", { recipients: [{ who: spouse, percentage: 50 }, { who: newTrust, percentage: 50 }] }),
    line("will_residuary_recipient", { recipients: [{ who: emma, percentage: 50 }, { who: charity, percentage: 40 }] }),
    "Recipients: primary residuary recipient percentages must sum to 100 (got 90).", fromCell("recipients"),
  ],
  [
    "gift",
    line("gift", { year: 2020, grantor: "client", recipient: newTrust, amount: 18000, notes: "Form 709 filed: Yes." }),
    line("gift", { year: 2020, grantor: "client", amount: 18000 }),
    "Needs Recipient.", fromCell("col:recipient"),
  ],
  [
    "plan_observation",
    line("plan_observation", { topic: "cash-flow", body: "Mortgage: escrow of $450 a month." }, { fixed: { section: "observation", audience: "advisor", source: "manual" } }),
    line("plan_observation", { topic: "bogus", body: "Mortgage: escrow of $450 a month." }, { fixed: { section: "observation", audience: "advisor", source: "manual" } }),
    "Topic: pick one of the options.", fromCell("topic"),
  ],
];

describe("validateLines — every target against its Details check", () => {
  it("covers every target", () => {
    expect(CASES.map(([target]) => target).sort()).toEqual(Object.keys(TARGETS).sort());
  });

  it.each(CASES)("%s: a valid line passes untouched, an invalid one is blocked in plain words", (_target, valid, invalid, reason, cell) => {
    const [ok, bad] = validateLines([valid, invalid], feeding);
    expect(ok).toBe(valid);
    expect(bad.blocked).toEqual({ reason, ...(cell ? { cell } : {}) });
    expect(bad.blocked?.reason).not.toMatch(/expected|received|Invalid input|undefined/);
  });
});

describe("validateLines — the rules around the schemas", () => {
  it("a Create missing a required field points at the column that feeds it", () => {
    const blocked = validateLines([line("account", { value: 5 }, { fixed: { category: "taxable" } })], (_l, key) =>
      key === "name" ? "accountName" : undefined,
    )[0].blocked;
    expect(blocked).toEqual({ reason: "Needs Account name.", cell: { sectionId: "sec", rowId: "row-1", columnId: "accountName" } });
    expect(validateLines([line("account", { value: 5 }, { fixed: { category: "taxable" } })], () => undefined)[0].blocked).toEqual({
      reason: "Needs Account name.",
    });
  });

  it("an Update is checked only on the keys it sends — the record keeps the rest", () => {
    expect(blockedOf(line("stock_option_grant", { notes: "Refresher grant" }, { action: "update" }))).toBeUndefined();
    expect(blockedOf(line("income", { annualAmount: 160000 }, { action: "update" }))).toBeUndefined();
    expect(blockedOf(line("account", { subType: "bogus" }, { action: "update" }))).toEqual({
      reason: "Account type: pick one of the options.", cell: fromCell("subType"),
    });
  });

  it("leaves unchanged and already-blocked lines alone", () => {
    const none = { ...line("account", { name: "" }), action: "none" as const };
    const blocked = { ...line("account", {}), blocked: { reason: "Pick which trust or entity owns it." } };
    const [a, b] = validateLines([none, blocked], feeding);
    expect(a).toBe(none);
    expect(b).toBe(blocked);
  });

  it('a "Someone else" trust grantor saves as null and passes', () => {
    expect(blockedOf(line("entity", { name: "Dynasty Trust", trustSubType: "irrevocable", grantor: "none" }, { fixed: { entityType: "trust", isIrrevocable: true } }))).toBeUndefined();
  });

  it("keys a route drops (life carrier and last 4, a new account's address, a new family member's dependent flag) don't block", () => {
    expect(blockedOf(line("life_insurance_policy", { name: "Whole Life", carrier: "MetLife", policyNumberLast4: "1111", policyType: "whole", insuredPerson: "spouse", ownerRef: spouse, faceValue: 250000 }))).toBeUndefined();
    expect(blockedOf(line("account", { name: "Rental", propertyAddress: "9 Elm St" }, { fixed: { category: "real_estate" } }))).toBeUndefined();
    expect(blockedOf(line("family_member", { firstName: "Lucas", claimedAsDependent: "no" }))).toBeUndefined();
  });

  it("a new LTC rider with the standard rider terms passes; a rider with no life policy is blocked", () => {
    const rider = { kind: "life_rider", name: "LTC rider", insured: "client", issueYear: 2018 };
    const fixed = { riderBenefitMode: "pct_of_face", riderMonthlyPct: 0.02, riderMaxPct: 1 };
    expect(blockedOf(line("ltc_policy", { ...rider, lifePolicyAccountId: newPolicy }, { fixed }))).toBeUndefined();
    expect(blockedOf(line("ltc_policy", rider, { fixed }))).toEqual({
      reason: "Life policy (if rider): pick the life policy this rider is on.", cell: fromCell("col:lifePolicyAccountId"),
    });
  });

  it("a bound reads in the field's own units", () => {
    expect(blockedOf(line("disability_policy", { name: "LTD", insured: "client", ltdBenefitPeriodMode: "lifetime", colaRate: 0.25 }))).toEqual({
      reason: "Annual increase: must be 20% or less.", cell: fromCell("colaRate"),
    });
  });
});

describe("validateLines — the same person named twice", () => {
  it("blocks owners, beneficiaries and recipients that name one person twice, saying who", () => {
    const lucasLine: ChangeLine = { ...line("family_member", { firstName: "Lucas" }), id: "fam-2/family_member", label: "Lucas Hendricks" };
    const lines = validateLines(
      [
        lucasLine,
        line("account", { name: "Brokerage", owners: [{ who: client, percent: 0.5 }, { who: client, percent: 0.5 }] }, { fixed: { category: "taxable" } }),
        line("account_beneficiary_designation", { beneficiaries: [{ tier: "primary", who: newLucas, percentage: 50 }, { tier: "primary", who: newLucas, percentage: 50 }] }),
        line("will_residuary_recipient", { recipients: [{ who: emma, percentage: 50 }, { who: emma, percentage: 50 }] }),
        line("will_bequest", { kind: "asset", accountId: newAccount, percentage: 100, recipients: [{ who: newTrust, percentage: 50 }, { who: newTrust, percentage: 50 }], condition: "always" }, { fixed: { name: "Brokerage", sortOrder: 0 }, with: { kind: { assetMode: "specific" } } }),
        line("note_receivable", { name: "Loan", faceValue: 1, basis: 1, interestRate: 0, paymentType: "amortizing", start: "2020-01", termMonths: 12, owners: [{ who: spouse, percent: 0.5 }, { who: spouse, percent: 0.5 }] }),
      ],
      feeding,
    );
    expect(lines.map((l) => l.blocked)).toEqual([
      undefined,
      { reason: "Owner: names the client twice.", cell: fromCell("owners") },
      { reason: "Beneficiaries: names Lucas Hendricks twice.", cell: fromCell("beneficiaries") },
      { reason: "Recipients: names the same person twice.", cell: fromCell("recipients") },
      { reason: "Recipients: names the same trust twice.", cell: fromCell("recipients") },
      { reason: "Owner: names the co-client twice.", cell: fromCell("owners") },
    ]);
  });

  it("the same person in two beneficiary tiers is fine", () => {
    expect(blockedOf(line("account_beneficiary_designation", { beneficiaries: [{ tier: "primary", who: emma, percentage: 100 }, { tier: "contingent", who: emma, percentage: 100 }] }))).toBeUndefined();
  });
});
