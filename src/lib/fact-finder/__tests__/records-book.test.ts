// src/lib/fact-finder/__tests__/records-book.test.ts
//
// Live dev database: the record book reads one client's base case and nothing
// else. Two clients share the firm, and the first client has a second scenario;
// neither one's rows may reach the book. Everything lives under a firm id no
// other suite uses.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  beneficiaryDesignations,
  clients,
  crmHouseholdContacts,
  crmHouseholds,
  disabilityPolicies,
  entities,
  expenses,
  externalBeneficiaries,
  familyMembers,
  gifts,
  incomes,
  liabilities,
  ltcPolicies,
  planObservations,
  planSettings,
  revocableTrusts,
  savingsRules,
  scenarios,
  willBequestRecipients,
  willBequests,
  willResiduaryRecipients,
  wills,
} from "@/db/schema";
import { createTestClientWithScenario } from "@/test/factories";
import { TARGET_KINDS } from "../change-set";
import type { BookRecord, RecordBook } from "../placement/types";
import { loadRecordBook } from "../records/book";

const FIRM = "firm_test_fact_finder_book";
const HAS_DB = !!process.env.DATABASE_URL;

let clientId: string;
let scenarioId: string;
let whatIfId: string;
/** Every row seeded for the other client and for the what-if scenario. */
const otherIds: string[] = [];
const whatIfIds: string[] = [];
const ids: Record<string, string> = {};

async function dropFirm() {
  const rows = await db.select({ id: clients.id, householdId: clients.crmHouseholdId }).from(clients).where(eq(clients.firmId, FIRM));
  if (rows.length === 0) return;
  const clientIds = rows.map((r) => r.id);
  await db.delete(gifts).where(inArray(gifts.clientId, clientIds));
  await db.delete(clients).where(inArray(clients.id, clientIds));
  await db.delete(crmHouseholds).where(inArray(crmHouseholds.id, rows.map((r) => r.householdId)));
}

async function householdOf(id: string): Promise<string> {
  const [row] = await db.select({ householdId: clients.crmHouseholdId }).from(clients).where(eq(clients.id, id));
  return row.householdId;
}

