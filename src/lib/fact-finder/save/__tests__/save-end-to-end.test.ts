// src/lib/fact-finder/save/__tests__/save-end-to-end.test.ts
//
// Live dev database: the save end to end (Plan 4, Task 20), for a household the
// fact finder builds — a fact finder reviewed against the live plan (no AI
// step) and stored as the review route stores it, then saved through every
// real save writer: every page's Creates and every reference made inside one
// save; a Create left unticked; a writer failing partway; saving twice.
// Everything lives under a firm id no other suite uses.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: "user_test_ff_save", orgId: "firm_test_ff_save_e2e", orgRole: "org:admin" }),
}));

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, auditLog, clientImports, incomes } from "@/db/schema";
import { SAVE_CLOSED_MESSAGE, SAVE_FAILED_MESSAGE } from "../../api-types";
import { defaultTicks, type ChangeSet, type ChangeTicks, type TargetKind } from "../../change-set";
import { loadFactFinder, writeFactFinder, type FactFinderScope } from "../../persist";
import { buildChangeSet } from "../../placement/build";
import { rowOf, stateWith } from "../../placement/__tests__/fixtures";
import { loadRecordBook } from "../../records/book";
import type { FactFinderState, FFRow } from "../../types";
import { saveChangeSet, type SaveDeps } from "../save";
import type { SaveWriter } from "../types";
import { SAVE_WRITERS } from "../writers";
import { dropSaveFirm, SAVE_ACTOR, seedSaveClient, type SaveSeed } from "./harness";

const FIRM = "firm_test_ff_save_e2e";
const HAS_DB = !!process.env.DATABASE_URL;
const d = HAS_DB ? describe : describe.skip;
const NOW = new Date("2026-10-15T12:00:00Z");

interface Reviewed {
  seed: SaveSeed;
  scope: FactFinderScope;
  changeSet: ChangeSet;
  ticks: ChangeTicks;
}

/** `state` on a new import, reviewed against the client's plan (no AI step) and stored with its change list — as the review route does it. */
async function review(seed: SaveSeed, state: FactFinderState): Promise<Reviewed> {
  const [imp] = await db
    .insert(clientImports)
    .values({ clientId: seed.clientId, orgId: FIRM, mode: "onboarding", createdByUserId: SAVE_ACTOR, payloadJson: { factFinder: state } })
    .returning({ id: clientImports.id });
  const scope = { importId: imp.id, clientId: seed.clientId, firmId: FIRM };
  const built = await buildChangeSet({ state, book: await planOf(seed), now: NOW, runLeftovers: async () => null });
  const written = await writeFactFinder(scope, state.version, { ...state, changeSet: { ...built, builtAtVersion: state.version + 1 } }, { keepChangeSet: true });
  return { seed, scope, changeSet: written!.changeSet!, ticks: defaultTicks(written!.changeSet!) };
}

/** The save as the route calls it, with the real writers; no tickers to price. */
const save = (r: Reviewed, ticks: ChangeTicks = r.ticks, deps: Partial<SaveDeps> = {}) =>
  saveChangeSet(
    { scope: r.scope, actorId: SAVE_ACTOR, changeSetVersion: r.changeSet.builtAtVersion, ticks },
    { resolveHoldings: async () => new Map(), now: () => NOW, ...deps },
  );

const planOf = (seed: SaveSeed) => loadRecordBook(seed.clientId, FIRM, seed.scenarioId);
type Plan = Awaited<ReturnType<typeof planOf>>;

/** The one record of `target` with this label. */
function recordOf(plan: Plan, target: TargetKind, label: string) {
  const found = plan.records[target].filter((r) => r.label === label);
  expect(found, `${target} “${label}”`).toHaveLength(1);
  return found[0];
}

/** A row's cell values, to make a changed copy of it. */
const cellsOf = (row: FFRow) => Object.fromEntries(Object.entries(row.cells).map(([k, c]) => [k, c.value]));

const labelsOf = (plan: Plan, target: TargetKind) => plan.records[target].map((r) => r.label).sort();

/** Every record of `before` is in `after` as it was, except the records the save wrote. */
function expectUnmoved(before: Plan, after: Plan, written: ReadonlySet<string>) {
  for (const [target, records] of Object.entries(before.records)) {
    for (const was of records.filter((r) => !written.has(r.id))) {
      expect(after.records[target as TargetKind].find((r) => r.id === was.id), `${target} “${was.label}”`).toEqual(was);
    }
  }
}

async function auditOf(seed: SaveSeed): Promise<string[]> {
  const rows = await db.select({ action: auditLog.action }).from(auditLog).where(eq(auditLog.clientId, seed.clientId));
  return rows.map((r) => r.action).sort();
}

