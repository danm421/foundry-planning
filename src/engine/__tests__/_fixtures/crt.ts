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
const CRT_IRA_ID = "00000000-0000-0000-0000-0000000000c5";
const CRT_INCOME_ID = "00000000-0000-0000-0000-0000000000c6";
const CRT_SALE_TXN_ID = "00000000-0000-0000-0000-0000000000c7";
const CRT_LOWBASIS_ID = "00000000-0000-0000-0000-0000000000cc";
const CRT_EXPENSE_ID = "00000000-0000-0000-0000-0000000000cd";
const SIBLING_TRUST_ID = "00000000-0000-0000-0000-0000000000c8";
const SIBLING_CHECKING_ID = "00000000-0000-0000-0000-0000000000c9";
const HOUSEHOLD_TAXABLE_ID = "00000000-0000-0000-0000-0000000000ca";
const HOUSEHOLD_SALE_TXN_ID = "00000000-0000-0000-0000-0000000000cb";

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
  /**
   * Adds a CRT-owned income row ($40k/yr ordinary, `ownerEntityId` = the CRT).
   *
   * The base fixture has `incomes: []`, which leaves the grantorIncome filter
   * and the household-1040 trust-income loop UNEXECUTED — their §664(c) guards
   * are unreachable, so the suite cannot detect them being removed. Requires
   * `realizationCorpus` for bracket mode to be live.
   */
  crtIncomeRow?: boolean;
  /**
   * Adds a CRT-owned, RMD-enabled traditional IRA AND moves the grantor's DOB
   * back so the client is past RMD start age at inception.
   *
   * Both halves are required: the entity-RMD fork routes on the CLIENT's birth
   * year (projection.ts `ownerBirthYear` falls back to `clientBirthYear` for
   * entity-owned accounts), and the default 1966 DOB puts the client at age 60
   * — under the age-75 start (§ SECURE 2.0, born >= 1960), so `calculateRMD`
   * returns 0 and the fork is never reached. A CRT named as an IRA beneficiary
   * is a standard structure.
   */
  crtIra?: boolean;
  /**
   * Adds a sell transaction for the CRT brokerage in `inceptionYear + 1` with a
   * $1M built-in gain. Requires `realizationCorpus` (that opt creates the
   * account being sold).
   *
   * This is the canonical CRT structure: contribute low-basis stock, let the
   * trust sell it tax-free under §664(c), diversify the proceeds.
   */
  crtSale?: boolean;
  /**
   * Adds an ORDINARY (non-CRT) irrevocable non-grantor trust with its own
   * checking, plus a household-owned brokerage sold the same year as `crtSale`
   * for a $500k gain.
   *
   * Without a sibling non-grantor trust the whole `nonGrantorTrusts.length > 0`
   * block never runs, so the §664(c) guard on the sale-gain → 1041 hand-off is
   * unreachable and cannot be mutation-tested. The household gain is the
   * observable: if the CRT's exempt gain wrongly enters `assetTransactionGains`
   * it gets subtracted from a household total it was never added to, silently
   * wiping out tax on the household's OWN gain.
   *
   * Combine with `crtSale` + `realizationCorpus`.
   */
  siblingNonGrantorTrust?: boolean;
  /**
   * Adds a CRT-owned ZERO-basis brokerage plus a CRT-owned expense large enough
   * to drive the CRT's checking negative in `inceptionYear`.
   *
   * That forces the step-12c entity gap-fill to liquidate the zero-basis
   * brokerage, which defers the realized gain to the FOLLOWING year's
   * carry-in drain — the only producer of `deferredEntityLiquidationGains`, and
   * therefore the only way to reach the §664(c) guard on that fork. (A plain
   * sale does NOT reach it: sales flow through `saleResult`, not the gap-fill.)
   *
   * The zero basis is load-bearing: `realizationCorpus`'s brokerage has
   * basis == value and its 100%-ordinary realization raises basis in lockstep
   * with growth, so liquidating it realizes no gain and the carry-in is never
   * pushed. For the same reason do NOT combine this with `realizationCorpus`:
   * the entity withdrawal strategy drains that basis==value brokerage first and
   * absorbs the whole shortfall at zero gain. This opt seeds `taxYearRows` on
   * its own so it doesn't need `realizationCorpus` to reach bracket mode.
   */
  crtGapFill?: boolean;
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

  // Grantor DOB: 1966-01-01 → age 60 at inception=2026. If grantorDeathYear
  // is set, configure lifeExpectancy so the death-event fires that year.
  //
  // crtIra moves the DOB back so the client is age 75 at inception — the
  // entity-RMD fork reads the CLIENT's birth year even for a trust-owned
  // account, and at age 60 calculateRMD returns 0 and the fork never runs.
  const grantorBirthYear = opts.crtIra ? opts.inceptionYear - 75 : 1966;
  const grantorDob = `${grantorBirthYear}-01-01`;
  const lifeExpectancy =
    opts.grantorDeathYear != null
      ? opts.grantorDeathYear - grantorBirthYear
      : undefined;

  const familyMembers: FamilyMember[] = [
    {
      id: CLIENT_FM_ID,
      firstName: "Crt",
      lastName: "Grantor",
      relationship: "other",
      role: "client",
      dateOfBirth: grantorDob,
    } as FamilyMember,
  ];

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
      ...(opts.crtIra
        ? [
            {
              id: CRT_IRA_ID,
              name: "CRT Inherited IRA",
              category: "retirement",
              subType: "traditional_ira",
              value: 500_000,
              basis: 0,
              growthRate: 0,
              rmdEnabled: true,
              isDefaultChecking: false,
              owners: [{ kind: "entity", entityId: CRT_ENTITY_ID, percent: 1 }],
            } as ClientData["accounts"][number],
          ]
        : []),
      ...(opts.crtGapFill
        ? [
            {
              id: CRT_LOWBASIS_ID,
              name: "CRT Concentrated Stock",
              category: "taxable",
              subType: "brokerage",
              value: 1_000_000,
              basis: 0,
              growthRate: 0,
              rmdEnabled: false,
              isDefaultChecking: false,
              owners: [{ kind: "entity", entityId: CRT_ENTITY_ID, percent: 1 }],
            } as ClientData["accounts"][number],
          ]
        : []),
      ...(opts.siblingNonGrantorTrust
        ? [
            {
              id: SIBLING_CHECKING_ID,
              name: "Family Trust Checking",
              category: "cash",
              subType: "checking",
              value: 100_000,
              basis: 100_000,
              growthRate: 0,
              rmdEnabled: false,
              isDefaultChecking: true,
              owners: [{ kind: "entity", entityId: SIBLING_TRUST_ID, percent: 1 }],
            } as ClientData["accounts"][number],
            {
              id: HOUSEHOLD_TAXABLE_ID,
              name: "Personal Brokerage",
              category: "taxable",
              subType: "brokerage",
              value: 1_000_000,
              basis: 500_000,
              growthRate: 0,
              rmdEnabled: false,
              isDefaultChecking: false,
              owners: [
                { kind: "family_member", familyMemberId: CLIENT_FM_ID, percent: 1 },
              ],
            } as ClientData["accounts"][number],
          ]
        : []),
    ],
    incomes: opts.crtIncomeRow
      ? ([
          {
            id: CRT_INCOME_ID,
            name: "CRT royalty stream",
            type: "other",
            taxType: "ordinary_income",
            annualAmount: 40_000,
            growthRate: 0,
            startYear: opts.inceptionYear,
            endYear: planEnd,
            ownerEntityId: CRT_ENTITY_ID,
          },
        ] as unknown as ClientData["incomes"])
      : [],
    expenses: opts.crtGapFill
      ? ([
          {
            id: CRT_EXPENSE_ID,
            type: "other",
            name: "CRT trustee + settlement costs",
            // Exceeds the CRT checking (= inceptionValue) on its own, so the
            // checking goes negative in inceptionYear and step-12c liquidates
            // the zero-basis brokerage to refill it.
            annualAmount: opts.inceptionValue + 500_000,
            startYear: opts.inceptionYear,
            endYear: opts.inceptionYear,
            growthRate: 0,
            ownerEntityId: CRT_ENTITY_ID,
            cashAccountId: CRT_CHECKING_ID,
          },
        ] as unknown as ClientData["expenses"])
      : [],
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
      ...(opts.siblingNonGrantorTrust
        ? [
            {
              id: SIBLING_TRUST_ID,
              name: "Family Trust",
              entityType: "trust",
              isIrrevocable: true,
              isGrantor: false,
              includeInPortfolio: false,
              grantor: "client",
            } as unknown as NonNullable<ClientData["entities"]>[number],
          ]
        : []),
    ],
    deductions: [],
    // Bracket mode must be live for any §664(c) tax assertion — without
    // taxYearRows the engine silently falls back to flat-0 and computes no tax
    // at all, which reads identically to an exemption that works.
    ...(opts.realizationCorpus || opts.crtGapFill
      ? { taxYearRows: [TAX_YEAR_2026] }
      : {}),
    transfers: [],
    assetTransactions: [
      ...(opts.crtSale
        ? [
            {
              id: CRT_SALE_TXN_ID,
              name: "CRT diversifying sale",
              type: "sell",
              year: opts.inceptionYear + 1,
              accountId: CRT_TAXABLE_ID,
              overrideSaleValue: 2_000_000,
              overrideBasis: 1_000_000,
              proceedsAccountId: CRT_CHECKING_ID,
            },
          ]
        : []),
      ...(opts.siblingNonGrantorTrust
        ? [
            {
              id: HOUSEHOLD_SALE_TXN_ID,
              name: "Personal brokerage sale",
              type: "sell",
              year: opts.inceptionYear + 1,
              accountId: HOUSEHOLD_TAXABLE_ID,
              overrideSaleValue: 1_000_000,
              overrideBasis: 500_000,
              proceedsAccountId: HOUSEHOLD_CHECKING_ID,
            },
          ]
        : []),
    ] as unknown as ClientData["assetTransactions"],
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
  CRT_IRA_ID,
  CRT_INCOME_ID,
  CRT_SALE_TXN_ID,
  CRT_LOWBASIS_ID,
  CRT_EXPENSE_ID,
  SIBLING_TRUST_ID,
  SIBLING_CHECKING_ID,
  HOUSEHOLD_TAXABLE_ID,
  HOUSEHOLD_SALE_TXN_ID,
} as const;