async function seedClient() {
  const householdId = await householdOf(clientId);
  await db
    .update(crmHouseholdContacts)
    .set({ firstName: "Mark", lastName: "Hendricks", dateOfBirth: "1968-04-12", email: "mark@example.com", city: "Denver", state: "CO", employer: "Acme Corp" })
    .where(and(eq(crmHouseholdContacts.householdId, householdId), eq(crmHouseholdContacts.role, "primary")));
  await db.insert(crmHouseholdContacts).values([
    { householdId, role: "spouse", firstName: "Laura", lastName: "Hendricks", dateOfBirth: "1970-09-30", employer: "Denver Health" },
    { householdId, role: "dependent", firstName: "Emma", lastName: "Hendricks" },
  ]);
  const [jane] = await db
    .insert(crmHouseholdContacts)
    .values({ householdId, role: "other", firstName: "Jane", lastName: "Smith", employer: "Smith & Co", relationshipLabel: "Estate attorney", notes: "Drafted both wills." })
    .returning({ id: crmHouseholdContacts.id });
  ids.jane = jane.id;
  await db.update(clients).set({ retirementMonth: 6, spouseRetirementAge: 63, spouseLifeExpectancy: 95, coveredByWorkplacePlan: "yes" }).where(eq(clients.id, clientId));

  const member = async (values: typeof familyMembers.$inferInsert) =>
    (await db.insert(familyMembers).values(values).returning({ id: familyMembers.id }))[0].id;
  ids.mark = await member({ clientId, firstName: "Mark", lastName: "Hendricks", role: "client", relationship: "other" });
  ids.laura = await member({ clientId, firstName: "Laura", lastName: "Hendricks", role: "spouse", relationship: "other" });
  ids.emma = await member({
    clientId, firstName: "Emma", lastName: "Hendricks", role: "child", relationship: "child",
    dateOfBirth: "2004-05-21", claimedAsDependent: "no", notes: "Starts college in 2026.",
  });
  [{ id: ids.charity }] = await db.insert(externalBeneficiaries).values({ clientId, name: "Denver Rescue Mission" }).returning({ id: externalBeneficiaries.id });

  [{ id: ids.settings }] = await db
    .insert(planSettings)
    .values({ clientId, scenarioId, planStartYear: 2026, planEndYear: 2070, residenceState: "CO" })
    .returning({ id: planSettings.id });
  [{ id: ids.brokerage }] = await db
    .insert(accounts)
    .values({ clientId, scenarioId, name: "Schwab Brokerage", category: "taxable", subType: "brokerage", value: "310000" })
    .returning({ id: accounts.id });
  [{ id: ids.business }] = await db
    .insert(accounts)
    .values({ clientId, scenarioId, name: "Hendricks Design LLC", category: "business", value: "400000" })
    .returning({ id: accounts.id });
  [{ id: ids.visa }] = await db
    .insert(liabilities)
    .values({ clientId, scenarioId, name: "Chase Visa", balance: "4000", startYear: 2024 })
    .returning({ id: liabilities.id });

  const income = async (values: Omit<typeof incomes.$inferInsert, "clientId" | "scenarioId">) =>
    (await db.insert(incomes).values({ clientId, scenarioId, ...values }).returning({ id: incomes.id }))[0].id;
  ids.salary = await income({
    type: "salary", name: "Salary — Acme Corp", owner: "client", annualAmount: "150000", growthRate: "0.0400",
    startYear: 2026, endYear: 2033, endYearRef: "client_retirement", taxType: "earned_income", paymentMonth: 12,
  });
  ids.ss = await income({
    type: "social_security", name: "Social Security — Mark", owner: "client", annualAmount: "0",
    growthSource: "inflation", growthRate: "0.0300", startYear: 2035, endYear: 2063, endYearRef: "client_end",
    ssBenefitMode: "pia_at_fra", piaMonthly: "3200", claimingAgeMode: "years", claimingAge: 67, claimingAgeMonths: 6,
  });
  ids.businessIncome = await income({
    type: "business", name: "Hendricks Design LLC income", owner: "client", annualAmount: "90000",
    startYear: 2026, endYear: 2070, startYearRef: "plan_start", endYearRef: "plan_end", ownerAccountId: ids.business,
  });

  const expense = async (values: Omit<typeof expenses.$inferInsert, "clientId" | "scenarioId">) =>
    (await db.insert(expenses).values({ clientId, scenarioId, ...values }).returning({ id: expenses.id }))[0].id;
  ids.current = await expense({
    type: "living", name: "Current living expenses", isDefault: true, annualAmount: "14400",
    startYear: 2026, endYear: 2033, startYearRef: "plan_start", endYearRef: "client_retirement",
    livingItems: [{ id: "item-1", name: "Groceries", amount: 1200, frequency: "monthly" }],
  });
  ids.retirement = await expense({
    type: "living", name: "Retirement living expenses", isDefault: true, annualAmount: "90000", growthSource: "inflation",
    startYear: 2033, endYear: 2070, startYearRef: "client_retirement", endYearRef: "plan_end",
  });
  ids.businessExpense = await expense({
    type: "other", name: "Hendricks Design LLC expenses", annualAmount: "12000", startYear: 2026, endYear: 2060, ownerAccountId: ids.business,
  });
  [{ id: ids.savings }] = await db
    .insert(savingsRules)
    .values({
      clientId, scenarioId, accountId: ids.brokerage, annualAmount: "6000", growthRate: "0.0200",
      startYear: 2026, endYear: 2033, endYearRef: "client_retirement", employerMatchPct: "0.5000", employerMatchCap: "0.0600",
    })
    .returning({ id: savingsRules.id });
  // Rules that still hold the amounts of a mode they left (the Details dialog keeps them).
  const rule = async (values: Pick<typeof savingsRules.$inferInsert, "annualAmount" | "annualPercent" | "contributeMax">) =>
    (await db
      .insert(savingsRules)
      .values({ clientId, scenarioId, accountId: ids.brokerage, startYear: 2026, endYear: 2033, ...values })
      .returning({ id: savingsRules.id }))[0].id;
  ids.percentRule = await rule({ annualAmount: "6000", annualPercent: "0.1000" });
  ids.maxRule = await rule({ annualAmount: "6000", annualPercent: "0.1000", contributeMax: true });
  ids.maxAmountRule = await rule({ annualAmount: "3000", contributeMax: true });
  ids.zeroPercentRule = await rule({ annualAmount: "4000", annualPercent: "0.0000" });

  [{ id: ids.disability }] = await db
    .insert(disabilityPolicies)
    .values({ clientId, name: "Acme LTD", insured: "client", carrier: "Unum", hasShortTerm: false, ltdBenefitPct: "0.6500", ltdMonthlyMax: "12000" })
    .returning({ id: disabilityPolicies.id });
  [{ id: ids.ltc }] = await db
    .insert(ltcPolicies)
    .values({
      clientId, name: "Genworth LTC", insured: "spouse", carrier: "Genworth", issueYear: 2020, benefitAmount: "6000",
      benefitPeriodMode: "years", benefitPeriodYears: 3, inflationRider: "compound", annualPremium: "2400",
    })
    .returning({ id: ltcPolicies.id });

  const entity = async (values: Omit<typeof entities.$inferInsert, "clientId">) =>
    (await db.insert(entities).values({ clientId, ...values }).returning({ id: entities.id }))[0].id;
  ids.ilit = await entity({
    name: "Hendricks ILIT", entityType: "trust", trustSubType: "ilit", isIrrevocable: true, grantor: "client",
    trustee: "Jane Smith", crummeyPowers: true, trustEnds: "survivorship",
  });
  ids.grandparents = await entity({ name: "Grandparents' Trust", entityType: "trust", trustSubType: "irrevocable", isIrrevocable: true });
  ids.education = await entity({ name: "Education Trust", entityType: "trust", trustSubType: "irrevocable", isIrrevocable: true, grantor: "spouse" });
  ids.holdings = await entity({ name: "Hendricks Holdings LLC", entityType: "llc" });
  await db.insert(beneficiaryDesignations).values([
    // An old-style designation naming the co-client's own family member row.
    { clientId, targetKind: "trust", entityId: ids.ilit, tier: "income", familyMemberId: ids.laura, percentage: "100.00", sortOrder: 0 },
    { clientId, targetKind: "trust", entityId: ids.ilit, tier: "remainder", familyMemberId: ids.emma, percentage: "50.00", sortOrder: 1 },
    { clientId, targetKind: "trust", entityId: ids.ilit, tier: "remainder", externalBeneficiaryId: ids.charity, percentage: "50.00", sortOrder: 2 },
    { clientId, targetKind: "trust", entityId: ids.grandparents, tier: "remainder", householdRole: "client", percentage: "100.00", sortOrder: 0 },
    // An account's designation: never a trust's.
    { clientId, targetKind: "account", accountId: ids.brokerage, tier: "primary", familyMemberId: ids.emma, percentage: "100.00", sortOrder: 0 },
  ]);
  [{ id: ids.rlt }] = await db.insert(revocableTrusts).values({ clientId, name: "Hendricks Family Trust" }).returning({ id: revocableTrusts.id });

  [{ id: ids.markWill }] = await db.insert(wills).values({ clientId, grantor: "client" }).returning({ id: wills.id });
  [{ id: ids.lauraWill }] = await db.insert(wills).values({ clientId, grantor: "spouse" }).returning({ id: wills.id });
  [{ id: ids.businessBequest }] = await db
    .insert(willBequests)
    .values({ willId: ids.markWill, name: "Hendricks Design LLC", kind: "asset", assetMode: "specific", accountId: ids.business, percentage: "100", condition: "always", sortOrder: 0 })
    .returning({ id: willBequests.id });
  [{ id: ids.debtBequest }] = await db
    .insert(willBequests)
    .values({ willId: ids.markWill, name: "Chase Visa", kind: "liability", liabilityId: ids.visa, percentage: "100", condition: "always", sortOrder: 1 })
    .returning({ id: willBequests.id });
  await db.insert(willBequestRecipients).values([
    { bequestId: ids.businessBequest, recipientKind: "spouse", recipientId: null, percentage: "60", sortOrder: 0 },
    { bequestId: ids.businessBequest, recipientKind: "family_member", recipientId: ids.emma, percentage: "40", sortOrder: 1 },
    { bequestId: ids.debtBequest, recipientKind: "family_member", recipientId: ids.emma, percentage: "100", sortOrder: 0 },
  ]);
  await db.insert(willResiduaryRecipients).values([
    { willId: ids.markWill, recipientKind: "entity", recipientId: ids.ilit, tier: "primary", percentage: "100", sortOrder: 0 },
    { willId: ids.markWill, recipientKind: "external_beneficiary", recipientId: ids.charity, tier: "contingent", percentage: "100", sortOrder: 1 },
    { willId: ids.lauraWill, recipientKind: "spouse", recipientId: null, tier: "primary", percentage: "100", sortOrder: 0 },
  ]);

  [{ id: ids.gift2022 }] = await db
    .insert(gifts)
    .values({ clientId, year: 2022, grantor: "joint", amount: "34000", recipientFamilyMemberId: ids.emma, notes: "Form 709 filed: Yes." })
    .returning({ id: gifts.id });
  [{ id: ids.gift2023 }] = await db
    .insert(gifts)
    .values({ clientId, year: 2023, grantor: "client", amount: "18000", recipientEntityId: ids.ilit })
    .returning({ id: gifts.id });
  [{ id: ids.childGift }] = await db
    .insert(gifts)
    .values({ clientId, year: 2024, grantor: "client", amount: "1000", recipientFamilyMemberId: ids.emma, parentGiftId: ids.gift2022 })
    .returning({ id: gifts.id });

  [{ id: ids.note }] = await db
    .insert(planObservations)
    .values({ clientId, section: "observation", topic: "estate", body: "Client's will was last updated in 2019.", audience: "advisor" })
    .returning({ id: planObservations.id });
  [{ id: ids.nextStep }] = await db
    .insert(planObservations)
    .values({ clientId, section: "next_step", topic: "tax", body: "Call the CPA about the 709." })
    .returning({ id: planObservations.id });
}

