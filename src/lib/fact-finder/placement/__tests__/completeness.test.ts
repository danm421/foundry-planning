// src/lib/fact-finder/placement/__tests__/completeness.test.ts
import { describe, expect, it } from "vitest";
import type { TargetKind } from "../../change-set";
import { FACT_FINDER_SECTIONS } from "../../schema";
import { SECTION_MAPS } from "../map/index";
import { placeFactFinder } from "../place";
import { targetField } from "../targets";
import { emptyRecordBook } from "../types";
import { rowOf, stateWith } from "./fixtures";

/** Every column with its placement, section by section. */
const PLACEMENTS = SECTION_MAPS.flatMap((map) => Object.entries(map.placements).map(([columnId, p]) => ({ sectionId: map.sectionId, columnId, p })));

describe("every section has its map", () => {
  it("one map per section, in schema order", () => {
    expect(SECTION_MAPS.map((m) => m.sectionId)).toEqual(FACT_FINDER_SECTIONS.map((s) => s.id));
  });

  it.each(FACT_FINDER_SECTIONS.map((s) => [s.id, s] as const))("%s places every column exactly once", (_, section) => {
    const map = SECTION_MAPS.find((m) => m.sectionId === section.id)!;
    expect(Object.keys(map.placements)).toEqual(section.columns.map((c) => c.id));
  });

  it("every `to` names a field of the targets catalog", () => {
    const unknown = PLACEMENTS.flatMap(({ sectionId, columnId, p }) => {
      if (!("to" in p)) return [];
      const [target, key] = p.to.split(".") as [TargetKind, string];
      return targetField(target, key) ? [] : [`${sectionId}.${columnId} → ${p.to}`];
    });
    expect(unknown).toEqual([]);
  });
});

/**
 * One fact finder that fills every column. A section whose columns exclude each
 * other takes several rows: a 401(k) for the Roth portion and an inherited
 * Traditional IRA for the after-tax basis; a joint account for Joint titling
 * and a trust-owned one for "Which trust / entity"; a loan with a term and one
 * that only says when it matures (its property named from the other side);
 * savings by a fixed $ with a % match and by % of salary with a flat match; a
 * standalone long-term care policy and a rider.
 */
