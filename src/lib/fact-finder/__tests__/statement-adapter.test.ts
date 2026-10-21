// src/lib/fact-finder/__tests__/statement-adapter.test.ts
import { describe, expect, it } from "vitest";
import type { ExtractedAccount, ExtractedLiability, ExtractedLifePolicy } from "@/lib/extraction/types";
import type { Annotated } from "@/lib/imports/types";
import type { OwnerMatchFamilyMember } from "@/lib/imports/owner-match";
import { mergeReadings } from "../merge";
import { readingFromAccount, readingFromLiability, readingsFromStatements } from "../readers/statement-adapter";
import { emptyFactFinderState } from "../state";

const FAMILY: OwnerMatchFamilyMember[] = [
  { id: "fm-c", role: "client", firstName: "Mark", lastName: "Hendricks" },
  { id: "fm-s", role: "spouse", firstName: "Laura", lastName: "Hendricks" },
];
const acct = (row: Partial<Annotated<ExtractedAccount>>): Annotated<ExtractedAccount> => ({
  name: "Account",
  __provenance: { sourceFileId: "f1", section: "accounts", pageRange: [2, 3] },
  statementDate: "2026-09-30",
  ...row,
});

describe("readingFromAccount", () => {
  it("puts a 401(k) in Retirement and never fills After-tax basis from position basis", () => {
    const r = readingFromAccount(
      acct({
        name: "Fidelity 401(k) ··2201", category: "retirement", subType: "401k", value: 640000, basis: 85000,
        accountNumberLast4: "2201", custodian: "Fidelity", ownerNameHint: "MARK HENDRICKS",
        holdings: [{ ticker: "FXAIX", name: "Fidelity 500", shares: 100, marketValue: 20000 }],
      }),
      FAMILY,
    )!;
    expect(r.sectionId).toBe("retirement");
    expect(r.statementDate).toBe("2026-09-30");
    expect(r.cells.accountType.value).toBe("401(k)");
    expect(r.cells.currentValue).toEqual({ value: 640000, confidence: 0.9, source: { fileId: "f1", page: 2 } });
    expect(r.cells.owner.value).toBe("Client");
    expect(r.cells.afterTaxBasis).toBeUndefined();
    expect(r.holdings).toEqual([{ ticker: "FXAIX", name: "Fidelity 500", shares: 100, marketValue: 20000 }]);
  });

  it("maps every account category to its section", () => {
    const at = (row: Partial<ExtractedAccount>) => readingFromAccount(acct(row), FAMILY)?.sectionId;
    expect(at({ category: "cash", subType: "money_market" as never })).toBe("cash");
    expect(at({ category: "taxable", subType: "brokerage" })).toBe("taxable");
    expect(at({ category: "taxable", subType: "529" })).toBe("edu");
    expect(at({ category: "annuity" })).toBe("annuity");
    expect(at({ category: "real_estate", subType: "primary_residence" })).toBe("realestate");
    expect(at({ category: "business", subType: "llc" })).toBe("business");
    expect(at({ category: "life_insurance", subType: "term" })).toBe("life");
    expect(at({ category: "notes_receivable" })).toBe("notes_rec");
    expect(at({ category: "stock_options" })).toBe("equity");
  });

  it("fills each section's own columns", () => {
    const cash = readingFromAccount(acct({ category: "cash", subType: "money_market" as never, growthRate: 0.045 }), FAMILY)!;
    expect(cash.cells.accountType.value).toBe("Money market");
    expect(cash.cells.interestRate.value).toBe(4.5);
    const taxable = readingFromAccount(
      acct({ category: "taxable", subType: "brokerage", basis: 190000, marginBalance: 40000, marginInterestRate: 0.085 }),
      FAMILY,
    )!;
    expect(taxable.cells.costBasis.value).toBe(190000);
    expect(taxable.cells.marginLoan.value).toBe(40000);
    expect(taxable.cells.marginRate.value).toBe(8.5);
    const edu = readingFromAccount(acct({ category: "education_savings", beneficiaryNameHint: "Emma", grantorName: "Mark" }), FAMILY)!;
    expect(edu.cells.beneficiary.value).toBe("Emma");
    expect(edu.cells.grantor.value).toBe("Mark");
    const home = readingFromAccount(
      acct({ name: "Home", category: "real_estate", subType: "primary_residence", propertyAddress: "1450 Aspen Ridge Dr", annualPropertyTax: 4800 }),
      FAMILY,
    )!;
    expect(home.cells.propertyName.value).toBe("Home");
    expect(home.cells.propertyType.value).toBe("Primary residence");
    expect(home.cells.address.value).toBe("1450 Aspen Ridge Dr");
    expect(home.cells.annualPropertyTax.value).toBe(4800);
    const annuity = readingFromAccount(acct({ name: "Jackson VA", category: "annuity", subType: "non_qualified" as never, basis: 50000, custodian: "Jackson" }), FAMILY)!;
    expect(annuity.cells.contractName.value).toBe("Jackson VA");
    expect(annuity.cells.taxTreatment.value).toBe("Non-qualified");
    expect(annuity.cells.costBasis.value).toBe(50000);
    expect(annuity.cells.carrier.value).toBe("Jackson");
  });

  it("names the owner from the registration, falling back to the extractor's guess only without a roster", () => {
    const joint = readingFromAccount(acct({ category: "taxable", ownerNameHint: "MARK & LAURA HENDRICKS JTWROS" }), FAMILY)!;
    expect(joint.cells.owner).toMatchObject({ value: "Joint", confidence: 0.9 });
    const guessOnly = readingFromAccount(acct({ category: "taxable", owner: "spouse" }), FAMILY)!;
    expect(guessOnly.cells.owner).toBeUndefined();
    const noRoster = readingFromAccount(acct({ category: "taxable", owner: "spouse" }), [])!;
    expect(noRoster.cells.owner).toMatchObject({ value: "Co-client", confidence: 0.6 });
  });

  it("never offers Joint for a retirement account", () => {
    const r = readingFromAccount(acct({ category: "retirement", subType: "roth_ira", ownerNameHint: "MARK & LAURA" }), FAMILY)!;
    expect(r.cells.owner).toBeUndefined();
  });
});