/** A second scenario of the same client. Scenario tables accept rows only for a base case, so it is one while seeded. */
async function seedWhatIf() {
  const [scenario] = await db.insert(scenarios).values({ clientId, name: "What if", isBaseCase: true }).returning({ id: scenarios.id });
  whatIfId = scenario.id;
  const [account] = await db
    .insert(accounts)
    .values({ clientId, scenarioId: whatIfId, name: "What-if Brokerage", category: "taxable", subType: "brokerage" })
    .returning({ id: accounts.id });
  const [income] = await db
    .insert(incomes)
    .values({ clientId, scenarioId: whatIfId, type: "other", name: "What-if bonus", startYear: 2026, endYear: 2027 })
    .returning({ id: incomes.id });
  const [expense] = await db
    .insert(expenses)
    .values({ clientId, scenarioId: whatIfId, type: "other", name: "What-if trip", startYear: 2026, endYear: 2026 })
    .returning({ id: expenses.id });
  const [rule] = await db
    .insert(savingsRules)
    .values({ clientId, scenarioId: whatIfId, accountId: account.id, startYear: 2026, endYear: 2030 })
    .returning({ id: savingsRules.id });
  const [settings] = await db
    .insert(planSettings)
    .values({ clientId, scenarioId: whatIfId, planStartYear: 2026, planEndYear: 2070, residenceState: "TX" })
    .returning({ id: planSettings.id });
  whatIfIds.push(account.id, income.id, expense.id, rule.id, settings.id);
  await db.update(scenarios).set({ isBaseCase: false }).where(eq(scenarios.id, whatIfId));
}

