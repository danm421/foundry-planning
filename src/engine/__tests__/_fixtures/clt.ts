import { termCertainAnnuityFactor } from "@/engine/actuarial/annuity-factors";
import type {
  BeneficiaryRef,
  ClientData,
  FamilyMember,
  Gift,
} from "@/engine/types";

const round2 = (n: number): number => Math.round(n * 100) / 100;

const PUBLIC_CHARITY_ID = "00000000-0000-0000-0000-000000000aaa";
const PRIVATE_CHARITY_ID = "00000000-0000-0000-0000-000000000bbb";
const CLIENT_FM_ID = "00000000-0000-0000-0000-000000000001";
const CHILD_1_FM_ID = "00000000-0000-0000-0000-000000000002";
const CHILD_2_FM_ID = "00000000-0000-0000-0000-000000000003";
const CLT_ENTITY_ID = "00000000-0000-0000-0000-000000000ccc";
const CLT_CHECKING_ID = "00000000-0000-0000-0000-000000000ddd";
const HOUSEHOLD_CHECKING_ID = "00000000-0000-0000-0000-000000000eee";
const REMAINDER_GIFT_ID = "00000000-0000-0000-0000-000000000fff";

export interface CltLifecycleOpts {
  inceptionYear: number;
  /** CLUT path: percent of FMV paid annually. Required when payoutType='unitrust'. */
  payoutPercent: number;
  termYears: number;
  inceptionValue: number;
  charityType: "public" | "private";
  grantorAgi: number;
  /**
   * Per IRC §1.7520, the §7520 rate equals 120% of the AFR rounded to nearest 0.2%.
   * For unit-test reproducibility default to 6% which makes income/remainder
   * splits at payoutPercent=0.06 a meaningful round-trip exercise.
   */
  irc7520Rate?: number;
  /** Years to project past term-end (default 2). */
  trailingYears?: number;
  /**
   * Primary remainder beneficiaries for the CLT (tier="primary"). Each child
   * is created as a family_member; percentages must sum to 100. Defaults to
   * undefined (no designations — Task 10 termination will record an empty
   * distribution).
   */
  remainderBeneficiaries?: Array<{
    childIndex: 1 | 2;
    percentage: number;
  }>;
  /** When set, the grantor's lifeExpectancy is configured so the engine
   * triggers a death event in this year. Used by Task 11+ tests to exercise
   * the §170(f)(2)(B) recapture and grantor flip pipeline. */
  grantorDeathYear?: number;
  /** New: choose between CLUT (unitrust) and CLAT (annuity). Defaults to 'unitrust'. */
  payoutType?: "unitrust" | "annuity";
  /** Required when payoutType='annuity'. Annual fixed payment to charity. */
  payoutAmount?: number;
  /**
   * Grantor-trust flag on the CLT entity. Defaults to TRUE to preserve every
   * pre-existing test. Set false to exercise the DEFAULT config the form and
   * solver actually produce (audit F1).
   */
  isGrantor?: boolean;
}

/**
 * Minimal grantor-CLT lifecycle fixture for engine tests:
 *  - single grantor (client only, no spouse)
 *  - one CLT entity with splitInterest snapshot
 *  - one cash account owned 100% by the CLT, funded with inceptionValue
 *  - one household checking account funded modestly (covers grantor expenses)
 *  - one external charity (publicly supported by default)
 *  - the auto-emitted clt_remainder_interest gift in `gifts`
 *  - flat-tax planSettings (faster engine pass)
 */