const SAMPLE = stateWith({
  meta: [rowOf("meta:Household", { preparedFor: "Mark & Laura Hendricks", advisor: "Dana Cole", dateCompleted: "2026-03-02" })],
  people: [
    rowOf("people:Client", {
      firstName: "Mark", lastName: "Hendricks", dateOfBirth: "1968-04-12", retirementAge: 65, retirementMonth: "June", planToAge: 92,
      email: "mark@example.com", phone: "555-0100", mobile: "555-0101", coveredByWorkplacePlan: "Yes",
    }),
    rowOf("people:Co-client", {
      firstName: "Laura", lastName: "Hendricks", dateOfBirth: "1970-08-30", retirementAge: 63, retirementMonth: "January", planToAge: 95,
      email: "laura@example.com", phone: "555-0102", mobile: "555-0103", coveredByWorkplacePlan: "No",
    }),
  ],
  household: [
    rowOf("household:Household", {
      filingStatus: "Married filing jointly", stateOfResidence: "OH", street: "12 Elm St", address2: "Unit 4", city: "Columbus", state: "OH", zip: "43004",
    }),
  ],
  family: [
    rowOf("fam1", {
      firstName: "Emma", lastName: "Hendricks", relationship: "Child", dateOfBirth: "2001-09-01", claimedAsDependent: "No", domesticPartner: true,
      notes: "Lives in Denver.",
    }),
    rowOf("fam2", { firstName: "Lucas", lastName: "Hendricks", relationship: "Child" }),
  ],
  external: [rowOf("ext1", { name: "Red Cross", kind: "Charity", charityType: "Public charity", notes: "Gives every December." })],
  cash: [
    rowOf("cash1", {
      accountName: "Joint Checking", currentValue: 12500, last4: "1234", owner: "Joint", jointTitling: "JTWROS", custodian: "Chase",
      accountType: "Checking", interestRate: 0.5,
    }),
    rowOf("cash2", { accountName: "Trust Savings", currentValue: 40000, owner: "Trust / entity", ownerEntity: "Hendricks Family Trust" }),
  ],
  taxable: [
    rowOf("tax1", {
      accountName: "Schwab Brokerage", currentValue: 250000, costBasis: 180000, last4: "5678", owner: "Joint", jointTitling: "JTWROS",
      custodian: "Schwab", accountType: "Brokerage", marginLoan: 20000, marginRate: 8.5,
    }),
    rowOf("tax2", { accountName: "Trust Brokerage", currentValue: 90000, owner: "Trust / entity", ownerEntity: "Hendricks Family Trust" }),
  ],
  retirement: [
    rowOf("ret1", {
      accountName: "Fidelity 401(k)", currentValue: 412330, rothPortion: 30000, last4: "4321", owner: "Client", custodian: "Fidelity",
      accountType: "401(k)", priorYearEndValue: 400000, primaryBeneficiary: "Laura", contingentBeneficiary: "Emma 50%, Lucas 50%",
    }),
    rowOf("ret2", {
      accountName: "Inherited IRA", currentValue: 80000, afterTaxBasis: 5000, owner: "Co-client", accountType: "Traditional IRA",
      inherited: "Yes", originalOwnerBirthYear: 1940, originalOwnerDeathYear: 2020,
    }),
  ],
  annuity: [
    rowOf("ann1", {
      contractName: "Jackson VA", cashValue: 150000, costBasis: 100000, last4: "9876", owner: "Trust / entity", ownerEntity: "Hendricks Family Trust",
      carrier: "Jackson", taxTreatment: "Non-qualified", productType: "Variable", income: "None", payoutStructure: "Single life",
    }),
  ],
  edu: [
    // Grantor blank: the Owner fills it.
    rowOf("edu1", { accountName: "Emma 529", currentValue: 30000, basis: 20000, last4: "1111", owner: "Client", custodian: "Vanguard", beneficiary: "Emma" }),
    rowOf("edu2", { accountName: "Lucas 529", beneficiary: "Lucas", grantor: "Laura" }),
  ],
  equity: [
    rowOf("eq1", {
      company: "Acme Corp", ticker: "ACME", grantType: "NQSO", grantNumber: "N-100", grantDate: "2024-03-01", sharesGranted: 400,
      strikePrice: 12.5, expirationDate: "2034-03-01", vestingSchedule: "25% a year over 4 years", owner: "Client",
    }),
  ],
  notes_rec: [
    rowOf("nr1", {
      borrower: "Loan to Emma", originalAmount: 50000, currentBalance: 42000, balanceAsOf: "2026-01", interestRate: 4, paymentType: "Amortizing",
      monthlyPayment: 500, start: "2022-01", termMonths: 120, owner: "Trust / entity", ownerEntity: "Hendricks Family Trust",
    }),
  ],
  realestate: [
    rowOf("re1", {
      propertyName: "Main Home", propertyType: "Primary residence", currentValue: 650000, costBasis: 400000, owner: "Joint", jointTitling: "JTWROS",
      address: "12 Elm St", annualPropertyTax: 8000, mortgageName: "Home Mortgage",
    }),
    rowOf("re2", { propertyName: "Lake Cabin", currentValue: 300000, owner: "Trust / entity", ownerEntity: "Hendricks Family Trust" }),
  ],
  business: [
    rowOf("biz1", {
      businessName: "Hendricks Consulting", businessType: "LLC", currentValue: 500000, costBasis: 50000, ownersAndPercent: "Mark 60%, Laura 40%",
      taxTreatment: "QBI (pass-through)", distributionPercent: 80, annualIncome: 120000, annualExpense: 30000,
    }),
  ],
  liab: [
    // Property it's on blank: the Main Home's "Mortgage on it" names this loan. Term blank: it matures.
    rowOf("l1", {
      loanName: "Home Mortgage", type: "Mortgage", owner: "Trust / entity", ownerEntity: "Hendricks Family Trust", balance: 300000,
      balanceAsOf: "2026-02", interestRate: 6.5, monthlyPI: 2100, monthlyEscrow: 450, loanStart: "2020-06", matures: "2050-06",
      interestDeductible: "Yes",
    }),
    rowOf("l2", { loanName: "Cabin Loan", type: "Mortgage", owner: "Joint", balance: 100000, loanStart: "2021-01", termYears: 15, propertyName: "Lake Cabin" }),
  ],
  salary: [rowOf("salary:Client", { employer: "Acme Corp", annualSalary: 180000, annualRaise: 3, startYear: 2010, endYear: 2033 })],
  ss: [
    rowOf("ss:Client", {
      benefitSource: "Stated benefit at age", monthlyBenefit: 3200, benefitStatedAtAge: 67, whenToClaim: "At a specific age", claimAgeYears: "67",
      claimAgeMonths: 6, cola: 2.5,
    }),
  ],
  income: [
    rowOf("inc1", {
      incomeName: "Deferred comp", type: "Deferred comp", owner: "Client", annualAmount: 40000, annualIncrease: 2, startYear: 2034, endYear: 2043,
      taxType: "Ordinary income", paidInMonth: "March", survivorContinues: 50,
    }),
  ],
  living: [rowOf("living:Current", { annualAmount: 96000, annualIncrease: 3, startYear: 2026, endYear: 2033, notes: "Includes travel." })],
  living_items: [rowOf("li1", { item: "Groceries", amount: 1200, frequency: "Monthly" })],
  expenses: [
    rowOf("exp1", {
      expenseName: "Travel", type: "Other", annualAmount: 15000, annualIncrease: 3, startYear: 2027, endYear: 2040, isGoal: true,
      notes: "Europe every other year.",
    }),
  ],
  savings: [
    rowOf("sav1", {
      account: "Fidelity 401(k)", contribution: "Fixed $ amount", annualAmount: 23000, rothPercent: 50, employerMatch: 100, matchUpTo: 6,
      startYear: 2026, endYear: 2033, annualIncrease: 2,
    }),
    rowOf("sav2", { account: "Schwab Brokerage", contribution: "% of salary", percentOfSalary: 5, employerFlat: 1000 }),
  ],
  life: [
    rowOf("life1", {
      policyName: "Term Life", carrier: "Prudential", policyType: "Term", insured: "Client", owner: "Trust / entity", ownerEntity: "Hendricks Family Trust",
      deathBenefit: 1000000, cashValue: 2500, costBasis: 5000, annualPremium: 1200, premiumPaidBy: "Owner", premiumPaymentYears: 20,
      termIssueYear: 2015, termLengthYears: 20, termEndsAtRetirement: "No", policyNumber: "LP-00012345", primaryBeneficiary: "Laura",
      contingentBeneficiary: "Emma 50%, Lucas 50%",
    }),
  ],
  insurance_notes: [rowOf("insurance_notes:Notes", { notes: "Group life at work: 2x salary." })],
  disability: [
    rowOf("di1", {
      policyName: "Group LTD", carrier: "Unum", whoIsCovered: "Client", coveredEarnings: "Stated amount", coveredEarningsAmount: 150000,
      shortTerm: "Yes", stdWaitingDays: 7, stdBenefitPercent: 60, stdDurationWeeks: 12, stdMonthlyCap: 5000, longTerm: "Yes", ltdWaitingDays: 90,
      ltdBenefitPercent: 60, ltdMonthlyCap: 10000, benefitsRun: "To age", benefitsRunValue: 65, benefitsTaxable: "Yes", annualIncrease: 2,
      annualPremium: 800, premiumPayer: "Employer",
    }),
  ],
  ltc: [
    rowOf("ltc1", {
      policyName: "Genworth LTC", carrier: "Genworth", whoIsCovered: "Co-client", policyType: "Traditional standalone", issueYear: 2018,
      benefitAmount: 200, benefitPer: "Day", benefitsLast: "For a number of years", benefitYears: 3, waitingDays: 90, homeCarePercent: 100,
      policyPays: "Actual costs (reimbursement)", sharedCare: "Yes", statePartnership: "No", inflationProtection: "Compound", inflationRate: 3,
      annualPremium: 3000, premiumsPaid: "To age", premiumsPaidValue: 65,
    }),
    rowOf("ltc2", { policyName: "LTC Rider", whoIsCovered: "Client", policyType: "Rider on a life policy", riderLifePolicy: "Term Life", benefitAmount: 6000 }),
  ],
  estate_docs: [
    rowOf("estate_docs:Client", {
      will: true, revocableTrust: true, ilit: true, idgt: true, clt: true, crt: true, otherIrrevocable: true, lastUpdatedYear: 2019,
      estateAttorney: "Jane Smith, Smith & Co",
    }),
  ],
  trusts: [
    rowOf("tr1", {
      trustName: "Hendricks Family Trust", trustType: "Irrevocable", grantor: "Client", trustee: "Laura Hendricks", grantorTrust: "Yes", crummey: "Yes",
      trustEnds: "At second death", incomeBeneficiaries: "Laura", remainderBeneficiaries: "Emma 50%, Lucas 50%",
    }),
  ],
  bequests: [
    rowOf("bq1", { willOf: "Client", gift: "Specific asset", asset: "Schwab Brokerage", percent: 50, recipients: "Emma", condition: "If co-client predeceases" }),
    rowOf("bq2", { willOf: "Client", gift: "Remaining estate", recipients: "Laura" }),
  ],
  gifts: [rowOf("g1", { year: 2022, from: "Client", recipient: "Emma", given: "Cash", amount: 36000, form709Filed: "Yes" })],
  final_notes: [rowOf("final_notes:Notes", { notes: "Laura plans to sell the lake cabin." })],
});