/** The other client: one row in every table the book reads, all named "Other …". */
async function seedOtherClient() {
  const other = await createTestClientWithScenario(FIRM);
  const c = other.clientId;
  const s = other.scenarioId;
  const householdId = await householdOf(c);
  await db.update(crmHouseholdContacts).set({ firstName: "Otto", lastName: "Other" }).where(eq(crmHouseholdContacts.householdId, householdId));
  const [lawyer] = await db.insert(crmHouseholdContacts).values({ householdId, role: "other", firstName: "Other", lastName: "Lawyer" }).returning({ id: crmHouseholdContacts.id });
  const [kid] = await db.insert(familyMembers).values({ clientId: c, firstName: "Other", lastName: "Kid" }).returning({ id: familyMembers.id });
  const [charity] = await db.insert(externalBeneficiaries).values({ clientId: c, name: "Other Charity" }).returning({ id: externalBeneficiaries.id });
  const [settings] = await db.insert(planSettings).values({ clientId: c, scenarioId: s, planStartYear: 2026, planEndYear: 2070, residenceState: "NY" }).returning({ id: planSettings.id });
  const [account] = await db.insert(accounts).values({ clientId: c, scenarioId: s, name: "Other Brokerage", category: "taxable" }).returning({ id: accounts.id });
  const [income] = await db.insert(incomes).values({ clientId: c, scenarioId: s, type: "salary", name: "Other salary", startYear: 2026, endYear: 2030 }).returning({ id: incomes.id });
  const [expense] = await db.insert(expenses).values({ clientId: c, scenarioId: s, type: "other", name: "Other expense", startYear: 2026, endYear: 2030 }).returning({ id: expenses.id });
  const [rule] = await db.insert(savingsRules).values({ clientId: c, scenarioId: s, accountId: account.id, startYear: 2026, endYear: 2030 }).returning({ id: savingsRules.id });
  const [disability] = await db.insert(disabilityPolicies).values({ clientId: c, name: "Other DI", insured: "client" }).returning({ id: disabilityPolicies.id });
  const [ltc] = await db.insert(ltcPolicies).values({ clientId: c, name: "Other LTC", insured: "client", issueYear: 2020 }).returning({ id: ltcPolicies.id });
  const [trust] = await db.insert(entities).values({ clientId: c, name: "Other Trust", entityType: "trust", trustSubType: "irrevocable", isIrrevocable: true }).returning({ id: entities.id });
  const [designation] = await db
    .insert(beneficiaryDesignations)
    .values({ clientId: c, targetKind: "trust", entityId: trust.id, tier: "remainder", familyMemberId: kid.id, percentage: "100.00" })
    .returning({ id: beneficiaryDesignations.id });
  const [rlt] = await db.insert(revocableTrusts).values({ clientId: c, name: "Other RLT" }).returning({ id: revocableTrusts.id });
  const [will] = await db.insert(wills).values({ clientId: c, grantor: "client" }).returning({ id: wills.id });
  const [bequest] = await db
    .insert(willBequests)
    .values({ willId: will.id, name: "Other Bequest", kind: "asset", assetMode: "specific", accountId: account.id, percentage: "100", condition: "always", sortOrder: 0 })
    .returning({ id: willBequests.id });
  const [recipient] = await db
    .insert(willBequestRecipients)
    .values({ bequestId: bequest.id, recipientKind: "family_member", recipientId: kid.id, percentage: "100", sortOrder: 0 })
    .returning({ id: willBequestRecipients.id });
  const [residuary] = await db
    .insert(willResiduaryRecipients)
    .values({ willId: will.id, recipientKind: "family_member", recipientId: kid.id, percentage: "100", sortOrder: 0 })
    .returning({ id: willResiduaryRecipients.id });
  const [gift] = await db.insert(gifts).values({ clientId: c, year: 2021, grantor: "client", amount: "5000", recipientFamilyMemberId: kid.id }).returning({ id: gifts.id });
  const [note] = await db.insert(planObservations).values({ clientId: c, section: "observation", body: "Other note." }).returning({ id: planObservations.id });
  otherIds.push(
    c, s, lawyer.id, kid.id, charity.id, settings.id, account.id, income.id, expense.id, rule.id, disability.id, ltc.id,
    trust.id, designation.id, rlt.id, will.id, bequest.id, recipient.id, residuary.id, gift.id, note.id,
  );
}