describe("readingFromLiability", () => {
  it("turns rates into whole percents, splits escrow off P&I, and keeps dates as month/year", () => {
    const row: Annotated<ExtractedLiability> = {
      name: "Chase Mortgage",
      balance: 212000,
      interestRate: 0.0325,
      monthlyPayment: 1650,
      totalPayment: 2350,
      balanceAsOfDate: "2026-09-01",
      maturityDate: "2045-05-01",
      startYear: 2015,
      endYear: 2045,
      propertyAddress: "1450 Aspen Ridge Dr",
      __provenance: { sourceFileId: "f2", section: "liabilities" },
    };
    const r = readingFromLiability(row);
    expect(r.sectionId).toBe("liab");
    expect(r.fileId).toBe("f2");
    expect(r.statementDate).toBe("2026-09-01");
    expect(r.cells.interestRate.value).toBe(3.25);
    expect(r.cells.monthlyPI.value).toBe(1650);
    expect(r.cells.monthlyEscrow.value).toBe(700);
    expect(r.cells.balanceAsOf.value).toBe("2026-09");
    expect(r.cells.matures.value).toBe("2045-05");
    expect(r.cells.termYears.value).toBe(30);
    expect(r.cells.type).toMatchObject({ value: "Mortgage", confidence: 0.6 });
    expect(r.cells.propertyName.value).toBe("1450 Aspen Ridge Dr");
  });
});

describe("readingFromLiability — the lender", () => {
  const loan = (fileId: string, row: Partial<ExtractedLiability>): Annotated<ExtractedLiability> => ({
    name: "Mortgage",
    __provenance: { sourceFileId: fileId, section: "liabilities" },
    ...row,
  });

  it("names a loan by its lender, once", () => {
    expect(readingFromLiability(loan("f1", { lender: "Wells Fargo" })).cells.loanName.value).toBe("Mortgage · Wells Fargo");
    expect(readingFromLiability(loan("f1", { name: "Chase Mortgage", lender: "Chase" })).cells.loanName.value).toBe("Chase Mortgage");
    expect(readingFromLiability(loan("f1", {})).cells.loanName.value).toBe("Mortgage");
  });

  it("keeps two lenders' mortgages as two rows, and the same mortgage read again as one", () => {
    const primary = readingFromLiability(loan("s1", { lender: "Wells Fargo", balance: 412000, balanceAsOfDate: "2026-09-01" }));
    const rental = readingFromLiability(
      loan("s2", { lender: "Rocket Mortgage", balance: 238000, balanceAsOfDate: "2026-09-01", propertyAddress: "88 Rental Ln" }),
    );
    let n = 0;
    const ctx = { now: "2026-10-12T12:00:00.000Z", newId: () => `id-${++n}` };
    const { state } = mergeReadings(emptyFactFinderState(), [primary, rental], ctx);
    expect(state.sections.liab.map((r) => r.cells.balance.value)).toEqual([412000, 238000]);
    expect(mergeReadings(state, [primary, rental], ctx).state).toBe(state);
  });

  it("folds two loans from the same lender with no property into one row across statements (no loan number to tell them apart)", () => {
    const car = readingFromLiability(loan("s1", { name: "Auto Loan", lender: "Ally", balance: 18000 }));
    const truck = readingFromLiability(loan("s2", { name: "Auto Loan", lender: "Ally", balance: 9000 }));
    let n = 0;
    const { state } = mergeReadings(emptyFactFinderState(), [car, truck], { now: "2026-10-12T12:00:00.000Z", newId: () => `id-${++n}` });
    expect(state.sections.liab).toHaveLength(1);
  });
});