describe("declared ↔ built: a fact finder that fills every column, against an empty book", () => {
  const placed = placeFactFinder(SAMPLE, emptyRecordBook("c1"), new Date("2026-03-15T12:00:00Z"));
  const fedBy = (sectionId: string, columnId: string, target?: TargetKind) =>
    placed.drafts.some(
      (d) => (target === undefined || d.target === target) && d.fields.some((f) => f.from.some((c) => c.sectionId === sectionId && c.columnId === columnId)),
    );

  it("the sample is filled: every column of every section has a value", () => {
    const blank = FACT_FINDER_SECTIONS.flatMap((s) =>
      s.columns.filter((c) => !(SAMPLE.sections[s.id] ?? []).some((r) => r.cells[c.id] !== undefined)).map((c) => `${s.id}.${c.id}`),
    );
    expect(blank).toEqual([]);
  });

  it("every value fits its column: no value went to the AI step as unfit", () => {
    expect(placed.leftovers.filter((l) => l.kind === "unfit")).toEqual([]);
  });

  it("every `to` column reaches a field of its declared target", () => {
    const missing = PLACEMENTS.flatMap(({ sectionId, columnId, p }) => {
      if (!("to" in p)) return [];
      return fedBy(sectionId, columnId, p.to.split(".")[0] as TargetKind) ? [] : [`${sectionId}.${columnId} → ${p.to}`];
    });
    expect(missing).toEqual([]);
  });

  it("every `note` column becomes a note for the AI step", () => {
    const missing = PLACEMENTS.flatMap(({ sectionId, columnId, p }) => {
      if (!("note" in p)) return [];
      const hit = placed.leftovers.some((l) => l.kind === "note" && l.topic === p.note && l.cell.sectionId === sectionId && l.cell.columnId === columnId);
      return hit ? [] : [`${sectionId}.${columnId}`];
    });
    expect(missing).toEqual([]);
  });

  it("no `context` column feeds any field", () => {
    const fed = PLACEMENTS.flatMap(({ sectionId, columnId, p }) => ("context" in p && fedBy(sectionId, columnId) ? [`${sectionId}.${columnId}`] : []));
    expect(fed).toEqual([]);
  });
});