const byLabel = (records: BookRecord[]) => [...records].sort((a, b) => a.label.localeCompare(b.label));
const labels = (records: BookRecord[]) => byLabel(records).map((r) => r.label);
const record = (target: string, id: string) => ({ ref: "record", target, id });

describe.skipIf(!HAS_DB)("loadRecordBook part 1 (live DB)", () => {
  let book: RecordBook;

  beforeAll(async () => {
    await dropFirm();
    ({ clientId, scenarioId } = await createTestClientWithScenario(FIRM));
    await seedClient();
    await seedWhatIf();
    await seedOtherClient();
    book = await loadRecordBook(clientId, FIRM, scenarioId);
  });
  afterAll(dropFirm);

  it("has every target, and names the household's people", () => {
    expect(Object.keys(book.records).sort()).toEqual([...TARGET_KINDS].sort());
    expect(book.clientId).toBe(clientId);
    expect(book.scenarioId).toBe(scenarioId);
    expect(book.people).toEqual({ client: ids.mark, spouse: ids.laura });
    expect(book.names).toEqual({ client: "Mark", spouse: "Laura" });
  });

  it("never reads the other client's rows, nor another scenario's", () => {
    const json = JSON.stringify(book);
    for (const id of [...otherIds, ...whatIfIds]) expect(json).not.toContain(id);
    expect(json).not.toMatch(/Other|Otto|What-if/);
    expect(json).not.toContain(ids.childGift);
    expect(json).not.toContain(ids.nextStep);
  });

  it("refuses a client outside the firm", async () => {
    await expect(loadRecordBook(clientId, "firm_test_fact_finder_book_elsewhere", scenarioId)).rejects.toThrow("Client not found");
  });

  it("the household: CRM contacts, the client row and the base case's plan settings", () => {
    expect(book.records.client_household).toEqual([{
      id: clientId,
      label: "Mark Hendricks",
      values: {
        firstName: "Mark", lastName: "Hendricks", dateOfBirth: "1968-04-12",
        retirementAge: 65, retirementMonth: 6, lifeExpectancy: 90,
        email: "mark@example.com", phone: null, mobile: null, employer: "Acme Corp",
        spouseName: "Laura", spouseLastName: "Hendricks", spouseDob: "1970-09-30",
        spouseRetirementAge: 63, spouseRetirementMonth: null, spouseLifeExpectancy: 95,
        spouseEmail: null, spousePhone: null, spouseMobile: null, spouseEmployer: "Denver Health",
        filingStatus: "married_joint",
        addressLine1: null, addressLine2: null, city: "Denver", state: "CO", postalCode: null,
      },
    }]);
    expect(book.records.plan_settings_tax_rates).toEqual([{
      id: ids.settings,
      label: "Tax settings",
      values: { coveredByWorkplacePlan: "yes", spouseCoveredByWorkplacePlan: "auto", residenceState: "CO" },
    }]);
  });

  it("people: family (not the client and co-client), charities, related parties", () => {
    expect(book.records.family_member).toEqual([{
      id: ids.emma,
      label: "Emma Hendricks",
      values: {
        firstName: "Emma", lastName: "Hendricks", relationship: "child", dateOfBirth: "2004-05-21",
        claimedAsDependent: "no", domesticPartner: false, notes: "Starts college in 2026.",
      },
    }]);
    expect(book.records.external_beneficiary).toEqual([{
      id: ids.charity,
      label: "Denver Rescue Mission",
      values: { name: "Denver Rescue Mission", kind: "charity", charityType: "public", notes: null },
    }]);
    expect(book.records.related_party).toEqual([{
      id: ids.jane,
      label: "Jane Smith",
      values: { firstName: "Jane", lastName: "Smith", employer: "Smith & Co", notes: "Drafted both wills." },
    }]);
  });

  it("income: numbers, fractions, timing, and the facts the maps look up", () => {
    expect(byLabel(book.records.income)).toEqual([
      {
        id: ids.businessIncome,
        label: "Hendricks Design LLC income",
        values: {
          name: "Hendricks Design LLC income", type: "business", owner: "client", annualAmount: 90000, growthRate: 0.03,
          start: { yearRef: "plan_start" }, end: { yearRef: "plan_end" }, taxType: null, paymentMonth: null, survivorshipPct: null,
          ssBenefitMode: null, piaMonthly: null, ssStatedAge: null, claimingAgeMode: null, claimingAge: null, claimingAgeMonths: 0,
        },
        facts: { type: "business", owner: "client", ownerAccountId: ids.business },
      },
      {
        id: ids.salary,
        label: "Salary — Acme Corp",
        values: {
          name: "Salary — Acme Corp", type: "salary", owner: "client", annualAmount: 150000, growthRate: 0.04,
          start: 2026, end: { yearRef: "client_retirement" }, taxType: "earned_income", paymentMonth: 12, survivorshipPct: null,
          ssBenefitMode: null, piaMonthly: null, ssStatedAge: null, claimingAgeMode: null, claimingAge: null, claimingAgeMonths: 0,
        },
        facts: { type: "salary", owner: "client", ownerAccountId: null },
      },
      {
        id: ids.ss,
        label: "Social Security — Mark",
        // growthRate null: the row follows inflation, so its stored rate isn't the one in effect.
        values: {
          name: "Social Security — Mark", type: "social_security", owner: "client", annualAmount: 0, growthRate: null,
          start: 2035, end: { yearRef: "client_end" }, taxType: null, paymentMonth: null, survivorshipPct: null,
          ssBenefitMode: "pia_at_fra", piaMonthly: 3200, ssStatedAge: null, claimingAgeMode: "years", claimingAge: 67, claimingAgeMonths: 6,
        },
        facts: { type: "social_security", owner: "client", ownerAccountId: null },
      },
    ]);
  });

  it("expenses and savings: living slots, items, the business's expense, the account a rule pays into", () => {
    expect(byLabel(book.records.expense)).toEqual([
      {
        id: ids.current,
        label: "Current living expenses",
        values: {
          name: "Current living expenses", type: "living", annualAmount: 14400, growthRate: 0.03,
          start: { yearRef: "plan_start" }, end: { yearRef: "client_retirement" }, isGoal: false,
          livingItems: [{ name: "Groceries", amount: 1200, frequency: "monthly" }],
        },
        facts: { type: "living", livingSlot: "current", ownerAccountId: null },
      },
      {
        id: ids.businessExpense,
        label: "Hendricks Design LLC expenses",
        values: {
          name: "Hendricks Design LLC expenses", type: "other", annualAmount: 12000, growthRate: 0.03,
          start: 2026, end: 2060, isGoal: false, livingItems: null,
        },
        facts: { type: "other", livingSlot: null, ownerAccountId: ids.business },
      },
      {
        id: ids.retirement,
        label: "Retirement living expenses",
        values: {
          name: "Retirement living expenses", type: "living", annualAmount: 90000, growthRate: null,
          start: { yearRef: "client_retirement" }, end: { yearRef: "plan_end" }, isGoal: false, livingItems: null,
        },
        facts: { type: "living", livingSlot: "retirement", ownerAccountId: null },
      },
    ]);
    expect(book.records.savings_rule.find((r) => r.id === ids.savings)).toEqual({
      id: ids.savings,
      label: "Schwab Brokerage",
      values: {
        accountId: record("account", ids.brokerage), contributeMax: false, annualAmount: 6000, annualPercent: null,
        rothPercent: null, employerMatchPct: 0.5, employerMatchCap: 0.06, employerMatchAmount: null,
        start: 2026, end: { yearRef: "client_retirement" }, growthRate: 0.02,
      },
      facts: { accountId: ids.brokerage },
    });
  });

  it("savings rules: an amount the contribution mode ignores reads blank", () => {
    const values = (id: string) => book.records.savings_rule.find((r) => r.id === id)?.values;
    expect(book.records.savings_rule).toHaveLength(5);
    // Fixed $: the amount is the contribution.
    expect(values(ids.savings)).toMatchObject({ contributeMax: false, annualAmount: 6000, annualPercent: null });
    // % of salary: the amount left from Fixed $ is ignored.
    expect(values(ids.percentRule)).toMatchObject({ contributeMax: false, annualAmount: null, annualPercent: 0.1 });
    // IRS maximum: so are the amount and the percent, whichever mode they were left from.
    expect(values(ids.maxRule)).toMatchObject({ contributeMax: true, annualAmount: null, annualPercent: null });
    expect(values(ids.maxAmountRule)).toMatchObject({ contributeMax: true, annualAmount: null, annualPercent: null });
    // A percent of 0 isn't % of salary (the engine and Details read the amount).
    expect(values(ids.zeroPercentRule)).toMatchObject({ contributeMax: false, annualAmount: 4000, annualPercent: 0 });
  });

  it("disability and long-term care policies", () => {
    expect(book.records.disability_policy).toEqual([{
      id: ids.disability,
      label: "Acme LTD",
      values: {
        name: "Acme LTD", carrier: "Unum", insured: "client", coveredEarningsMode: "salary", coveredEarningsAmount: null,
        hasShortTerm: false, stdEliminationDays: 7, stdBenefitPct: 0.6, stdDurationWeeks: 13, stdMonthlyMax: null,
        hasLongTerm: true, ltdEliminationDays: 90, ltdBenefitPct: 0.65, ltdMonthlyMax: 12000,
        ltdBenefitPeriodMode: "to_age", ltdBenefitPeriodAge: 65, ltdBenefitPeriodYears: null,
        benefitTaxable: true, colaRate: 0, annualPremium: 0, premiumPayer: "employer", notes: null,
      },
    }]);
    expect(book.records.ltc_policy).toEqual([{
      id: ids.ltc,
      label: "Genworth LTC",
      values: {
        name: "Genworth LTC", carrier: "Genworth", insured: "spouse", kind: "standalone", lifePolicyAccountId: null,
        issueYear: 2020, benefitAmount: 6000, benefitUnit: "month", benefitPeriodMode: "years", benefitPeriodYears: 3,
        eliminationDays: 90, homeCarePct: 1, benefitType: "reimbursement", sharedCare: false, partnership: false,
        inflationRider: "compound", inflationRate: 0.03, annualPremium: 2400, premiumPayMode: "lifetime",
        premiumPayToAge: null, premiumPayYears: null, notes: null,
      },
    }]);
  });

  it("trusts (not businesses), each trust's beneficiaries as one set, revocable trusts", () => {
    expect(byLabel(book.records.entity)).toEqual([
      {
        id: ids.education,
        label: "Education Trust",
        values: { name: "Education Trust", trustSubType: "irrevocable", grantor: "spouse", trustee: null, isGrantor: false, crummeyPowers: false, trustEnds: null, notes: null },
        facts: { trustSubType: "irrevocable" },
      },
      {
        id: ids.grandparents,
        label: "Grandparents' Trust",
        // No grantor on record = someone else's trust: the map's "Someone else".
        values: { name: "Grandparents' Trust", trustSubType: "irrevocable", grantor: "none", trustee: null, isGrantor: false, crummeyPowers: false, trustEnds: null, notes: null },
        facts: { trustSubType: "irrevocable" },
      },
      {
        id: ids.ilit,
        label: "Hendricks ILIT",
        values: { name: "Hendricks ILIT", trustSubType: "ilit", grantor: "client", trustee: "Jane Smith", isGrantor: false, crummeyPowers: true, trustEnds: "survivorship", notes: null },
        facts: { trustSubType: "ilit" },
      },
    ]);
    expect(byLabel(book.records.trust_beneficiary_designation)).toEqual([
      { id: ids.education, label: "Education Trust", values: { beneficiaries: [] } },
      {
        id: ids.grandparents,
        label: "Grandparents' Trust",
        values: { beneficiaries: [{ tier: "remainder", who: { ref: "person", role: "client" }, percentage: 100 }] },
      },
      {
        id: ids.ilit,
        label: "Hendricks ILIT",
        values: {
          beneficiaries: [
            { tier: "income", who: { ref: "person", role: "spouse" }, percentage: 100 },
            { tier: "remainder", who: record("family_member", ids.emma), percentage: 50 },
            { tier: "remainder", who: record("external_beneficiary", ids.charity), percentage: 50 },
          ],
        },
      },
    ]);
    expect(book.records.revocable_trust).toEqual([{ id: ids.rlt, label: "Hendricks Family Trust", values: { name: "Hendricks Family Trust" } }]);
  });

  it("wills, their provisions and remaining-estate recipients", () => {
    expect(byLabel(book.records.will)).toEqual([
      { id: ids.lauraWill, label: "Laura's will", values: { grantor: "spouse" }, facts: { grantor: "spouse" } },
      { id: ids.markWill, label: "Mark's will", values: { grantor: "client" }, facts: { grantor: "client" } },
    ]);
    expect(byLabel(book.records.will_bequest)).toEqual([
      {
        id: ids.debtBequest,
        label: "Chase Visa",
        values: {
          kind: "liability", accountId: null, liabilityId: record("liability", ids.visa), percentage: 100,
          recipients: [{ who: record("family_member", ids.emma), percentage: 100 }], condition: "always",
        },
        facts: { willId: ids.markWill, grantor: "client", assetKey: `liability:${ids.visa}` },
      },
      {
        id: ids.businessBequest,
        label: "Hendricks Design LLC",
        values: {
          kind: "asset", accountId: record("business_account", ids.business), liabilityId: null, percentage: 100,
          // "spouse" on the client's will is the co-client.
          recipients: [
            { who: { ref: "person", role: "spouse" }, percentage: 60 },
            { who: record("family_member", ids.emma), percentage: 40 },
          ],
          condition: "always",
        },
        facts: { willId: ids.markWill, grantor: "client", assetKey: `account:${ids.business}` },
      },
    ]);
    // Primary recipients only — the fact finder's "Remaining estate" has no contingent tier.
    expect(byLabel(book.records.will_residuary_recipient)).toEqual([
      // "spouse" on the co-client's will is the client.
      { id: ids.lauraWill, label: "Laura's will — remaining estate", values: { recipients: [{ who: { ref: "person", role: "client" }, percentage: 100 }] } },
      { id: ids.markWill, label: "Mark's will — remaining estate", values: { recipients: [{ who: record("entity", ids.ilit), percentage: 100 }] } },
    ]);
  });

  it("prior gifts (parent rows only) and the client's observations", () => {
    expect(byLabel(book.records.gift)).toEqual([
      {
        id: ids.gift2022,
        label: "2022 gift",
        values: { year: 2022, grantor: "joint", recipient: record("family_member", ids.emma), amount: 34000, notes: "Form 709 filed: Yes." },
      },
      {
        id: ids.gift2023,
        label: "2023 gift",
        values: { year: 2023, grantor: "client", recipient: record("entity", ids.ilit), amount: 18000, notes: null },
      },
    ]);
    expect(book.records.plan_observation).toEqual([{
      id: ids.note,
      label: "Client's will was last updated in 2019.",
      values: { topic: "estate", body: "Client's will was last updated in 2019." },
    }]);
  });

  it("another scenario's book has that scenario's rows and the same client-level records", async () => {
    const whatIf = await loadRecordBook(clientId, FIRM, whatIfId);
    expect(labels(whatIf.records.income)).toEqual(["What-if bonus"]);
    expect(labels(whatIf.records.expense)).toEqual(["What-if trip"]);
    expect(labels(whatIf.records.savings_rule)).toEqual(["What-if Brokerage"]);
    expect(whatIf.records.plan_settings_tax_rates.map((r) => r.values.residenceState)).toEqual(["TX"]);
    expect(whatIf.records.family_member).toEqual(book.records.family_member);
    expect(whatIf.records.will).toEqual(book.records.will);
  });

  it("a client with no base case gets the client-level records and no scenario ones", async () => {
    const none = await loadRecordBook(clientId, FIRM, null);
    expect(none.scenarioId).toBeNull();
    expect(none.records.client_household).toEqual(book.records.client_household);
    expect(none.records.family_member).toEqual(book.records.family_member);
    expect(labels(none.records.entity)).toEqual(["Education Trust", "Grandparents' Trust", "Hendricks ILIT"]);
    expect(labels(none.records.gift)).toEqual(["2022 gift", "2023 gift"]);
    for (const target of ["plan_settings_tax_rates", "income", "expense", "savings_rule"] as const) {
      expect(none.records[target]).toEqual([]);
    }
  });
});
