import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import type { Account, BeneficiaryRef, ClientData, FamilyMember, ProjectionYear, QcdEvent } from "../types";
import { TAX_YEAR_2026 } from "./_fixtures/tax-year-2026";

const IRA = "acc-ira";
const CHECKING = "acc-checking";
const CHARITY_ID = "00000000-0000-0000-0000-000000000aaa";
const CLIENT_FM_ID = "00000000-0000-0000-0000-000000000001";
const SPOUSE_FM_ID = "00000000-0000-0000-0000-000000000002";
const KID_FM_ID = "kid-a";

/** Age 75 in 2026: Uniform Lifetime divisor 24.6. */
const RMD_DOB = "1951-01-01";
const RMD_2026 = 1_000_000 / 24.6;

interface FixtureOptions {
  iraValue?: number;
  iraBasis?: number;
  dob?: string;
  planEndYear?: number;
}

function baseData(opts: FixtureOptions = {}): ClientData {
  const dob = opts.dob ?? RMD_DOB;
  return {
    client: {
      firstName: "Qcd",
      lastName: "Test",
      dateOfBirth: dob,
      filingStatus: "single",
      retirementAge: 65,
      planEndAge: 95,
    },
    accounts: [
      {
        id: CHECKING,
        name: "Checking",
        category: "cash",
        subType: "checking",
        value: 1_000_000,
        basis: 1_000_000,
        growthRate: 0,
        rmdEnabled: false,
        isDefaultChecking: true,
        owners: [{ kind: "family_member", familyMemberId: CLIENT_FM_ID, percent: 1 }],
      } as Account,
      {
        id: IRA,
        name: "Client IRA",
        category: "retirement",
        subType: "traditional_ira",
        value: opts.iraValue ?? 1_000_000,
        basis: opts.iraBasis ?? 0,
        growthRate: 0,
        rmdEnabled: true,
        owners: [{ kind: "family_member", familyMemberId: CLIENT_FM_ID, percent: 1 }],
      } as Account,
    ],
    incomes: [],
    expenses: [],
    liabilities: [],
    savingsRules: [],
    withdrawalStrategy: [],
    planSettings: {
      flatFederalRate: 0,
      flatStateRate: 0,
      inflationRate: 0,
      planStartYear: 2026,
      planEndYear: opts.planEndYear ?? 2030,
      taxEngineMode: "bracket",
      taxInflationRate: 0.025,
      estateAdminExpenses: 0,
      flatStateEstateRate: 0,
    },
    entities: [],
    deductions: [],
    transfers: [],
    assetTransactions: [],
    gifts: [],
    giftEvents: [],
    taxYearRows: [TAX_YEAR_2026],
    wills: [],
    familyMembers: [
      {
        id: CLIENT_FM_ID,
        firstName: "Client",
        lastName: "Test",
        relationship: "other",
        role: "client",
        dateOfBirth: dob,
      } as FamilyMember,
    ],
    externalBeneficiaries: [
      { id: CHARITY_ID, name: "Stanford", kind: "charity", charityType: "public" },
    ],
  } as ClientData;
}

function fixedQcd(year: number, amount: number): QcdEvent {
  return { year, accountId: IRA, charityId: CHARITY_ID, mode: "fixed", amount };
}

function yearOf(years: ProjectionYear[], year: number): ProjectionYear {
  const row = years.find((y) => y.year === year);
  if (!row) throw new Error(`no projection row for ${year}`);
  return row;
}

