import { termCertainAnnuityFactor } from "@/engine/actuarial/annuity-factors";
import type { ClientData, FamilyMember } from "@/engine/types";
import { TAX_YEAR_2026 } from "./tax-year-2026";

const round2 = (n: number): number => Math.round(n * 100) / 100;

const PUBLIC_CHARITY_ID = "00000000-0000-0000-0000-000000000aaa";
const CLIENT_FM_ID = "00000000-0000-0000-0000-000000000001";
const CRT_ENTITY_ID = "00000000-0000-0000-0000-0000000000c1";
const CRT_CHECKING_ID = "00000000-0000-0000-0000-0000000000c2";
const HOUSEHOLD_CHECKING_ID = "00000000-0000-0000-0000-0000000000c3";
const CRT_TAXABLE_ID = "00000000-0000-0000-0000-0000000000c4";

export interface CrtLifecycleOpts {
  inceptionYear: number;
  /** Required when payoutType='unitrust'. Percent of FMV paid annually to the
   *  income beneficiary (grantor/household). */
  payoutPercent?: number;
  /** Required when payoutType='annuity'. Fixed annual payment to the grantor. */
  payoutAmount?: number;
  termYears: number;
  inceptionValue: number;
  /**
   * Per IRC §1.7520, the §7520 rate equals 120% of the AFR rounded to nearest 0.2%.
   * Default 2.2% so the CRUT example with payoutPercent=6%, termYears=10, $1M
   * inceptionValue yields originalRemainderInterest ≈ 538,615 — the value the
   * inception-deduction sanity test asserts against.
   */
  irc7520Rate?: number;
  /** Years to project past term-end (default 2). */
  trailingYears?: number;
  /** New: choose between CRUT (unitrust) and CRAT (annuity). Defaults to 'unitrust'. */
  payoutType?: "unitrust" | "annuity";
  /** When set, the grantor's lifeExpectancy is configured so the engine
   *  triggers a death event in this year. Used to verify NO §170(f)(2)(B)
   *  recapture fires for CRT (Spec A behavior). */
  grantorDeathYear?: number;
  /**
   * Grantor-trust flag on the CRT entity. Defaults to TRUE to preserve every
   * pre-existing test. Set false to exercise the DEFAULT config the form and
   * solver actually produce (audit F1).
   */
  isGrantor?: boolean;
  /**
   * Adds a taxable brokerage account (100% CRT-owned, 5% growth, 100%-ordinary
   * realization model) ALONGSIDE the CRT checking, and seeds `taxYearRows` so
   * the engine runs in real bracket mode instead of silently falling back to
   * flat-0.
   *
   * Both halves are required to observe §664(c): without the realization model
   * there is no internal income; without taxYearRows there is no tax on it, and
   * a "CRT pays no tax" assertion would pass for the wrong reason.
   *
   * NOTE: this is an ADDITIONAL account — the splitInterest snapshot still
   * reflects `inceptionValue` alone, so the trust's actual corpus is larger than
   * its stated inceptionValue. Don't combine with payment/deduction-amount
   * assertions; use it for TAX assertions.
   */
  realizationCorpus?: boolean;
}

/**
 * Minimal grantor-CRT lifecycle fixture for engine tests:
 *  - single grantor (client only, no spouse), retire@65
 *  - one CRT entity with splitInterest snapshot
 *  - one cash account owned 100% by the CRT, funded with inceptionValue
 *    (also tagged isDefaultChecking so the trust has a checking lookup)
 *  - one household checking account owned by the client
 *  - one external charity (publicly supported)
 *  - flat-tax planSettings (faster engine pass), no inflation
 *
 * The income beneficiary of a CRT is the GRANTOR (household), unlike a CLT
 * where the income beneficiary is the charity. Termination routes remainder
 * corpus to the charity.
 */