describe("readingsFromStatements", () => {
  it("marks rollup totals for the Removed tray", () => {
    const readings = readingsFromStatements({
      accounts: [acct({ name: "IRA", category: "retirement" })],
      excluded: [{ row: acct({ name: "Total Accounts", category: "taxable" }), reason: "Repeats the accounts above" }],
      liabilities: [],
      lifePolicies: [],
      family: FAMILY,
    });
    expect(readings.map((r) => [r.cells.accountName?.value, r.exclude?.reason])).toEqual([
      ["IRA", undefined],
      ["Total Accounts", "Repeats the accounts above"],
    ]);
  });
});

describe("readingsFromStatements — life policies", () => {
  const policy = (row: Partial<ExtractedLifePolicy>): Annotated<ExtractedLifePolicy> => ({
    accountName: "Brighthouse Whole Life",
    policyType: "whole",
    insuredPerson: "spouse",
    faceValue: 3000000,
    __provenance: { sourceFileId: "f1", section: "lifePolicies", pageRange: [4, 4] },
    ...row,
  });
  const read = (lifePolicies: Annotated<ExtractedLifePolicy>[], accounts: Annotated<ExtractedAccount>[] = []) =>
    readingsFromStatements({ accounts, excluded: [], liabilities: [], lifePolicies, family: FAMILY });
  const values = (r: { cells: Record<string, { value: unknown }> }) =>
    Object.fromEntries(Object.entries(r.cells).map(([k, c]) => [k, c.value]));

  it("reads a statement's policy into Life Insurance, keeping only the policy number's last 4", () => {
    const [whole, term] = read([
      policy({ carrier: "Brighthouse", policyNumberLast4: "x0013", cashValue: 588000, costBasis: 400000, premiumAmount: 12000, premiumYears: 10 }),
      policy({ accountName: "Term Life", policyType: "term", insuredPerson: "client", faceValue: 1000000, termIssueYear: 2015, termLengthYears: 20 }),
    ]);
    expect(whole.sectionId).toBe("life");
    expect(values(whole)).toEqual({
      policyName: "Brighthouse Whole Life", carrier: "Brighthouse", policyType: "Whole life", insured: "Co-client",
      deathBenefit: 3000000, cashValue: 588000, costBasis: 400000, annualPremium: 12000, premiumPaymentYears: 10,
      policyNumber: "0013",
    });
    expect(whole.cells.deathBenefit).toEqual({ value: 3000000, confidence: 0.9, source: { fileId: "f1", page: 4 } });
    expect(whole.cells.insured.confidence).toBe(0.6);
    expect(values(term)).toMatchObject({ policyType: "Term", insured: "Client", termIssueYear: 2015, termLengthYears: 20 });
  });

  it("keys a life insurance account by its last 4, so it fills the policy the fact finder already has", () => {
    let n = 0;
    const ctx = { now: "2026-10-12T12:00:00.000Z", newId: () => `id-${++n}` };
    const fromForm = mergeReadings(
      emptyFactFinderState(),
      [{ sectionId: "life", fileId: "form", cells: { policyName: { value: "Whole Life", confidence: 0.9, source: { fileId: "form" } }, policyNumber: { value: "NM-55820013", confidence: 0.9, source: { fileId: "form" } } } }],
      ctx,
    ).state;
    const account = acct({ name: "NWM Whole Life", category: "life_insurance", subType: "whole_life", accountNumberLast4: "0013", value: 52000 });
    expect(readingFromAccount(account, FAMILY)!.cells.policyNumber.value).toBe("0013");

    const { state } = mergeReadings(fromForm, read([], [account]), ctx);
    expect(state.sections.life).toHaveLength(1);
    expect(state.sections.life[0].cells.cashValue.value).toBe(52000);
  });

  it("re-merging the same statement adds nothing the second time, with or without a policy number", () => {
    const readings = read(
      [policy({ carrier: "Brighthouse", policyNumberLast4: "7781" }), policy({ accountName: "Term Life", policyType: "term", insuredPerson: "client", faceValue: 1000000 })],
      [acct({ name: "NWM Whole Life", category: "life_insurance", subType: "whole_life", accountNumberLast4: "0013", value: 52000 })],
    );
    let n = 0;
    const ctx = { now: "2026-10-12T12:00:00.000Z", newId: () => `id-${++n}` };
    const once = mergeReadings(emptyFactFinderState(), readings, ctx).state;
    expect(once.sections.life).toHaveLength(3);
    expect(mergeReadings(once, readings, ctx).state).toBe(once);
  });
});