describe("projection — QCDs in the RMD step", () => {
  it("full RMD QCD pays the whole RMD to charity and none of it is taxed", () => {
    const data = baseData();
    data.qcds = [{ year: 2026, accountId: IRA, charityId: CHARITY_ID, mode: "full_rmd", amount: 0 }];
    const y26 = yearOf(runProjection(data), 2026);

    expect(y26.qcds).toHaveLength(1);
    const [r] = y26.qcds!;
    expect(r.accountId).toBe(IRA);
    expect(r.charityId).toBe(CHARITY_ID);
    expect(r.giver).toBe("client");
    expect(r.qualifying).toBeCloseTo(RMD_2026, 2);
    expect(r.taxedExcess).toBe(0);

    const ledger = y26.accountLedgers[IRA];
    expect(ledger.rmdAmount).toBe(0);
    expect(ledger.qcdAmount).toBeCloseTo(40_650.41, 2);
    expect(ledger.endingValue).toBeCloseTo(1_000_000 - RMD_2026, 2);
    const qcdLine = ledger.entries.find((e) => e.category === "qcd");
    expect(qcdLine?.label).toBe("QCD to Stanford");
    expect(qcdLine?.amount).toBeCloseTo(-RMD_2026, 2);
    expect(ledger.entries.some((e) => e.category === "rmd")).toBe(false);

    expect(y26.taxDetail?.bySource[`${IRA}:rmd`]?.amount ?? 0).toBe(0);
    expect(y26.accountLedgers[CHECKING].entries.some((e) => e.category === "rmd")).toBe(false);
    expect(y26.charityCarryforward?.cashPublic).toEqual([]);
  });

  it("fixed QCD below the RMD — the rest is a normal taxed RMD", () => {
    const data = baseData();
    data.qcds = [fixedQcd(2026, 15_000)];
    const y26 = yearOf(runProjection(data), 2026);

    const ledger = y26.accountLedgers[IRA];
    expect(ledger.rmdAmount).toBeCloseTo(25_650.41, 2);
    expect(ledger.qcdAmount).toBe(15_000);
    expect(y26.taxDetail!.bySource[`${IRA}:rmd`].amount).toBeCloseTo(25_650.41, 2);
    const checkingRmd = y26.accountLedgers[CHECKING].entries.find((e) => e.category === "rmd");
    expect(checkingRmd?.amount).toBeCloseTo(25_650.41, 2);
  });

  it("fixed QCD above the cap — excess is taxed and deducted", () => {
    const data = baseData({ iraValue: 5_000_000 });
    data.qcds = [fixedQcd(2026, 150_000)];
    const y26 = yearOf(runProjection(data), 2026);

    expect(y26.qcds).toHaveLength(1);
    expect(y26.qcds![0].qualifying).toBe(111_000);
    expect(y26.qcds![0].taxedExcess).toBe(39_000);

    const rmd = 5_000_000 / 24.6;
    expect(y26.taxDetail!.bySource[`${IRA}:rmd`].amount).toBeCloseTo(rmd - 150_000 + 39_000, 2);

    const ledger = y26.accountLedgers[IRA];
    expect(ledger.qcdAmount).toBe(111_000);
    // The household got only the RMD the QCD left unpaid; the excess went to
    // the charity, so it is not RMD cash.
    expect(ledger.rmdAmount).toBeCloseTo(rmd - 150_000, 2);
    expect(ledger.endingValue).toBeCloseTo(5_000_000 - rmd, 2);
    const taxedLine = ledger.entries.find(
      (e) => e.label === "QCD to Stanford (taxed, not a qualifying QCD)",
    );
    expect(taxedLine?.category).toBe("qcd");
    expect(taxedLine?.amount).toBe(-39_000);

    const charitable = y26.deductionBreakdown!.belowLine.charitable;
    expect(charitable).toBeGreaterThan(0);
    expect(charitable).toBeLessThanOrEqual(39_000);

    // Taxed: the excess is ordinary income beside the RMD the QCD left unpaid.
    expect(y26.taxDetail!.ordinaryIncome).toBeCloseTo(rmd - 150_000 + 39_000, 2);
    // Never household cash: checking, Total Income and Net Cash Flow see only
    // the RMD the QCD left unpaid.
    const checking = y26.accountLedgers[CHECKING];
    expect(checking.entries.find((e) => e.category === "rmd")?.amount).toBeCloseTo(rmd - 150_000, 2);
    expect(y26.totalIncome).toBeCloseTo(rmd - 150_000, 2);
    expect(y26.netCashFlow).toBeCloseTo(checking.endingValue - checking.beginningValue, 2);
  });

  it("the taxed excess is income on top of the RMD it pays — bracket and flat mode", () => {
    // $1M IRA: the ≈40,650 RMD is covered either way, so a 150,000 QCD adds
    // exactly its 39,000 over-cap excess to income against a 111,000 one.
    const run = (amount: number, taxEngineMode: "bracket" | "flat") => {
      const data = baseData();
      data.planSettings = { ...data.planSettings, taxEngineMode, flatFederalRate: 0.2 };
      data.qcds = [fixedQcd(2026, amount)];
      return yearOf(runProjection(data), 2026);
    };
    const ordinary = (y: ProjectionYear) => y.taxDetail!.ordinaryIncome;
    expect(ordinary(run(150_000, "bracket")) - ordinary(run(111_000, "bracket"))).toBeCloseTo(39_000, 2);
    // Flat mode reads the `taxableIncome` scalar, not taxDetail.
    const taxable = (y: ProjectionYear) => y.taxResult!.flow.taxableIncome;
    expect(taxable(run(150_000, "flat")) - taxable(run(111_000, "flat"))).toBeCloseTo(39_000, 2);
  });

  it("a plan without QCDs has no qcd fields", () => {
    const withEmpty = baseData();
    withEmpty.qcds = [];
    const withUndefined = baseData();
    delete withUndefined.qcds;

    const a = runProjection(withEmpty);
    const b = runProjection(withUndefined);
    expect(a).toEqual(b);
    for (const y of a) {
      expect("qcds" in y).toBe(false);
      for (const ledger of Object.values(y.accountLedgers)) {
        expect("qcdAmount" in ledger).toBe(false);
        expect(ledger.entries.some((e) => e.category === "qcd")).toBe(false);
      }
    }
  });

  it("skips before 70½", () => {
    // Born July 1957: 70½ in early 2028, so 2028 is the first eligible year.
    const data = baseData({ dob: "1957-07-01" });
    data.qcds = [fixedQcd(2027, 10_000), fixedQcd(2028, 10_000)];
    const years = runProjection(data);

    expect(yearOf(years, 2027).qcds).toBeUndefined();
    const y28 = yearOf(years, 2028);
    expect(y28.qcds).toHaveLength(1);
    expect(y28.qcds![0].qualifying).toBe(10_000);
    // No RMD yet (RMD age 73), so the QCD is the only distribution.
    expect(y28.accountLedgers[IRA].qcdAmount).toBe(10_000);
    expect(y28.accountLedgers[IRA].rmdAmount).toBe(0);
  });

  it("QCD never takes after-tax basis — a QCD covering the RMD leaves basis untouched", () => {
    // 45,000 ≥ the ≈40,650 RMD and under the cap: no taxable RMD remains.
    const data = baseData({ iraBasis: 100_000 });
    data.qcds = [fixedQcd(2026, 45_000)];
    const ledger = yearOf(runProjection(data), 2026).accountLedgers[IRA];

    expect(ledger.qcdAmount).toBe(45_000);
    expect(ledger.rmdAmount).toBe(0);
    expect(ledger.basisEoY).toBe(ledger.basisBoY);
  });

  it("QCD never takes after-tax basis — only the taxed remainder of the RMD moves basis", () => {
    const basisDrop = (qcds: QcdEvent[]) => {
      const data = baseData({ iraBasis: 100_000 });
      data.qcds = qcds;
      const ledger = yearOf(runProjection(data), 2026).accountLedgers[IRA];
      return (ledger.basisBoY ?? 0) - (ledger.basisEoY ?? 0);
    };
    const withQcd = basisDrop([fixedQcd(2026, 20_000)]);
    const withoutQcd = basisDrop([]);

    expect(withQcd).toBeGreaterThan(0);
    expect(withQcd).toBeLessThan(withoutQcd);
  });

  it("stops at the balance", () => {
    const data = baseData({ iraValue: 30_000 });
    data.qcds = [fixedQcd(2026, 50_000), fixedQcd(2027, 50_000)];
    const years = runProjection(data);

    const y26 = yearOf(years, 2026);
    expect(y26.qcds![0].qualifying).toBe(30_000);
    expect(y26.qcds![0].taxedExcess).toBe(0);
    expect(y26.accountLedgers[IRA].endingValue).toBe(0);

    const y27 = yearOf(years, 2027);
    expect(y27.qcds).toBeUndefined();
    expect(y27.accountLedgers[IRA].endingValue).toBe(0);
    for (const ledger of Object.values(y27.accountLedgers)) {
      expect(ledger.endingValue).toBeGreaterThanOrEqual(0);
    }
  });

  it("a QCD above an inherited IRA's minimum never pushes its planned payout past the balance", () => {
    // Inherited from an owner born 1945; the 2026–2026 window pays out the
    // whole balance this year, well above the required minimum.
    const data = baseData();
    data.accounts = data.accounts.map((a) =>
      a.id === IRA
        ? {
            ...a,
            value: 100_000,
            rmdEnabled: false,
            inheritedDeathYear: 2022,
            inheritedOwnerBirthYear: 1945,
            inheritedPayoutFromYear: 2026,
            inheritedPayoutThroughYear: 2026,
          }
        : a,
    );
    data.qcds = [fixedQcd(2026, 50_000)];
    const y26 = yearOf(runProjection(data), 2026);
    const ledger = y26.accountLedgers[IRA];

    expect(y26.qcds?.[0].qualifying).toBe(50_000);
    expect(ledger.qcdAmount).toBe(50_000);
    // The QCD covered the minimum; the household gets only what is left.
    expect(ledger.rmdAmount).toBe(50_000);
    expect(ledger.endingValue).toBe(0);
  });

  describe("carries on with the surviving spouse", () => {
    const married = (beneficiaryFmId: string): ClientData => {
      const data = baseData({ planEndYear: 2035 });
      data.client = {
        ...data.client,
        filingStatus: "married_joint",
        lifeExpectancy: 79, // dies 2030 (first death)
        spouseName: "Spouse",
        spouseDob: "1953-01-01", // 70½ well before 2031
        spouseLifeExpectancy: 95,
      };
      data.familyMembers = [
        ...(data.familyMembers ?? []),
        {
          id: SPOUSE_FM_ID, firstName: "Spouse", lastName: "Test",
          relationship: "other", role: "spouse", dateOfBirth: "1953-01-01",
        } as FamilyMember,
        {
          id: KID_FM_ID, firstName: "Alice", lastName: "Test",
          relationship: "child", role: "child", dateOfBirth: "2000-01-01",
        } as FamilyMember,
      ];
      const beneficiary: BeneficiaryRef = {
        id: "bref-1", tier: "primary", percentage: 100,
        familyMemberId: beneficiaryFmId, sortOrder: 0,
      };
      data.accounts = data.accounts.map((a) =>
        a.id === IRA ? { ...a, beneficiaries: [beneficiary] } : a,
      );
      data.qcds = Array.from({ length: 10 }, (_, i) => fixedQcd(2026 + i, 10_000));
      return data;
    };

    it("the spouse who takes over the IRA is the giver from the next year", () => {
      const years = runProjection(married(SPOUSE_FM_ID));
      expect(yearOf(years, 2030).qcds?.[0].giver).toBe("client");
      const y31 = yearOf(years, 2031).qcds;
      expect(y31).toHaveLength(1);
      expect(y31![0].giver).toBe("spouse");
      expect(y31![0].qualifying).toBe(10_000);
    });

    it("control: a child who inherits the IRA stops the QCD", () => {
      const years = runProjection(married(KID_FM_ID));
      expect(yearOf(years, 2030).qcds?.[0].giver).toBe("client");
      expect(yearOf(years, 2031).qcds).toBeUndefined();
    });
  });
});