async function importOf(scope: FactFinderScope) {
  const [row] = await db.select({ status: clientImports.status, committedAt: clientImports.committedAt }).from(clientImports).where(eq(clientImports.id, scope.importId));
  return { ...row, factFinder: await loadFactFinder(scope) };
}

const CLIENT = { ref: "person", role: "client" } as const;
const LAURA = { ref: "person", role: "spouse" } as const;
const JOINT = [{ who: CLIENT, percent: 0.5 }, { who: LAURA, percent: 0.5 }];
const record = (target: TargetKind, id: string) => ({ ref: "record", target, id });

/**
 * Mark (on the plan alone) fills in every page: Laura joins as co-client (her employer, her workplace
 * plan), the household moves to Arizona; a child and a charity; an account of each kind — one the new
 * ILIT owns, a brokerage with positions, Laura's IRA naming Mark and Emma, a 529 for Emma — an RSU grant,
 * a note, a home with its mortgage, a business with its income and expenses; a salary each, Mark's Social
 * Security benefit, rental income; the living amount and its itemized list, a college goal, savings into
 * the new 401(k); a life policy the ILIT owns with an LTC rider on it, a disability policy; the estate
 * attorney, the ILIT and a revocable trust, both wills (two provisions of new accounts, each remaining
 * estate to the other), the will's last update as a plan note, and a gift to the new charity.
 */