export function buildCrtLifecycleFixture(opts: CrtLifecycleOpts): ClientData {
  const irc7520 = opts.irc7520Rate ?? 0.022;
  const planEnd = opts.inceptionYear + opts.termYears + (opts.trailingYears ?? 2);
  const payoutType = opts.payoutType ?? "unitrust";

  // Compute income/remainder split. CRUT: remainder = inceptionValue ×
  // (1 - payoutPercent)^termYears. CRAT: income = payoutAmount × a_n (term-
  // certain annuity factor at §7520 rate). Remainder = inceptionValue −
  // income. The "income" interest here is the value to the grantor (Spec A:
  // not a charitable deduction; the charitable deduction is on the REMAINDER).
  let originalRemainder: number;
  let originalIncome: number;
  if (payoutType === "annuity") {
    if (opts.payoutAmount == null) {
      throw new Error(
        "buildCrtLifecycleFixture: payoutAmount is required when payoutType='annuity'",
      );
    }
    const aN = termCertainAnnuityFactor({
      irc7520Rate: irc7520,
      termYears: opts.termYears,
    });
    originalIncome = round2(opts.payoutAmount * aN);
    originalRemainder = round2(opts.inceptionValue - originalIncome);
  } else {
    if (opts.payoutPercent == null) {
      throw new Error(
        "buildCrtLifecycleFixture: payoutPercent is required when payoutType='unitrust'",
      );
    }
    const remainderFactor = (1 - opts.payoutPercent) ** opts.termYears;
    originalRemainder = round2(opts.inceptionValue * remainderFactor);
    originalIncome = round2(opts.inceptionValue - originalRemainder);
  }

  const familyMembers: FamilyMember[] = [
    {
      id: CLIENT_FM_ID,
      firstName: "Crt",
      lastName: "Grantor",
      relationship: "other",
      role: "client",
      dateOfBirth: "1966-01-01",
    } as FamilyMember,
  ];

  // Grantor DOB: 1966-01-01 → age 60 at inception=2026. If grantorDeathYear
  // is set, configure lifeExpectancy so the death-event fires that year.
  const grantorDob = "1966-01-01";
  const grantorBirthYear = 1966;
  const lifeExpectancy =
    opts.grantorDeathYear != null
      ? opts.grantorDeathYear - grantorBirthYear
      : undefined;

  return {
    client: {
      firstName: "Crt",
      lastName: "Grantor",
      dateOfBirth: grantorDob,
      filingStatus: "single",
      retirementAge: 65,
      planEndAge: 90,
      ...(lifeExpectancy != null ? { lifeExpectancy } : {}),
    },
    accounts: [
      {
        id: HOUSEHOLD_CHECKING_ID,
        name: "Personal Checking",
        category: "cash",
        subType: "checking",
        value: 1_000_000,
        basis: 1_000_000,
        growthRate: 0,
        rmdEnabled: false,
        isDefaultChecking: true,
        owners: [
          { kind: "family_member", familyMemberId: CLIENT_FM_ID, percent: 1 },
        ],
      } as ClientData["accounts"][number],
      {
        id: CRT_CHECKING_ID,
        name: "CRT Checking",
        category: "cash",
        subType: "checking",
        value: opts.inceptionValue,
        basis: opts.inceptionValue,
        growthRate: 0,
        rmdEnabled: false,
        isDefaultChecking: true,
        owners: [
          { kind: "entity", entityId: CRT_ENTITY_ID, percent: 1 },
        ],
      } as ClientData["accounts"][number],
      ...(opts.realizationCorpus
        ? [
            {
              id: CRT_TAXABLE_ID,
              name: "CRT Brokerage",
              category: "taxable",
              subType: "brokerage",
              value: opts.inceptionValue,
              basis: opts.inceptionValue,
              growthRate: 0.05,
              rmdEnabled: false,
              isDefaultChecking: false,
              realization: {
                pctOrdinaryIncome: 1,
                pctLtCapitalGains: 0,
                pctQualifiedDividends: 0,
                pctTaxExempt: 0,
                turnoverPct: 0,
              },
              owners: [{ kind: "entity", entityId: CRT_ENTITY_ID, percent: 1 }],
            } as ClientData["accounts"][number],
          ]
        : []),
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
      planStartYear: opts.inceptionYear,
      planEndYear: planEnd,
      taxEngineMode: "bracket",
      taxInflationRate: 0.025,
      estateAdminExpenses: 0,
      flatStateEstateRate: 0,
    },
    entities: [
      {
        id: CRT_ENTITY_ID,
        name: "Test CRT",
        entityType: "trust",
        trustSubType: "crt",
        isIrrevocable: true,
        isGrantor: opts.isGrantor ?? true,
        includeInPortfolio: false,
        grantor: "client",
        splitInterest: {
          inceptionYear: opts.inceptionYear,
          inceptionValue: opts.inceptionValue,
          payoutType,
          payoutPercent: payoutType === "unitrust" ? opts.payoutPercent! : null,
          payoutAmount: payoutType === "annuity" ? opts.payoutAmount! : null,
          irc7520Rate: irc7520,
          termType: "years",
          termYears: opts.termYears,
          measuringLife1Id: null,
          measuringLife2Id: null,
          charityId: PUBLIC_CHARITY_ID,
          originalIncomeInterest: originalIncome,
          originalRemainderInterest: originalRemainder,
        },
      },
    ],
    deductions: [],
    ...(opts.realizationCorpus ? { taxYearRows: [TAX_YEAR_2026] } : {}),
    transfers: [],
    assetTransactions: [],
    gifts: [],
    giftEvents: [],
    wills: [],
    familyMembers,
    externalBeneficiaries: [
      {
        id: PUBLIC_CHARITY_ID,
        name: "Acme Foundation",
        kind: "charity",
        charityType: "public",
      },
    ],
  } as ClientData;
}

export const CRT_FIXTURE_IDS = {
  PUBLIC_CHARITY_ID,
  CLIENT_FM_ID,
  CRT_ENTITY_ID,
  CRT_CHECKING_ID,
  CRT_TAXABLE_ID,
  HOUSEHOLD_CHECKING_ID,
} as const;
