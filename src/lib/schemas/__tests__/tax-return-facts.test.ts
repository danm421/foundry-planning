import { describe, it, expect } from "vitest";
import {
  taxReturnFactsSchema,
  emptyTaxReturnFacts,
  emptyBusiness,
  emptyK1,
  TAX_RETURN_MIN_YEAR,
} from "../tax-return-facts";

describe("taxReturnFactsSchema", () => {
  it("accepts an empty facts object for a valid year", () => {
    const empty = emptyTaxReturnFacts(2025);
    const parsed = taxReturnFactsSchema.safeParse(empty);
    expect(parsed.success).toBe(true);
    expect(empty.taxYear).toBe(2025);
    expect(empty.income.wages).toBeNull();
    expect(empty.deductions.scheduleA).toBeNull();
  });

  it("rejects years below TAX_RETURN_MIN_YEAR", () => {
    expect(TAX_RETURN_MIN_YEAR).toBe(2022);
    const parsed = taxReturnFactsSchema.safeParse(emptyTaxReturnFacts(2021));
    expect(parsed.success).toBe(false);
  });

  it("rejects unknown keys (strict)", () => {
    const facts = { ...emptyTaxReturnFacts(2024), bogus: 1 };
    expect(taxReturnFactsSchema.safeParse(facts).success).toBe(false);
  });

  // `parseRowFacts` re-validates already-persisted jsonb on every read, so a
  // row written before `income.scheduleE` existed must still parse. These two
  // tests are a pair on purpose: the first proves the new key is optional on
  // input, the second proves the schema did NOT become lenient about missing
  // keys generally — without it, the first would pass even if `.strict()` had
  // been dropped entirely.
  it("accepts a persisted facts blob written before income.scheduleE existed", () => {
    const legacy = emptyTaxReturnFacts(2025) as Record<string, unknown>;
    const income = { ...(legacy.income as Record<string, unknown>) };
    delete income.scheduleE;
    legacy.income = income;
    expect("scheduleE" in income).toBe(false);

    const parsed = taxReturnFactsSchema.safeParse(legacy);
    expect(parsed.success).toBe(true);
    // Defaulted, not merely absent — downstream reads `.scheduleE` unguarded.
    expect(parsed.success && parsed.data.income.scheduleE).toBeNull();
  });

  it("still rejects a facts blob missing a pre-existing income key", () => {
    const broken = emptyTaxReturnFacts(2025) as Record<string, unknown>;
    const income = { ...(broken.income as Record<string, unknown>) };
    delete income.wages;
    broken.income = income;
    expect(taxReturnFactsSchema.safeParse(broken).success).toBe(false);
  });

  it("accepts a populated Schedule E block and rejects unknown keys in it", () => {
    const facts = emptyTaxReturnFacts(2025);
    facts.income.scheduleENet = -6141;
    facts.income.scheduleE = {
      grossRents: 19600, totalExpenses: 25741, depreciation: 8413,
      mortgageInterest: 6210, propertyTaxes: 5024, suspendedPassiveLoss: 0,
    };
    expect(taxReturnFactsSchema.safeParse(facts).success).toBe(true);

    const bogus = {
      ...facts,
      income: { ...facts.income, scheduleE: { ...facts.income.scheduleE, netRent: 1 } },
    };
    expect(taxReturnFactsSchema.safeParse(bogus).success).toBe(false);
  });

  it("accepts a fully populated MFJ return", () => {
    const facts = emptyTaxReturnFacts(2025);
    facts.filingStatus = "married_joint";
    facts.residenceState = "PA";
    facts.income.wages = 250000;
    facts.income.qualifiedDividends = 12000;
    facts.deductions.deductionTaken = "itemized";
    facts.deductions.scheduleA = {
      saltPaid: 28000, saltDeducted: 10000, mortgageInterest: 9000,
      charitableCash: 15000, charitableNonCash: 2000, medical: 0,
    };
    facts.tax.totalTax = 41180;
    expect(taxReturnFactsSchema.safeParse(facts).success).toBe(true);
  });

  // Same paired shape as the scheduleE guard above: the first test proves the
  // new keys are optional on INPUT, the second proves the schema did not
  // become lenient about missing keys generally.
  it("accepts a persisted facts blob written before the v2 blocks existed", () => {
    const legacy = emptyTaxReturnFacts(2025) as Record<string, unknown>;
    const income = { ...(legacy.income as Record<string, unknown>) };
    const deductions = { ...(legacy.deductions as Record<string, unknown>) };
    delete income.adjustmentsDetail;
    delete deductions.qbi;
    delete legacy.businesses;
    delete legacy.k1s;
    legacy.income = income;
    legacy.deductions = deductions;

    const parsed = taxReturnFactsSchema.safeParse(legacy);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    // Defaulted, not merely absent — downstream reads these unguarded.
    expect(parsed.data.income.adjustmentsDetail).toBeNull();
    expect(parsed.data.deductions.qbi).toBeNull();
    expect(parsed.data.businesses).toEqual([]);
    expect(parsed.data.k1s).toEqual([]);
  });

  it("accepts a persisted ENTITY written before entityId existed", () => {
    // Same production trap one level down: `parseRowFacts` re-validates
    // persisted jsonb on every read, and every entity written before identity
    // was stamped has no `entityId` key. A plain `.nullable()` here would fail
    // those rows and blank the whole Tax Analysis tab.
    const legacy = emptyTaxReturnFacts(2025) as Record<string, unknown>;
    const k1 = { ...emptyK1() } as Record<string, unknown>;
    delete k1.entityId;
    const business = { ...emptyBusiness() } as Record<string, unknown>;
    delete business.entityId;
    legacy.k1s = [k1];
    legacy.businesses = [business];

    const parsed = taxReturnFactsSchema.safeParse(legacy);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    // Defaulted, not merely absent — `entityKey` reads it unguarded.
    expect(parsed.data.k1s[0].entityId).toBeNull();
    expect(parsed.data.businesses[0].entityId).toBeNull();
  });

  it("still rejects a facts blob missing a pre-existing deductions key", () => {
    const broken = emptyTaxReturnFacts(2025) as Record<string, unknown>;
    const deductions = { ...(broken.deductions as Record<string, unknown>) };
    delete deductions.qbiDeduction;
    broken.deductions = deductions;
    expect(taxReturnFactsSchema.safeParse(broken).success).toBe(false);
  });

  it("accepts populated v2 blocks and rejects unknown keys inside them", () => {
    const facts = emptyTaxReturnFacts(2025);
    facts.deductions.qbi = {
      qualifiedBusinessIncome: 180000, reitPtpDividends: 0,
      w2Wages: 60000, ubia: 0, sstbPresent: false,
    };
    facts.income.adjustmentsDetail = {
      seTaxDeduction: 12000, sepSimpleSolo401k: 0,
      selfEmployedHealthInsurance: 9600, hsaDeduction: 0,
    };
    facts.businesses = [{
      entityId: null, name: "Mueller Consulting", netProfit: 180000, grossReceipts: 240000,
      totalExpenses: 60000, depreciation: 4000, isSstb: false,
    }];
    facts.k1s = [{
      entityId: null, entityName: "Ridge Partners LLC", ein: "12-3456789",
      entityType: "partnership",
      ordinaryBusinessIncome: 42000, rentalIncome: null, guaranteedPayments: 30000,
      section179: 0, w2WagesFromEntity: null, qbiIncome: 42000, isSstb: false,
    }];
    expect(taxReturnFactsSchema.safeParse(facts).success).toBe(true);

    const bogus = {
      ...facts,
      k1s: [{ ...facts.k1s[0], box20Code: "Z" }],
    };
    expect(taxReturnFactsSchema.safeParse(bogus).success).toBe(false);
  });

  it("rejects an unknown entityType", () => {
    const facts = emptyTaxReturnFacts(2025);
    const bad = {
      ...facts,
      k1s: [{
        entityName: "X", ein: null, entityType: "c_corp",
        ordinaryBusinessIncome: null, rentalIncome: null, guaranteedPayments: null,
        section179: null, w2WagesFromEntity: null, qbiIncome: null, isSstb: null,
      }],
    };
    expect(taxReturnFactsSchema.safeParse(bad).success).toBe(false);
  });
});