function newHousehold(): FactFinderState {
  return stateWith({
    people: [
      rowOf("people:Client", { retirementAge: 62, email: "mark@example.com" }),
      rowOf("people:Co-client", { firstName: "Laura", lastName: "Hendricks", dateOfBirth: "1970-09-30", retirementAge: 63, coveredByWorkplacePlan: "Yes" }),
    ],
    household: [rowOf("household:Household", { filingStatus: "Married filing jointly", stateOfResidence: "AZ", city: "Denver" })],
    family: [rowOf("f1", { firstName: "Emma", lastName: "Hendricks", relationship: "Child", dateOfBirth: "2010-05-01", claimedAsDependent: "Yes" })],
    external: [rowOf("x1", { name: "American Red Cross", kind: "Charity", charityType: "Public charity" })],
    cash: [rowOf("c1", { accountName: "Joint Savings", currentValue: 25000, owner: "Joint", accountType: "Savings" })],
    taxable: [
      rowOf("tx1", { accountName: "ILIT Brokerage", currentValue: 50000, owner: "Trust / entity", ownerEntity: "Hendricks Family ILIT" }),
      rowOf("tx2", { accountName: "Schwab Brokerage", currentValue: 90000, costBasis: 60000, owner: "Joint", custodian: "Schwab" }, {
        holdings: [
          { id: "h1", ticker: "VTI", name: "Vanguard Total Stock Market", shares: 100, price: 250, marketValue: 25000, costBasis: 20000, by: "document" },
          { id: "h2", ticker: null, name: "Muni bond fund", shares: null, price: null, marketValue: 65000, costBasis: 60000, by: "document" },
        ],
      }),
    ],
    retirement: [
      rowOf("r1", { accountName: "Fidelity 401(k)", currentValue: 250000, owner: "Client", accountType: "401(k)", custodian: "Fidelity" }),
      rowOf("r2", { accountName: "Laura's IRA", currentValue: 80000, owner: "Co-client", accountType: "Traditional IRA", primaryBeneficiary: "Mark", contingentBeneficiary: "Emma" }),
    ],
    annuity: [rowOf("an1", { contractName: "Lincoln MYGA", cashValue: 100000, costBasis: 90000, owner: "Client", carrier: "Lincoln", taxTreatment: "Non-qualified", productType: "MYGA" })],
    edu: [rowOf("e1", { accountName: "Emma 529", currentValue: 30000, beneficiary: "Emma", owner: "Client" })],
    equity: [rowOf("eq1", { company: "Acme Corp", ticker: "ACME", grantType: "RSU", grantDate: "2024-03-01", sharesGranted: 400, vestingSchedule: "25% a year over 4 years", owner: "Client" })],
    notes_rec: [rowOf("n1", { borrower: "Loan to Emma", originalAmount: 20000, currentBalance: 15000, balanceAsOf: "2026-09", interestRate: 4, paymentType: "Amortizing", start: "2024-01", termMonths: 60, owner: "Joint" })],
    realestate: [rowOf("re1", { propertyName: "Main home", propertyType: "Primary residence", currentValue: 600000, costBasis: 400000, owner: "Joint", address: "12 Elm St, Denver CO", annualPropertyTax: 4000 })],
    business: [rowOf("b1", { businessName: "Hendricks Design LLC", businessType: "LLC", currentValue: 300000, costBasis: 50000, ownersAndPercent: "Mark 100%", annualIncome: 80000, annualExpense: 20000 })],
    liab: [rowOf("l1", { loanName: "Home mortgage", type: "Mortgage", owner: "Joint", balance: 300000, interestRate: 6, loanStart: "2020-06", termYears: 30, propertyName: "Main home" })],
    salary: [rowOf("salary:Client", { employer: "Acme Corp", annualSalary: 150000 }), rowOf("salary:Co-client", { employer: "Denver Schools", annualSalary: 90000 })],
    ss: [rowOf("ss:Client", { benefitSource: "Benefit at full retirement age", monthlyBenefit: 3200 })],
    income: [rowOf("i1", { incomeName: "Rental income", type: "Other", owner: "Joint", annualAmount: 12000 })],
    living: [rowOf("living:Current", { annualAmount: 120000 })],
    living_items: [rowOf("li1", { item: "Groceries", amount: 1000, frequency: "Monthly" }), rowOf("li2", { item: "Travel", amount: 12000, frequency: "Annually" })],
    expenses: [rowOf("ex1", { expenseName: "Emma's college", type: "Education", annualAmount: 30000, startYear: 2028, endYear: 2031 })],
    savings: [rowOf("s1", { account: "Fidelity 401(k)", contribution: "Fixed $ amount", annualAmount: 20000 })],
    life: [
      rowOf("life1", {
        policyName: "NWM Whole Life", carrier: "Northwestern Mutual", policyType: "Whole life", insured: "Client", owner: "Trust / entity",
        ownerEntity: "Hendricks Family ILIT", deathBenefit: 1000000, cashValue: 50000, annualPremium: 12000, policyNumber: "NW-4321",
        primaryBeneficiary: "Hendricks Family ILIT",
      }),
    ],
    disability: [rowOf("di1", { policyName: "Acme LTD", carrier: "Unum", whoIsCovered: "Client", coveredEarnings: "Salary", longTerm: "Yes", ltdWaitingDays: 90, ltdBenefitPercent: 60, benefitsRun: "To age", benefitsRunValue: 65 })],
    ltc: [rowOf("ltc1", { policyName: "NWM LTC Rider", whoIsCovered: "Client", policyType: "Rider on a life policy", riderLifePolicy: "NWM Whole Life", issueYear: 2018, benefitAmount: 3000, benefitPer: "Month" })],
    estate_docs: [rowOf("estate_docs:Client", { will: true, lastUpdatedYear: 2019, estateAttorney: "Jane Smith, Smith & Co" })],
    trusts: [
      rowOf("t1", { trustName: "Hendricks Family ILIT", trustType: "ILIT", grantor: "Client", trustee: "Laura Hendricks", remainderBeneficiaries: "Emma" }),
      rowOf("t2", { trustName: "Hendricks Family Trust", trustType: "Revocable living trust" }),
    ],
    bequests: [
      rowOf("bq1", { willOf: "Client", gift: "Specific asset", asset: "Schwab Brokerage", recipients: "Emma", condition: "If co-client predeceases" }),
      rowOf("bq2", { willOf: "Client", gift: "Specific asset", asset: "Joint Savings", recipients: "American Red Cross" }),
      rowOf("bq3", { willOf: "Client", gift: "Remaining estate", recipients: "Laura" }),
      rowOf("bq4", { willOf: "Co-client", gift: "Remaining estate", recipients: "Mark" }),
    ],
    gifts: [rowOf("g1", { year: 2022, from: "Client", recipient: "American Red Cross", given: "Cash", amount: 20000 })],
  });
}

/**
 * Mark alone on the plan; the fact finder adds Laura, Emma, two cash accounts (one joint), Laura's salary,
 * and an ILIT that owns a brokerage account and a life policy with an LTC rider on it.
 */
function withAnILIT(): FactFinderState {
  return stateWith({
    people: [
      rowOf("people:Client", { retirementAge: 62 }),
      rowOf("people:Co-client", { firstName: "Laura", lastName: "Hendricks", dateOfBirth: "1970-09-30" }),
    ],
    family: [rowOf("f1", { firstName: "Emma", lastName: "Hendricks", relationship: "Child" })],
    cash: [
      rowOf("c1", { accountName: "Emergency Fund", currentValue: 20000, owner: "Client" }),
      rowOf("c2", { accountName: "Joint Savings", currentValue: 25000, owner: "Joint" }),
    ],
    taxable: [rowOf("tx1", { accountName: "ILIT Brokerage", currentValue: 50000, owner: "Trust / entity", ownerEntity: "Hendricks Family ILIT" })],
    salary: [rowOf("salary:Co-client", { annualSalary: 90000 })],
    life: [rowOf("life1", { policyName: "NWM Whole Life", policyType: "Whole life", insured: "Client", owner: "Trust / entity", ownerEntity: "Hendricks Family ILIT", deathBenefit: 1000000, primaryBeneficiary: "Emma" })],
    ltc: [rowOf("ltc1", { policyName: "NWM LTC Rider", whoIsCovered: "Client", policyType: "Rider on a life policy", riderLifePolicy: "NWM Whole Life", issueYear: 2018, benefitAmount: 3000, benefitPer: "Month" })],
    trusts: [rowOf("t1", { trustName: "Hendricks Family ILIT", trustType: "ILIT", grantor: "Client", remainderBeneficiaries: "Emma" })],
  });
}