export function buildCltLifecycleFixture(opts: CltLifecycleOpts): ClientData {
  const irc7520 = opts.irc7520Rate ?? 0.06;
  const planEnd = opts.inceptionYear + opts.termYears + (opts.trailingYears ?? 2);
  const payoutType = opts.payoutType ?? "unitrust";

  // Compute the original interest split. For unitrust we use the existing
  // (1 - payoutPercent)^n FMV-decay approximation (income + remainder =
  // inceptionValue). For annuity we use the real term-certain annuity
  // factor a_n from Pub 1457 Table B: income = payoutAmount × a_n.
  let originalRemainder: number;
  let originalIncome: number;
  if (payoutType === "annuity") {
    if (opts.payoutAmount == null) {
      throw new Error(
        "buildCltLifecycleFixture: payoutAmount is required when payoutType='annuity'",
      );
    }
    const aN = termCertainAnnuityFactor({
      irc7520Rate: irc7520,
      termYears: opts.termYears,
    });
    originalIncome = round2(opts.payoutAmount * aN);
    originalRemainder = round2(opts.inceptionValue - originalIncome);
  } else {
    const remainderFactor = (1 - opts.payoutPercent) ** opts.termYears;
    originalRemainder = round2(opts.inceptionValue * remainderFactor);
    originalIncome = round2(opts.inceptionValue - originalRemainder);
  }

  const charityId =
    opts.charityType === "public" ? PUBLIC_CHARITY_ID : PRIVATE_CHARITY_ID;

  const familyMembers: FamilyMember[] = [
    {
      id: CLIENT_FM_ID,
      firstName: "Charitable",
      lastName: "Grantor",
      relationship: "other",
      role: "client",
      dateOfBirth: "1970-01-01",
    } as FamilyMember,
  ];

  const remainderRefs = opts.remainderBeneficiaries ?? [];
  if (remainderRefs.length > 0) {
    familyMembers.push(
      {
        id: CHILD_1_FM_ID,
        firstName: "Child",
        lastName: "One",
        relationship: "child",
        role: "child",
        dateOfBirth: "2000-01-01",
      } as FamilyMember,
      {
        id: CHILD_2_FM_ID,
        firstName: "Child",
        lastName: "Two",
        relationship: "child",
        role: "child",
        dateOfBirth: "2002-01-01",
      } as FamilyMember,
    );
  }
  const beneficiaries: BeneficiaryRef[] | undefined =
    remainderRefs.length > 0
      ? remainderRefs.map((r, i) => ({
          id: `bref-${i + 1}`,
          tier: "primary" as const,
          percentage: r.percentage,
          familyMemberId:
            r.childIndex === 1 ? CHILD_1_FM_ID : CHILD_2_FM_ID,
          sortOrder: i,
        }))
      : undefined;

  const remainderGift: Gift = {
    id: REMAINDER_GIFT_ID,
    year: opts.inceptionYear,
    amount: originalRemainder,
    grantor: "client",
    recipientEntityId: CLT_ENTITY_ID,
    useCrummeyPowers: false,
    eventKind: "clt_remainder_interest",
  } as Gift;

  // Grantor DOB: 1970-01-01 → age 56 in 2026. If grantorDeathYear is set,
  // we configure lifeExpectancy so the death-event fires in that year.
  const grantorDob = "1970-01-01";
  const grantorBirthYear = 1970;
  const lifeExpectancy =
    opts.grantorDeathYear != null
      ? opts.grantorDeathYear - grantorBirthYear
      : undefined;

  return {
    client: {
      firstName: "Charitable",
      lastName: "Grantor",
      dateOfBirth: grantorDob,
      filingStatus: "single",
      retirementAge: 67,
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
        owners: [
          { kind: "family_member", familyMemberId: CLIENT_FM_ID, percent: 1 },
        ],
      } as ClientData["accounts"][number],
      {
        id: CLT_CHECKING_ID,
        name: "CLT Checking",
        category: "cash",
        subType: "checking",
        value: opts.inceptionValue,
        basis: opts.inceptionValue,
        growthRate: 0,
        rmdEnabled: false,
        isDefaultChecking: true,
        owners: [
          { kind: "entity", entityId: CLT_ENTITY_ID, percent: 1 },
        ],
      } as ClientData["accounts"][number],
    ],
    incomes: [
      {
        id: "inc-salary",
        name: "Salary",
        type: "salary",
        owner: "client",
        annualAmount: opts.grantorAgi,
        growthRate: 0,
        startYear: opts.inceptionYear,
        endYear: planEnd,
      } as ClientData["incomes"][number],
    ],
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
        id: CLT_ENTITY_ID,
        name: "Test CLT",
        entityType: "trust",
        trustSubType: "clt",
        isIrrevocable: true,
        isGrantor: opts.isGrantor ?? true,
        includeInPortfolio: false,
        grantor: "client",
        ...(beneficiaries ? { beneficiaries } : {}),
        splitInterest: {
          inceptionYear: opts.inceptionYear,
          inceptionValue: opts.inceptionValue,
          payoutType,
          payoutPercent: payoutType === "unitrust" ? opts.payoutPercent : null,
          payoutAmount: payoutType === "annuity" ? opts.payoutAmount! : null,
          irc7520Rate: irc7520,
          termType: "years",
          termYears: opts.termYears,
          measuringLife1Id: null,
          measuringLife2Id: null,
          charityId,
          originalIncomeInterest: originalIncome,
          originalRemainderInterest: originalRemainder,
        },
      },
    ],
    deductions: [],
    transfers: [],
    assetTransactions: [],
    gifts: [remainderGift],
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
      {
        id: PRIVATE_CHARITY_ID,
        name: "Smith Family Foundation",
        kind: "charity",
        charityType: "private",
      },
    ],
  } as ClientData;
}

export const CLT_FIXTURE_IDS = {
  PUBLIC_CHARITY_ID,
  PRIVATE_CHARITY_ID,
  CLIENT_FM_ID,
  CHILD_1_FM_ID,
  CHILD_2_FM_ID,
  CLT_ENTITY_ID,
  CLT_CHECKING_ID,
  HOUSEHOLD_CHECKING_ID,
  REMAINDER_GIFT_ID,
} as const;