/** `writer` for real, except that its `nth` Create — once its rows are written — throws as a dropped connection would. */
function failingOnCreate(writer: SaveWriter, nth: number): SaveWriter {
  let creates = 0;
  return {
    async create(ctx, input) {
      const id = await writer.create(ctx, input);
      if (++creates === nth) throw new Error("connection reset");
      return id;
    },
    update: writer.update,
  };
}

/** Every line of newHousehold's change list, in the order the save writes them (D8). */
const SAVE_ORDER = [
  "people:Client/client_household", "people:Co-client/client_household", "household:Household/client_household",
  "salary:Client/client_household", "salary:Co-client/client_household",
  "people:Co-client/plan_settings_tax_rates", "household:Household/plan_settings_tax_rates",
  "f1/family_member", "x1/external_beneficiary", "estate_docs:Client/related_party", "t1/entity", "b1/business_account",
  "c1/account", "tx1/account", "tx2/account", "r1/account", "r2/account", "an1/account", "e1/account", "re1/account",
  "an1/annuity_contract", "eq1/stock_option_account", "eq1/stock_option_grant", "n1/note_receivable", "t2/revocable_trust", "l1/liability",
  "b1/income", "salary:Client/income", "salary:Co-client/income", "ss:Client/income", "i1/income",
  "b1/expense", "living:Current/expense", "li1/expense", "ex1/expense", "s1/savings_rule",
  "life1/life_insurance_policy", "di1/disability_policy", "ltc1/ltc_policy",
  "r2/account_beneficiary_designation", "life1/life_insurance_policy_beneficiary", "t1/trust_beneficiary_designation",
  "estate_docs:Client/will", "estate_docs:Co-client/will", "bq1/will_bequest", "bq2/will_bequest",
  "bq3/will_residuary_recipient", "bq4/will_residuary_recipient", "g1/gift", "estate_docs:Client/plan_observation",
];

/**
 * The audit rows newHousehold's save leaves: each core's own, as Details leaves them (a client.update per
 * household line that changes the profile, and one more from the tax settings' coverage; a will.update per
 * provision and remaining estate; none for a charity or a beneficiary set), and the save's.
 */
const NEW_HOUSEHOLD_AUDIT = [
  "account.annuity.update", ...Array(9).fill("account.create"), "account.stock_options.create", "account.stock_options.grant.create",
  ...Array(4).fill("client.update"), "disability_policy.create", "entity.create", ...Array(2).fill("expense.create"),
  ...Array(2).fill("expense.update"), "family_member.create", "family_member.update", "gift.create", "import.fact_finder_saved",
  ...Array(4).fill("income.create"), "income.update", "insurance_policy.create", "liability.create", "ltc_policy.create",
  "note_receivable.create", "plan_observation.create", ...Array(2).fill("plan_settings.update"), "related_party.create",
  "revocable_trust.create", "savings_rule.create", ...Array(2).fill("will.create"), ...Array(4).fill("will.update"),
];

d("the save end to end — a new household (live DB)", () => {
  // Clearing a firm of 50-line households can outlast the default hook timeout on a cold dev branch.
  beforeAll(async () => dropSaveFirm(FIRM), 120_000);
  afterAll(async () => dropSaveFirm(FIRM), 120_000);

  it("every page's Creates are saved, each reference made inside the save resolved to the record it created, and nothing else on the plan moves", async () => {
    const seed = await seedSaveClient(FIRM);
    const before = await planOf(seed);
    const r = await review(seed, newHousehold());
    expect(r.changeSet.lines.filter((l) => l.blocked)).toEqual([]);

    const outcome = await save(r);
    expect(outcome.ok).toBe(true);
    const imp = await importOf(r.scope);
    expect(imp.status).toBe("committed");
    expect(imp.factFinder?.closed?.saved.map((s) => s.lineId)).toEqual(SAVE_ORDER);
    expect(imp.factFinder?.closed?.leftOut).toEqual([]);
    expect(await auditOf(seed)).toEqual(NEW_HOUSEHOLD_AUDIT);
    // The household lines' client.update rows each diff the client from where the line before left it, so no field shows twice
    // (the tax settings' coverage row carries its fields, not a diff).
    const clientUpdates = await db.select({ metadata: auditLog.metadata }).from(auditLog).where(and(eq(auditLog.clientId, seed.clientId), eq(auditLog.action, "client.update")));
    const changed = clientUpdates.flatMap((row) => ((row.metadata as { changes?: { field: string }[] }).changes ?? []).map((c) => c.field)).sort();
    expect(changed).toEqual([...new Set(changed)]);
    expect(changed).toContain("retirementAge");

    const plan = await planOf(seed);
    const rec = (target: TargetKind, label: string) => recordOf(plan, target, label);
    const emma = rec("family_member", "Emma Hendricks").id;
    const redCross = rec("external_beneficiary", "American Red Cross").id;
    const ilit = rec("entity", "Hendricks Family ILIT").id;
    const home = rec("account", "Main home").id;
    const fidelity = rec("account", "Fidelity 401(k)").id;
    const policy = rec("life_insurance_policy", "NWM Whole Life ··4321").id;
    const business = rec("business_account", "Hendricks Design LLC").id;

    // The household: Laura added (her contact, family member and employer), Mark's retirement and the household's details.
    expect(rec("client_household", "Mark Hendricks").values).toMatchObject({
      retirementAge: 62, email: "mark@example.com", employer: "Acme Corp", filingStatus: "married_joint", city: "Denver",
      spouseName: "Laura", spouseLastName: "Hendricks", spouseDob: "1970-09-30", spouseRetirementAge: 63, spouseEmployer: "Denver Schools",
    });
    expect(plan.people.spouse).not.toBeNull();
    expect(rec("plan_settings_tax_rates", "Tax settings").values).toEqual({ coveredByWorkplacePlan: "auto", spouseCoveredByWorkplacePlan: "yes", residenceState: "AZ" });
    expect(rec("family_member", "Emma Hendricks").values).toMatchObject({ relationship: "child", dateOfBirth: "2010-05-01", claimedAsDependent: "yes" });
    expect(rec("external_beneficiary", "American Red Cross").values).toMatchObject({ kind: "charity", charityType: "public" });

    // Accounts — owned by the co-client added, by the trust created, in the same save.
    expect(rec("account", "Joint Savings").values).toMatchObject({ value: 25000, subType: "savings", owners: JOINT });
    expect(rec("account", "ILIT Brokerage").values).toMatchObject({ value: 50000, owners: [{ who: record("entity", ilit), percent: 1 }] });
    expect(rec("account", "Hendricks Family ILIT — Cash").values).toMatchObject({ owners: [{ who: record("entity", ilit), percent: 1 }] });
    // Its positions written, their cost never its basis; the roll-up the save queued ran once it committed.
    expect(rec("account", "Schwab Brokerage").values).toMatchObject({
      value: 90000, basis: 60000, custodian: "Schwab", owners: JOINT,
      holdings: [
        { ticker: "VTI", name: "Vanguard Total Stock Market", shares: 100, price: 250, marketValue: 25000, costBasis: 20000 },
        { ticker: null, name: "Muni bond fund", shares: null, price: null, marketValue: 65000, costBasis: 60000 },
      ],
    });
    const [schwab] = await db.select({ derive: accounts.deriveFromHoldings, growthSource: accounts.growthSource }).from(accounts).where(eq(accounts.id, rec("account", "Schwab Brokerage").id));
    expect(schwab).toEqual({ derive: true, growthSource: "asset_mix" });
    expect(rec("account", "Fidelity 401(k)").values).toMatchObject({ value: 250000, subType: "401k", owners: [{ who: CLIENT, percent: 1 }] });
    expect(rec("account", "Laura's IRA").values).toMatchObject({ subType: "traditional_ira", owners: [{ who: LAURA, percent: 1 }] });
    expect(rec("account", "Emma 529").values).toMatchObject({ value: 30000, beneficiary: record("family_member", emma), grantor: CLIENT });
    expect(rec("account", "Main home").values).toMatchObject({ value: 600000, propertyAddress: "12 Elm St, Denver CO", annualPropertyTax: 4000, owners: JOINT });
    expect(rec("account", "Lincoln MYGA").values).toMatchObject({ value: 100000, subType: "non_qualified", owners: [{ who: CLIENT, percent: 1 }] });
    expect(rec("annuity_contract", "Lincoln MYGA").values).toMatchObject({ costBasis: 90000, productType: "myga" });
    expect(rec("business_account", "Hendricks Design LLC").values).toMatchObject({ value: 300000, basis: 50000, owners: [{ who: CLIENT, percent: 1 }] });
    expect(rec("account", "Hendricks Design LLC — Cash").facts).toMatchObject({ parentAccountId: business });

    // A new 401(k) gets the household's default beneficiaries as the save left it — Laura, then Emma; Laura's IRA, the fact finder's.
    expect(rec("account_beneficiary_designation", "Fidelity 401(k)").values.beneficiaries).toEqual([
      { tier: "primary", who: LAURA, percentage: 100 },
      { tier: "contingent", who: record("family_member", emma), percentage: 100 },
    ]);
    expect(rec("account_beneficiary_designation", "Laura's IRA").values.beneficiaries).toEqual([
      { tier: "primary", who: CLIENT, percentage: 100 },
      { tier: "contingent", who: record("family_member", emma), percentage: 100 },
    ]);

    const grant = rec("stock_option_grant", "Acme Corp RSU 2024-03-01");
    expect(grant.facts).toEqual({ accountId: rec("stock_option_account", "Acme Corp").id });
    expect(grant.values.tranches).toEqual(["2025", "2026", "2027", "2028"].map((y) => ({ vestDate: `${y}-03-01`, shares: 100 })));
    expect(rec("note_receivable", "Loan to Emma").values).toMatchObject({ asOfBalance: 15000, interestRate: 0.04, owners: JOINT });

    // The mortgage on the home created in the save, owned as the fact finder says.
    expect(rec("liability", "Home mortgage").values).toMatchObject({
      liabilityType: "mortgage", balance: 300000, interestRate: 0.06, start: "2020-06", termMonths: 360, owners: JOINT, linkedPropertyId: record("account", home),
    });

    // Incomes: the business's own, a salary each ending the year before each retirement the household lines set.
    expect(rec("income", "Hendricks Design LLC income").facts).toEqual({ type: "business", owner: "client", ownerAccountId: business });
    expect(rec("income", "Rental income").values).toMatchObject({ owner: "joint", annualAmount: 12000 });
    const salaries = await db.select({ owner: incomes.owner, endYear: incomes.endYear }).from(incomes).where(and(eq(incomes.clientId, seed.clientId), eq(incomes.type, "salary")));
    expect(salaries.sort((a, b) => a.owner.localeCompare(b.owner))).toEqual([{ owner: "client", endYear: 2029 }, { owner: "spouse", endYear: 2032 }]);
    // As in Details, adding the co-client makes no Social Security for her.
    expect(labelsOf(plan, "income")).toEqual(["Hendricks Design LLC income", "Rental income", "Salary — Acme Corp", "Salary — Denver Schools", "Social Security — Mark"]);

    expect(rec("income", "Social Security — Mark").values).toMatchObject({ ssBenefitMode: "pia_at_fra", piaMonthly: 3200 });
    expect(rec("expense", "Hendricks Design LLC expenses").facts).toEqual({ type: "other", livingSlot: null, ownerAccountId: business });
    // The typed living amount, then its itemized list: the list's total is what stays.
    expect(rec("expense", "Current Living Expenses").values).toMatchObject({
      annualAmount: 24000, livingItems: [{ name: "Groceries", amount: 1000, frequency: "monthly" }, { name: "Travel", amount: 12000, frequency: "annual" }],
    });
    expect(rec("expense", "Emma's college").values).toMatchObject({ type: "education", annualAmount: 30000, start: 2028, end: 2031 });
    expect(rec("savings_rule", "Fidelity 401(k)").values).toMatchObject({ accountId: record("account", fidelity), annualAmount: 20000 });

    // Insurance: the ILIT owns the policy and receives it; the rider sits on the policy created in the save.
    expect(rec("life_insurance_policy", "NWM Whole Life ··4321").values).toMatchObject({
      carrier: "Northwestern Mutual", policyNumberLast4: "4321", insuredPerson: "client", ownerRef: record("entity", ilit), faceValue: 1000000,
    });
    expect(rec("life_insurance_policy_beneficiary", "NWM Whole Life ··4321").values.beneficiaries).toEqual([{ tier: "primary", who: record("entity", ilit), percentage: 100 }]);
    expect(rec("ltc_policy", "NWM LTC Rider").values).toMatchObject({ kind: "life_rider", insured: "client", lifePolicyAccountId: record("life_insurance_policy", policy), benefitAmount: 3000 });
    // "Short-term coverage?" left blank with no short-term terms: saved without it (the create default would add it).
    expect(rec("disability_policy", "Acme LTD").values).toMatchObject({ insured: "client", hasShortTerm: false, hasLongTerm: true, ltdEliminationDays: 90, ltdBenefitPct: 0.6 });

    // Estate: the trust's remainder to the new child; Mark's will gives the new accounts to Emma and the charity, the rest to Laura; the gift to the new charity.
    expect(rec("entity", "Hendricks Family ILIT").values).toMatchObject({ trustSubType: "ilit", grantor: "client", trustee: "Laura Hendricks" });
    expect(rec("trust_beneficiary_designation", "Hendricks Family ILIT").values.beneficiaries).toEqual([{ tier: "remainder", who: record("family_member", emma), percentage: 100 }]);
    const will = rec("will", "Mark's will").id;
    expect(rec("will_bequest", "Schwab Brokerage")).toMatchObject({
      values: { accountId: record("account", rec("account", "Schwab Brokerage").id), recipients: [{ who: record("family_member", emma), percentage: 100 }], condition: "if_spouse_predeceased" },
      facts: { willId: will },
    });
    expect(rec("will_bequest", "Joint Savings").values).toMatchObject({
      accountId: record("account", rec("account", "Joint Savings").id), recipients: [{ who: record("external_beneficiary", redCross), percentage: 100 }],
    });
    expect(rec("will_residuary_recipient", "Mark's will — remaining estate").values.recipients).toEqual([{ who: LAURA, percentage: 100 }]);
    expect(rec("will_residuary_recipient", "Laura's will — remaining estate").values.recipients).toEqual([{ who: CLIENT, percentage: 100 }]);
    expect(labelsOf(plan, "revocable_trust")).toEqual(["Hendricks Family Trust"]);
    expect(rec("related_party", "Jane Smith").values).toMatchObject({ firstName: "Jane", lastName: "Smith", employer: "Smith & Co" });
    expect(rec("plan_observation", "Client's will was last updated in 2019.").values).toEqual({ topic: "estate", body: "Client's will was last updated in 2019." });
    expect(rec("gift", "2022 gift").values).toMatchObject({ year: 2022, grantor: "client", recipient: record("external_beneficiary", redCross), amount: 20000 });

    // Nothing on the plan before the save moved, except the four records its Updates name.
    expectUnmoved(
      before,
      plan,
      new Set([
        seed.clientId,
        recordOf(before, "plan_settings_tax_rates", "Tax settings").id,
        recordOf(before, "expense", "Current Living Expenses").id,
        recordOf(before, "income", "Social Security — Mark").id,
      ]),
    );
  });

  it("a Create left unticked leaves out every line that needs it, and an unticked co-client first name every line naming her — each with its reason; the rest saved", async () => {
    const seed = await seedSaveClient(FIRM);
    const before = await planOf(seed);
    const r = await review(seed, withAnILIT());
    const ticks = {
      ...r.ticks,
      "people:Co-client/client_household": { ...r.ticks["people:Co-client/client_household"], spouseName: false },
      "t1/entity": Object.fromEntries(Object.keys(r.ticks["t1/entity"]).map((key) => [key, false])),
    };
    expect((await save(r, ticks)).ok).toBe(true);

    const coClient = "Needs the co-client, who isn't being saved.";
    const ilit = "Needs “Hendricks Family ILIT”, which isn't being saved.";
    const policy = "Needs “NWM Whole Life”, which isn't being saved.";
    const { closed } = (await importOf(r.scope)).factFinder!;
    expect(closed?.saved.map((s) => s.lineId)).toEqual(["people:Client/client_household", "f1/family_member", "c1/account"]);
    expect(closed?.leftOut.map((l) => [l.lineId, l.reason])).toEqual([
      ["people:Co-client/client_household", coClient],
      ["c2/account", coClient],
      ["tx1/account", ilit],
      ["salary:Co-client/income", coClient],
      ["life1/life_insurance_policy", ilit],
      ["life1/life_insurance_policy_beneficiary", policy],
      ["ltc1/ltc_policy", policy],
      ["t1/entity", "Nothing ticked."],
      ["t1/trust_beneficiary_designation", ilit],
    ]);

    const plan = await planOf(seed);
    expect(recordOf(plan, "client_household", "Mark Hendricks").values).toMatchObject({ retirementAge: 62, spouseName: null, spouseDob: null });
    expect(plan.people.spouse).toBeNull();
    expect(labelsOf(plan, "family_member")).toEqual(["Emma Hendricks"]);
    expect(labelsOf(plan, "account")).toEqual(["Emergency Fund", "Household Cash"]);
    expect(recordOf(plan, "account", "Emergency Fund").values).toMatchObject({ value: 20000, owners: [{ who: CLIENT, percent: 1 }] });
    for (const target of ["entity", "life_insurance_policy", "ltc_policy"] as const) expect(plan.records[target], target).toEqual([]);
    // Every record on the plan before the save as it was, but the client its household line updated.
    expectUnmoved(before, plan, new Set([seed.clientId]));
    expect(await auditOf(seed)).toEqual(["account.create", "client.update", "family_member.create", "import.fact_finder_saved"]);
  });

  it("a real writer failing partway (its second account, rows already written) → 500 naming the line; the plan exactly as before, no audit row, the import open — and it still saves", async () => {
    const seed = await seedSaveClient(FIRM);
    const before = await planOf(seed);
    const r = await review(seed, newHousehold());
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const outcome = await save(r, r.ticks, { writers: { ...SAVE_WRITERS, account: failingOnCreate(SAVE_WRITERS.account, 2) } });
      expect(outcome).toEqual({ ok: false, status: 500, error: SAVE_FAILED_MESSAGE, lineId: "tx1/account" });
      expect(logged).toHaveBeenCalledWith(expect.stringContaining("tx1/account"), expect.anything());
    } finally {
      logged.mockRestore();
    }

    // Every line before it had written its rows — the household and Laura, the child, the charity, the trust, the business, the first account.
    expect(await planOf(seed)).toEqual(before);
    expect(await auditOf(seed)).toEqual([]);
    const imp = await importOf(r.scope);
    expect(imp).toMatchObject({ status: "draft", committedAt: null });
    expect(imp.factFinder?.closed).toBeUndefined();
    expect(imp.factFinder?.changeSet).toEqual(r.changeSet);

    // Nothing of the failed save lingers: the same ticks save the whole list once.
    expect((await save(r)).ok).toBe(true);
    expect(await auditOf(seed)).toEqual(NEW_HOUSEHOLD_AUDIT);
  });

  it("the last line failing (the plan note, after every other line's real writer) → 500 naming it; the plan exactly as before, no audit row, the import open", async () => {
    const seed = await seedSaveClient(FIRM);
    const before = await planOf(seed);
    const r = await review(seed, newHousehold());
    expect(SAVE_ORDER.at(-1)).toBe("estate_docs:Client/plan_observation");
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const outcome = await save(r, r.ticks, { writers: { ...SAVE_WRITERS, plan_observation: failingOnCreate(SAVE_WRITERS.plan_observation, 1) } });
      expect(outcome).toEqual({ ok: false, status: 500, error: SAVE_FAILED_MESSAGE, lineId: "estate_docs:Client/plan_observation" });
    } finally {
      logged.mockRestore();
    }

    // All 49 lines before it had written their rows and audit rows — the wills, provisions, remaining estates and gift last.
    expect(await planOf(seed)).toEqual(before);
    expect(await auditOf(seed)).toEqual([]);
    const imp = await importOf(r.scope);
    expect(imp).toMatchObject({ status: "draft", committedAt: null });
    expect(imp.factFinder?.closed).toBeUndefined();
    expect(imp.factFinder?.changeSet).toEqual(r.changeSet);
  });

  it("a line the real write path refuses (an LTC rider on a policy insuring someone else) → 422 naming it; nothing written", async () => {
    const seed = await seedSaveClient(FIRM);
    const before = await planOf(seed);
    const state = newHousehold();
    const r = await review(seed, { ...state, sections: { ...state.sections, ltc: [rowOf("ltc1", { ...cellsOf(state.sections.ltc[0]), whoIsCovered: "Co-client" })] } });
    expect(r.changeSet.lines.find((l) => l.id === "ltc1/ltc_policy")?.blocked).toBeUndefined();

    expect(await save(r)).toEqual({
      ok: false, status: 422, error: "NWM LTC Rider: The life policy must insure the same person as the rider.", lineId: "ltc1/ltc_policy",
    });
    expect(await planOf(seed)).toEqual(before);
    expect(await auditOf(seed)).toEqual([]);
    expect((await importOf(r.scope)).factFinder?.closed).toBeUndefined();
  });

  it("saving twice at once (a double click), then again (a retry): one save lands, the others are refused as already saved — nothing written twice", async () => {
    const seed = await seedSaveClient(FIRM);
    const r = await review(seed, newHousehold());
    const outcomes = await Promise.all([save(r), save(r)]);
    expect(outcomes.filter((o) => o.ok)).toHaveLength(1);
    const { factFinder } = await importOf(r.scope);
    expect(outcomes.find((o) => !o.ok)).toEqual({ ok: false, status: 409, error: SAVE_CLOSED_MESSAGE, factFinder });

    const plan = await planOf(seed);
    expect(await save(r)).toEqual({ ok: false, status: 409, error: SAVE_CLOSED_MESSAGE, factFinder });
    expect(await planOf(seed)).toEqual(plan);
    expect(await auditOf(seed)).toEqual(NEW_HOUSEHOLD_AUDIT);
    expect(labelsOf(plan, "account")).toEqual([
      "Emma 529", "Fidelity 401(k)", "Hendricks Design LLC — Cash", "Hendricks Family ILIT — Cash", "Household Cash", "ILIT Brokerage",
      "Joint Savings", "Laura's IRA", "Lincoln MYGA", "Main home", "Schwab Brokerage",
    ]);
  });
});
