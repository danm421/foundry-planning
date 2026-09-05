import type { TaxResult, TaxYearParameters, IrmaaTier as TaxIrmaaTier } from "../lib/tax/types";
import type { ThresholdFacts } from "../lib/tax/thresholds";
import type { TaxRateStress } from "../lib/tax/rate-stress";
import type { CapAdjustment } from "./contribution-limits";
import type { ClientDeductionRow } from "../lib/tax/derive-deductions";
import type { TrustSubType as LibTrustSubType } from "@/lib/entities/trust";
import type { TrustTaxBreakdown, TrustWarning } from "./trust-tax/types";
import type { AccountOwner } from "./ownership";
import type { EntityCashFlowRow } from "./entity-cashflow";
import type { NoteReceivable } from "./notes-receivable/types";
import type { LiabilityType } from "./liability-kind";
import type { IncomeTaxType } from "./tax-adjustments";

// ── Shared Tax / Medicare Types ──────────────────────────────────────────────

/** Re-export from lib/tax/types where the canonical definition lives. Engine
 *  consumers (medicare.ts, projection.ts) keep importing IrmaaTier from here. */
export type IrmaaTier = TaxIrmaaTier;

/** Re-export from lib/entities/trust where the canonical definition lives.
 *  Engine-internal consumers import TrustSubType from here, not from @/db.
 *  The Drizzle pgEnum in db/schema.ts has a compile-time guard to stay in sync. */
export type TrustSubType = LibTrustSubType;

/** Per-person Medicare coverage configuration captured from the household.
 *  Null fields signal "use the engine default" so that households without
 *  custom overrides get sane national-average projections. */
export interface MedicareCoverage {
  owner: "client" | "spouse";
  enrollmentYear: number | null;            // null → engine uses year person turns 65
  coverageType: "original" | "advantage";
  medigapMonthlyAt65: number | null;        // null → engine uses DEFAULT_MEDIGAP_MONTHLY_AT_BASE_YEAR
  partDPlanMonthlyAt65: number | null;      // null → engine uses DEFAULT_PART_D_PLAN_MONTHLY_AT_BASE_YEAR
  priorYearMagi: number | null;             // null → engine uses projected year-0 MAGI for cold-start
  /** true → ignore priorYearMagi and estimate cold-start MAGI from the projection. */
  estimatePriorYearMagiFromProjection?: boolean;
}

/** Resolved per-person Medicare detail for a single projection year. */
export interface MedicareYearDetail {
  enrolled: boolean;
  age: number;
  partBPremium: number;              // post-IRMAA total
  partBStandardPremium: number;      // pre-IRMAA
  partBIrmaaSurcharge: number;
  partDPremium: number;              // plan + IRMAA
  partDIrmaaSurcharge: number;
  medigapPremium: number;
  totalAnnualCost: number;           // sum of all four above
  sourceYearForIrmaa: number;        // year - 2 (or year if cold-start)
  sourceMagi: number;
  irmaaTier: number;                 // 0..5; 0 = below tier 1
  irmaaFilingStatus: "mfj" | "single";
  headroomToNextTier: number;        // Infinity at top tier
  isColdStart: boolean;              // true if sourceMagi came from priorYearMagi or year-0 fallback
}

// ── Input Types ──────────────────────────────────────────────────────────────

export interface Gift {
  id: string;
  year: number;
  amount: number;
  grantor: "client" | "spouse" | "joint";
  recipientEntityId?: string;
  recipientFamilyMemberId?: string;
  recipientExternalBeneficiaryId?: string;
  useCrummeyPowers: boolean;
  /**
   * Optional event kind for non-outright gifts. Set to
   * 'clt_remainder_interest' on the gift auto-emitted at CLT inception
   * (the present-value remainder portion that consumes lifetime exemption).
   * Default behavior (outright cash/asset gift) leaves this undefined.
   */
  eventKind?: GiftEventKind;
}

export interface WillBequestRecipient {
  recipientKind: "family_member" | "external_beneficiary" | "entity" | "spouse";
  recipientId: string | null;
  percentage: number;
  sortOrder: number;
}

export interface WillBequest {
  id: string;
  name: string;
  kind: "asset" | "liability";
  /** Non-null iff kind === "asset". */
  assetMode: "specific" | "all_assets" | null;
  /** Non-null iff kind === "asset" AND assetMode === "specific". */
  accountId: string | null;
  /** Non-null iff kind === "asset" AND assetMode === "specific" AND the
   *  bequest names a business entity rather than an account. Exactly one of
   *  accountId / entityId is set on a specific asset bequest. Resolves only
   *  against business entities (see business-succession.ts). */
  entityId: string | null;
  /** Non-null iff kind === "liability". */
  liabilityId: string | null;
  /** Unused for liability bequests (recipients carry the split). */
  percentage: number;
  /** Always "always" for liability bequests. */
  condition: "if_spouse_survives" | "if_spouse_predeceased" | "always";
  sortOrder: number;
  recipients: WillBequestRecipient[];
}

export interface WillResiduaryRecipient {
  recipientKind: "family_member" | "external_beneficiary" | "entity" | "spouse";
  recipientId: string | null;
  /** Which tier governs. Omitted = "primary" (back-compat for older rows). */
  tier?: "primary" | "contingent";
  percentage: number;
  sortOrder: number;
}

export interface Will {
  id: string;
  grantor: "client" | "spouse";
  bequests: WillBequest[];
  /** Residuary recipients — where the residue goes after specific bequests.
   *  Empty/undefined = no residuary clause; engine falls back to pro-rata. */
  residuaryRecipients?: WillResiduaryRecipient[];
}

export interface DeathTransfer {
  year: number;
  /** 1 = first death (4b); 2 = final death (4c). */
  deathOrder: 1 | 2;
  deceased: "client" | "spouse";
  /** Source account id for asset transfers; null when this entry represents
   *  a proportional unlinked-liability transfer (see sourceLiabilityId). */
  sourceAccountId: string | null;
  /** Frozen at event time. Null for liability transfers. */
  sourceAccountName: string | null;
  /** Source liability id for unlinked_liability_proportional entries only. */
  sourceLiabilityId: string | null;
  /** Frozen at event time. Null for asset transfers. */
  sourceLiabilityName: string | null;
  /** Source business-entity id for a consolidated business-interest transfer.
   *  Null/undefined for account and liability transfers. When set,
   *  sourceAccountId and resultingAccountId are null and sourceAccountName
   *  carries the business name. */
  sourceEntityId?: string | null;
  via:
    | "titling"
    | "beneficiary_designation"
    | "will"
    | "will_residuary"
    | "will_liability_bequest"
    | "fallback_spouse"
    | "fallback_children"
    | "fallback_other_heirs"
    | "unlinked_liability_proportional"
    | "trust_pour_out";
  recipientKind:
    | "spouse"
    | "family_member"
    | "entity"
    | "external_beneficiary"
    | "system_default";
  recipientId: string | null;
  recipientLabel: string;
  /** Positive for asset transfers; negative for liability transfers. */
  amount: number;
  /** Proportional basis for asset transfers. 0 for liability transfers. */
  basis: number;
  /** Synthetic account id when recipient kept it in household; null otherwise. */
  resultingAccountId: string | null;
  /** Synthetic liability id for family-member recipients of unlinked debt;
   *  null for asset transfers and for external / system_default liability
   *  transfers. */
  resultingLiabilityId: string | null;
  postPayoutGrowthRate?: number;
}

export type DrainKind =
  | "federal_estate_tax"
  | "state_estate_tax"
  | "probate"
  | "admin_expenses"
  | "debts_paid"
  | "ird_tax";

export interface DrainAttribution {
  /** 1 = first death, 2 = final death. */
  deathOrder: 1 | 2;
  /** Mirrors DeathTransfer recipient identification. */
  recipientKind: DeathTransfer["recipientKind"];
  recipientId: string | null;
  drainKind: DrainKind;
  /** Positive amount; the recipient bears this share of the named drain. */
  amount: number;
}

export interface GrossEstateLine {
  /** Display label, e.g. "INV - Client 401k" or "Home (50%)". */
  label: string;
  /** Source account id; null when this line is a liability or entity flat value. */
  accountId: string | null;
  /** Source liability id; null when this line is an asset or entity flat value. */
  liabilityId: string | null;
  /** Source entity id; set only for a business entity's flat-valuation line
   *  (`entity.value`), where accountId and liabilityId are both null. */
  entityId?: string | null;
  /** Effective share of FMV included in this estate line (`amount / fmv`).
   *  0.5 for a pure-joint account at first death; 1.0 for a 100%-included
   *  account; intermediate values when contributions from a family pool and
   *  a rev-trust-grantor entity slice are summed onto the same account.
   *  Stored for display; `amount` is the authoritative dollar figure. */
  percentage: number;
  /** Positive for assets, negative for debts. */
  amount: number;
  /** True when this asset line passes through probate (counts toward
   *  `probateEstate`). Set by `computeProbateEstate`. Always false for
   *  liabilities and non-probate accounts. */
  isProbate: boolean;
  /** Trust name when the source account is tagged into a revocable trust.
   *  Null/undefined otherwise. Carried for the report badge; a tagged line
   *  always has isProbate === false. */
  revocableTrustName?: string | null;
}

export interface EstateTaxResult {
  year: number;
  deathOrder: 1 | 2;
  deceased: "client" | "spouse";

  // Gross Estate
  grossEstateLines: GrossEstateLine[];
  grossEstate: number;

  // Deductions
  estateAdminExpenses: number;
  maritalDeduction: number;          // 0 at final death
  charitableDeduction: number;
  // Debts are already folded into grossEstateLines as negative entries.
  taxableEstate: number;

  // Probate (§2053 administrative expense, additive to estateAdminExpenses)
  probateCostRate: number;
  probateEstate: number;
  probateCost: number;

  // Tentative Tax Base
  adjustedTaxableGifts: number;
  tentativeTaxBase: number;

  // Federal Tax
  tentativeTax: number;
  /** §2001(b)(2) gift tax payable on post-1976 gifts at date-of-death rates,
   *  subtracted from the tentative tax. Zero unless cumulative taxable gifts
   *  exceed the date-of-death basic exclusion. */
  giftTaxPayable: number;
  beaAtDeathYear: number;
  dsueReceived: number;
  applicableExclusion: number;       // BEA + DSUE
  unifiedCredit: number;
  federalEstateTax: number;

  // State Tax
  /** USPS two-letter code; null when no residence state is set. */
  residenceState: import("@/lib/usps-states").USPSStateCode | null;
  /** Effective marginal rate used in fallback mode; otherwise weighted-average bracket rate. */
  stateEstateTaxRate: number;
  stateEstateTax: number;
  /** Full per-state detail for the audit report. Always present. */
  stateEstateTaxDetail: import("@/lib/tax/state-estate").StateEstateTaxResult;
  /** State inheritance-tax result (PA/NJ/KY/NE/MD). Undefined when the
   *  residence state has no inheritance tax. Informational only — does not
   *  drain accounts. */
  stateInheritanceTax?: import("@/lib/tax/state-inheritance").StateInheritanceTaxResult;

  // Totals
  totalEstateTax: number;            // federal + state
  totalTaxesAndExpenses: number;     // totalEstateTax + estateAdminExpenses + probateCost

  /** Per-recipient × drain-kind allocation of the drains that summed into
   *  totalTaxesAndExpenses. Σ amount per drainKind across recipients equals
   *  the drain-kind's band-level total. Residuary-aware: drains paid from
   *  residuary recipients first, falling back to pro-rata-by-asset. */
  drainAttributions: DrainAttribution[];

  // Portability
  dsueGenerated: number;             // first-death only; ported to survivor

  // Payments
  estateTaxDebits: Array<{ accountId: string; amount: number }>;

  // Creditor-payoff (final death only; empty arrays/0 at first death)
  creditorPayoffDebits: Array<{ accountId: string; amount: number }>;
  creditorPayoffResidual: number;
}

/**
 * One ordering of the "both die in year N" hypothetical.
 *
 * - `firstDecedent` identifies whose death is first in this ordering.
 * - `firstDeath` is always present (even for single filers — it is the sole
 *   death event for that case).
 * - `finalDeath` is omitted for single filers and present for married
 *   households.
 * - `totals` are summed across the death events represented by this
 *   ordering (one event for single, two for married).
 */
export interface HypotheticalEstateTaxOrdering {
  firstDecedent: "client" | "spouse";
  firstDeath: EstateTaxResult;
  finalDeath?: EstateTaxResult;
  /** Death-transfer ledger from the first-death event in this ordering.
   *  Mirrors `DeathEventResult.transfers` — always populated. */
  firstDeathTransfers: DeathTransfer[];
  /** Death-transfer ledger from the final-death event. Populated only for
   *  married households (matches the optionality of `finalDeath`). */
  finalDeathTransfers?: DeathTransfer[];
  totals: {
    federal: number;
    state: number;
    admin: number;
    total: number;
  };
}

/**
 * Per-year hypothetical estate-tax snapshot — "both die in year N."
 *
 * - `primaryFirst` is always populated (client-dies-first ordering, or the
 *   sole-death case for single filers).
 * - `spouseFirst` is populated only for married households.
 */
export interface HypotheticalEstateTax {
  year: number;
  primaryFirst: HypotheticalEstateTaxOrdering;
  spouseFirst?: HypotheticalEstateTaxOrdering;
}

export interface FamilyMember {
  id: string;
  /** Household role: "client" / "spouse" are the household principals; "child" / "other"
   *  are dependants. The engine uses this to resolve ownership when translating
   *  "client"-owned and "spouse"-owned accounts to `owners[]` rows. */
  role: "client" | "spouse" | "child" | "other";
  relationship:
    | "child"
    | "stepchild"
    | "grandchild"
    | "great_grandchild"
    | "parent"
    | "grandparent"
    | "sibling"
    | "sibling_in_law"
    | "child_in_law"
    | "niece_nephew"
    | "aunt_uncle"
    | "cousin"
    | "grand_aunt_uncle"
    | "other";
  firstName: string;
  lastName: string | null;
  dateOfBirth: string | null;
  /** NJ/MD recognize as spouse-equivalent for inheritance tax. Loader always
   *  populates this from `domestic_partner`; left optional so older test
   *  fixtures continue to typecheck. Defaults to `false` semantically. */
  domesticPartner?: boolean;
  /** Per-state explicit override — `{ NJ: "C" }` forces NJ Class C for this
   *  person. Loader always populates this from `inheritance_class_override`;
   *  left optional so older test fixtures continue to typecheck. Defaults to
   *  `{}` semantically. */
  inheritanceClassOverride?: Partial<Record<"PA" | "NJ" | "KY" | "NE" | "MD", "A" | "B" | "C" | "D">>;
  /**
   * Advisor override for "is this person claimed as a dependent on the
   * household's return". `"auto"` (the default, and what an absent value means)
   * infers it: a child/stepchild under 17 in the tax year is a qualifying child
   * for IRC 24. `"no"` excludes the person outright. `"yes"` is what makes a
   * NON-qualifying-child (an adult child, a parent, an over-17 student) count
   * for the IRC 24(h)(4) $500 Other Dependent Credit. Optional so existing
   * fixtures keep compiling — read with `?? "auto"`.
   */
  claimedAsDependent?: "auto" | "yes" | "no";
}

export type GiftEventKind = "outright" | "clt_remainder_interest";

export type GiftEvent =
  | {
      kind: "cash";
      year: number;
      amount: number;
      grantor: "client" | "spouse" | "joint";
      /** Set only when the recipient is a modeled trust entity. Absent for
       *  cash gifts to family members / external beneficiaries — those have no
       *  in-projection account to credit; the cash simply leaves the household. */
      recipientEntityId?: string;
      /** Set when the recipient is a family member (not a modeled trust entity). */
      recipientFamilyMemberId?: string;
      /** Set when the recipient is an external beneficiary (charity etc.). */
      recipientExternalBeneficiaryId?: string;
      sourceAccountId?: string;
      /** Originating gift row id. Lets a single gift's full event footprint be
       *  stripped surgically when that gift is edited/removed/toggled in the
       *  solver. Series occurrences use `seriesId`; bundled liabilities use
       *  `parentGiftId`. */
      sourceGiftId?: string;
      useCrummeyPowers: boolean;
      seriesId?: string; // present on fanned-out series occurrences
      /** Set on cash gifts auto-synthesized from a life-insurance policy whose
       *  premiumPayer ≠ owner. Used to strip + re-derive these idempotently. */
      sourcePolicyAccountId?: string;
      eventKind?: GiftEventKind;
    }
  | {
      kind: "asset";
      year: number;
      accountId: string;
      percent: number; // 0.0001..1
      grantor: "client" | "spouse";
      /** Set only for a modeled trust-entity recipient. For gifts to a person /
       *  charity exactly one of the two sibling ids below is set instead. */
      recipientEntityId?: string;
      recipientFamilyMemberId?: string;
      recipientExternalBeneficiaryId?: string;
      amountOverride?: number; // if advisor provided a manual amount
      /** Originating gift row id. Lets a single gift's full event footprint be
       *  stripped surgically when that gift is edited/removed/toggled in the
       *  solver. Series occurrences use `seriesId`; bundled liabilities use
       *  `parentGiftId`. */
      sourceGiftId?: string;
      eventKind?: GiftEventKind;
    }
  | {
      kind: "liability";
      year: number;
      liabilityId: string;
      percent: number;
      grantor: "client" | "spouse";
      recipientEntityId?: string;
      recipientFamilyMemberId?: string;
      recipientExternalBeneficiaryId?: string;
      parentGiftId: string;
      eventKind?: GiftEventKind;
    }
  | {
      kind: "business_interest";
      year: number;
      entityId: string; // business being gifted
      percent: number; // fraction 0.0001..1
      grantor: "client" | "spouse";
      recipientEntityId: string; // receiving trust
      amountOverride?: number;
      /** Originating gift row id. Lets a single gift's full event footprint be
       *  stripped surgically when that gift is edited/removed/toggled in the
       *  solver. Series occurrences use `seriesId`; bundled liabilities use
       *  `parentGiftId`. */
      sourceGiftId?: string;
      eventKind?: GiftEventKind;
    };

export interface ExternalBeneficiary {
  id: string;
  name: string;
  kind: "charity" | "individual";
  charityType: "public" | "private";
}

export interface ClientData {
  client: ClientInfo;
  accounts: Account[];
  incomes: Income[];
  expenses: Expense[];
  liabilities: Liability[];
  savingsRules: SavingsRule[];
  withdrawalStrategy: WithdrawalPriority[];
  planSettings: PlanSettings;
  entities?: EntitySummary[];
  /** Phase 2: per-year overrides scoped to the active scenario. Empty/undefined
   *  means every entity uses its base flow values everywhere. */
  entityFlowOverrides?: EntityFlowOverride[];
  /** Parallel of entityFlowOverrides for business-as-asset accounts
   *  (category = 'business', top-level). Empty/undefined means every business
   *  account uses annual+growth from its income/expense rows. */
  accountFlowOverrides?: AccountFlowOverride[];
  /** IRS-published tax year parameters seeded from the DB. Empty = flat-mode fallback. */
  taxYearRows?: TaxYearParameters[];
  /** Itemized deduction line items (charitable, SALT, mortgage interest, etc.). */
  deductions?: ClientDeductionRow[];
  /** Advisor-entered income that already happened — feeds the tax engine and
   *  never the cash flow. See `src/engine/tax-adjustments.ts`. */
  taxAdjustments?: import("./tax-adjustments").TaxAdjustmentRow[];
  /** Transfer techniques — move value between accounts with tax implications. */
  transfers?: Transfer[];
  /** Roth conversion techniques — multi-source, strategy-driven Trad → Roth conversions. */
  rothConversions?: RothConversion[];
  /** Asset buy/sell transactions — acquire or dispose of assets in specific years. */
  assetTransactions?: AssetTransaction[];
  /** Relocation techniques — household moves to a different state in a chosen
   *  year; state income + estate/inheritance tax reflect it from that year on. */
  relocations?: Relocation[];
  /** Equity-compensation plans (stock_options accounts). The engine expands
   *  grants + strategy into per-year vest/exercise/sale events. */
  stockOptionPlans?: import("./equity/types").StockOptionPlan[];
  /** Reinvestment techniques — change asset mix / growth rate of accounts in a future year. */
  reinvestments?: Reinvestment[];
  /** Gifts made by the client or spouse. */
  gifts?: Gift[];
  /** Structured gift events (cash / asset / liability) fanned out from DB rows + gift_series.
   *  Populated by the T5 loader. Engine gift-tax module consumes these. */
  giftEvents: GiftEvent[];
  /** Wills per grantor — spec 4a data-only. Engine consumption arrives in spec 4b. */
  wills?: Will[];
  /** Family members (children, grandchildren, parents, siblings). Consumed by the
   *  death-event module to resolve fallback tier 2 (even split among living children)
   *  and for recipient-label lookups. */
  familyMembers?: FamilyMember[];
  /** External beneficiaries (charities and non-family individuals) configured on the
   *  client. The death-event module uses these for recipient resolution. */
  externalBeneficiaries?: Array<{ id: string; name: string; kind: "charity" | "individual"; charityType: "public" | "private" }>;
  /** Notes receivable — installment sale promissory notes held by the household
   *  (or by an entity, with the trust-side outflow drained from a linked trust).
   *  Each note amortizes on a fixed schedule and produces interest income +
   *  installment-sale principal (basis recovery + §1(h) LTCG) per IRC §453.
   *  Engine consumption arrives in spec 2025-04-notes-receivable-installment. */
  notesReceivable?: NoteReceivable[];
  /** Disability income policies. Client-level facts, not scenario-scoped —
   *  they carry no scenario_id and are absent from promote-table-registry.
   *  Consumed only when `planSettings.disabilityEvent` is set. */
  disabilityPolicies?: DisabilityPolicy[];
  /** Per-person Medicare coverage overrides. Empty/undefined = use defaults for all enrolled persons. */
  medicareCoverage?: MedicareCoverage[];
  /** Annual rate at which Medicare premiums inflate forward from their base year.
   *  null = use DEFAULT_MEDICARE_PREMIUM_INFLATION_RATE (3% per year). */
  medicarePremiumInflationRate?: number;
  /** When true, Part B / Part D national base / IRMAA bracket dollars inflate
   *  forward from the latest seeded year using `medicarePremiumInflationRate`,
   *  matching the existing Medigap/Part D plan treatment. When false, those
   *  values pass through unchanged (legacy behavior). Default true. */
  medicarePremiumInflationEnabled?: boolean;
}

/** 'annual' uses base+growth math; 'schedule' uses entity_flow_overrides
 *  exclusively (missing cells = 0). Mirrored as the `entity_flow_mode` enum. */
export type EntityFlowMode = "annual" | "schedule";

// Minimal entity view used by the engine to decide cash-flow treatment of entity-owned
// accounts, incomes, expenses, and liabilities.
export interface EntitySummary {
  id: string;
  // Display name for UI surfaces. Optional because some engine call sites build
  // EntitySummary arrays directly (death-event, projection, adjusted-taxable-gifts)
  // and don't need to surface a name.
  name?: string;
  // When true, the entity's accounts are rolled into the household's portfolio assets view.
  includeInPortfolio: boolean;
  /** When true and includeInPortfolio is false, the entity's portfolio share
   *  surfaces in the "Accessible Trust Assets" column on the cashflow drill.
   *  Defaults to false. Meaningful only for non-revocable trusts. */
  accessibleToClient?: boolean;
  // When true, taxes on the entity's income and RMDs are paid at the household rate.
  isGrantor: boolean;
  /** Trust-level Crummey (annual-exclusion withdrawal) powers. Sourced from
   *  entities.crummey_powers. Read by the premium-gift synthesizer to decide
   *  whether premium gifts to this trust qualify for the annual exclusion. */
  crummeyPowers?: boolean;
  /** Trust-only. When set, grantor-trust treatment applies only through this year (inclusive). */
  grantorStatusEndYear?: number;
  beneficiaries?: BeneficiaryRef[];
  // Item 2 additions (data-only; no engine rule reads these yet):
  trustSubType?: TrustSubType;
  isIrrevocable?: boolean;
  trustee?: string;
  exemptionConsumed?: number;
  /** Single household grantor — "client" | "spouse". Undefined means the
   *  trust was funded by a third party (e.g., parent-funded trust for the
   *  client). 4d-1 replaces the prior `grantors: {name, pct}[]` list. */
  grantor?: "client" | "spouse";
  // Trust distribution policy fields (non-grantor trusts only).
  entityType?: "trust" | "llc" | "s_corp" | "c_corp" | "partnership" | "other" | "foundation";
  distributionMode?: "fixed" | "pct_liquid" | "pct_income" | null;
  distributionAmount?: number | null;
  distributionPercent?: number | null;
  /** Phase 3: business-entity tax treatment (one selector per entity).
   *  Maps to existing taxDetail buckets:
   *    qbi → taxDetail.qbi
   *    ordinary → taxDetail.ordinaryIncome
   *    non_taxable → taxDetail.taxExempt
   *  Trusts ignore this field (they keep their 1041 / grantor pass). */
  taxTreatment?: "qbi" | "ordinary" | "non_taxable";
  /** Phase 3: business-entity distribution policy. Fraction (0-1) of net
   *  income flowing to household checking each year. Null defaults to 1.0
   *  (full pass-through). Trusts use distributionMode/Amount/Percent
   *  instead — this field is ignored for entityType === 'trust'. */
  distributionPolicyPercent?: number | null;
  /** 'annual' = engine reads income/expense rows (annualAmount + growthRate)
   *  and distributionPolicyPercent. 'schedule' = engine reads
   *  entityFlowOverrides exclusively; missing/null cells resolve to 0
   *  (no fall-through to base+growth). Defaults to 'annual'. */
  flowMode?: EntityFlowMode;
  incomeBeneficiaries?: Array<{
    familyMemberId?: string;
    externalBeneficiaryId?: string;
    entityId?: string;
    householdRole?: "client" | "spouse";
    percentage: number;
  }>;
  /** Trust remainder-tier beneficiaries. Data-only — populated by the loader
   *  for reporting; no projection rule reads it. */
  remainderBeneficiaries?: RemainderBeneficiaryRef[];
  trustEnds?: "client_death" | "spouse_death" | "survivorship" | null;
  /** Business-entity flat valuation (LLC / S-Corp / C-Corp / partnership /
   *  other). Surfaces on the balance sheet and counts toward the in-estate
   *  total proportional to family-member ownership. Zero / undefined for
   *  trusts and foundations, which hold value via accounts. */
  value?: number;
  /** Cost basis for the business-entity flat valuation. Used at death-event
   *  for step-up analysis. */
  basis?: number;
  /** Annual compound growth rate applied to the business-entity flat
   *  valuation (`value`). Null/undefined defaults to 0 — preserves the
   *  pre-2026 behavior where flat-value growth was unmodeled. Ignored for
   *  trusts and foundations, which track value through accounts. */
  valueGrowthRate?: number | null;
  /** Ownership of a business entity (sourced from entity_owners). Trusts leave
   *  this undefined. Owners may be household family members OR another entity
   *  (e.g. a trust that holds the business). Sum may be < 1 when legacy data
   *  has unassigned slack. */
  owners?: import("./ownership").EntityOwner[];
  /** Frozen split-interest snapshot for CLT and CRT trusts. Populated only when
   *  trustSubType = 'clt' or 'crt'. Captures inception-time inputs and computed
   *  income/remainder interests so engine passes don't recompute mid-projection. */
  splitInterest?: TrustSplitInterestSnapshot;
}

/** Phase 2: per-year override for an entity's flows. Sparse cells — any null
 *  field falls through to the base+growth value (income/expense) or to the
 *  entity's distributionPolicyPercent / 1.0 default (distributionPercent).
 *  Distribution % is ignored for trusts (P3-3 carries through). */
export interface EntityFlowOverride {
  entityId: string;
  year: number;
  incomeAmount?: number | null;
  expenseAmount?: number | null;
  distributionPercent?: number | null;
}

/** Per-year override for a business-as-asset account's flows. Same shape as
 *  EntityFlowOverride but keyed by accountId. Read only when the matching
 *  account has flowMode = 'schedule'; in that mode null income/expense cells
 *  resolve to 0 and a null distributionPercent falls through to
 *  account.distributionPolicyPercent (or 1.0 if that's null). */
export interface AccountFlowOverride {
  accountId: string;
  year: number;
  incomeAmount?: number | null;
  expenseAmount?: number | null;
  distributionPercent?: number | null;
}

export interface TrustSplitInterestSnapshot {
  inceptionYear: number;
  inceptionValue: number;
  payoutType: "unitrust" | "annuity";
  payoutPercent: number | null;
  payoutAmount: number | null;
  irc7520Rate: number;
  termType: "years" | "single_life" | "joint_life" | "shorter_of_years_or_life";
  termYears: number | null;
  measuringLife1Id: string | null;
  measuringLife2Id: string | null;
  charityId: string;
  originalIncomeInterest: number;
  originalRemainderInterest: number;
}

export interface ClientInfo {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  retirementAge: number;
  /** Calendar month (1-12) of retirement start. Used to pro-rate
   *  retirement-linked income/expense items in the retirement year.
   *  Default 1 (January) → no proration, legacy whole-year behavior. */
  retirementMonth?: number;
  planEndAge: number;
  lifeExpectancy?: number;
  spouseName?: string;
  spouseDob?: string;
  spouseRetirementAge?: number;
  /** Spouse equivalent of retirementMonth. */
  spouseRetirementMonth?: number;
  spouseLifeExpectancy?: number | null;
  filingStatus: "single" | "married_joint" | "married_separate" | "head_of_household";
  /**
   * Advisor override for IRC 219(g)(5) "active participant" status — whether
   * the client is covered by a workplace retirement plan, which is what
   * triggers the traditional-IRA deduction phase-out. `"auto"` (the default,
   * and what an absent value means) infers coverage from the year's savings
   * rules; `"yes"`/`"no"` force it. Optional so the several hundred existing
   * fixture construction sites keep compiling — read with `?? "auto"`.
   */
  coveredByWorkplacePlan?: "auto" | "yes" | "no";
  /** Spouse equivalent of `coveredByWorkplacePlan`. Ignored — forced to
   *  "not covered" — on any filing status that is neither married-joint nor
   *  married-separate; see the `coveredSpouse` derivation in projection.ts. */
  spouseCoveredByWorkplacePlan?: "auto" | "yes" | "no";
}

export interface BeneficiaryRef {
  id: string;
  tier: "primary" | "contingent";
  percentage: number;
  familyMemberId?: string;
  externalBeneficiaryId?: string;
  /** Beneficiary is a trust entity (references `entities[].id`). */
  entityIdRef?: string;
  /** Beneficiary is a household principal. */
  householdRole?: "client" | "spouse";
  sortOrder: number;
}

/** Trust remainder-tier beneficiary. Data-only — no engine rule reads this;
 *  surfaced purely for estate reporting (distribution-form widget). The engine
 *  loader populates it separately from `beneficiaries` (which carries only
 *  primary/contingent tiers). */
export interface RemainderBeneficiaryRef {
  familyMemberId?: string;
  externalBeneficiaryId?: string;
  /** Remainder beneficiary is itself a trust entity (references `entities[].id`). */
  entityIdRef?: string;
  householdRole?: "client" | "spouse";
  percentage: number;
  /** How this beneficiary receives their remainder share. Defaults to
   *  "outright" at the schema layer. */
  distributionForm: "in_trust" | "outright";
}

export interface LifeInsuranceCashValueScheduleRow {
  year: number;
  /** Optional per-column overrides. A column is honored only when its
   *  policy-level schedule mode is on. Missing column → see resolver/synthesis. */
  cashValue?: number;
  premiumAmount?: number;
  income?: number;
  deathBenefit?: number;
}

export interface LifeInsurancePolicy {
  faceValue: number;
  costBasis: number;
  premiumAmount: number;
  premiumYears: number | null;
  /** Who funds the premium. "owner" (default) = today's behavior (premium is the
   *  owner's expense). "client" | "spouse" | "both" = the household funds it; when
   *  the owner is a trust/entity or a non-principal individual, the premium is
   *  modeled as a gift to the owner (see synthesizePremiumGifts). */
  premiumPayer: "owner" | "client" | "spouse" | "both";
  policyType: "term" | "whole" | "universal" | "variable";
  termIssueYear: number | null;
  termLengthYears: number | null;
  endsAtInsuredRetirement: boolean;
  cashValueGrowthMode: "basic" | "free_form";
  premiumScheduleMode: "off" | "scheduled";
  deathBenefitScheduleMode: "off" | "scheduled";
  incomeScheduleMode: "off" | "scheduled";
  postPayoutGrowthRate: number;
  /** Model portfolio driving the standalone-mode payout's growth and
   *  realization mix. The loader resolves it into `postPayoutGrowthRate` and
   *  `postPayoutRealization`; the engine reads only the resolved values. */
  postPayoutModelPortfolioId?: string | null;
  /** Resolved tax-realization mix for standalone-mode payouts. When set, the
   *  transformed account is `taxable` (not `cash`) and inherits this mix. */
  postPayoutRealization?: {
    pctOrdinaryIncome: number;
    pctLtCapitalGains: number;
    pctQualifiedDividends: number;
    pctTaxExempt: number;
    turnoverPct: number;
  };
  cashValueSchedule: LifeInsuranceCashValueScheduleRow[];
}

/** A life-insurance death benefit paid out by a death event. */
export interface LifeInsurancePayout {
  /** The policy account id — unchanged across the payout transform. */
  policyId: string;
  /** Face value paid. §101(a): the benefit is income-tax-free. */
  faceValue: number;
}

/** A disability income policy. Unlike life insurance this is NOT an account —
 *  it holds no value and never reaches the balance sheet. It pays only while a
 *  `planSettings.disabilityEvent` is active for the insured person.
 *
 *  `shortTerm` / `longTerm` are null when that layer is absent, so the engine
 *  never has to check a flag AND a block. The DB's has_short_term /
 *  has_long_term booleans collapse into these nulls at the loader boundary. */
export interface DisabilityPolicy {
  id: string;
  name: string;
  /** No "joint" — a disability happens to a person. */
  insured: "client" | "spouse";
  /** "salary" derives covered earnings from the insured's salary income in the
   *  disability start year; "manual" uses `coveredEarningsAmount`. */
  coveredEarningsMode: "salary" | "manual";
  /** Today's-dollars figure. Required when mode is "manual"; ignored otherwise. */
  coveredEarningsAmount: number | null;
  shortTerm: {
    eliminationDays: number;
    benefitPct: number;
    /** Measured FROM THE DATE OF DISABILITY, not from the first paid day.
     *  Paid weeks = durationWeeks − eliminationDays/7. */
    durationWeeks: number;
    monthlyMax: number | null;
  } | null;
  longTerm: {
    eliminationDays: number;
    benefitPct: number;
    monthlyMax: number | null;
    benefitPeriod:
      | { mode: "to_age"; age: number }
      | { mode: "to_ssnra" }
      | { mode: "years"; years: number }
      | { mode: "lifetime" };
  } | null;
  /** True when the employer paid the premium (benefit is taxable ordinary
   *  income). False when the insured paid with after-tax dollars (tax-free). */
  benefitTaxable: boolean;
  /** Indexes the benefit from the SECOND disability year onward. 0 = fixed. */
  colaRate: number;
  annualPremium: number;
  premiumPayer: "employer" | "insured";
}

export interface Account {
  id: string;
  name: string;
  category: "taxable" | "cash" | "retirement" | "annuity" | "real_estate" | "business" | "life_insurance" | "notes_receivable" | "stock_options" | "education_savings";
  subType: string;
  value: number;
  basis: number;
  /**
   * For 401k/403b accounts only: the Roth-designated portion of `value`.
   * Grows proportionally with the account and is excluded from ordinary-income
   * tax on withdrawal / Roth conversion (pro-rata). Optional — undefined or
   * 0 means a regular pre-tax 401k/403b. Always 0 for non-401k/403b
   * subtypes (the engine ignores it there).
   */
  rothValue?: number;
  /**
   * HSA coverage tier. Present only when `subType === "hsa"`; drives the
   * contribution cap (self vs family limit). Undefined → treated as "self"
   * (the conservative lower cap) by the engine.
   */
  hsaCoverage?: "self" | "family";
  /**
   * Present only for `category === "education_savings"` (529) accounts.
   * These accounts carry no `account_owners` rows — the loader synthesizes a
   * single `external_beneficiary` sentinel owner (see
   * `EDUCATION_529_SENTINEL_OWNER_ID` in engine/ownership.ts) that weighs 0 in
   * every ownership-driven aggregation. This block is the authoritative
   * grantor/beneficiary/Roth-rollover data instead.
   */
  education529?: {
    grantorFamilyMemberId?: string | null;
    grantorName?: string | null;
    beneficiaryFamilyMemberId?: string | null;
    beneficiaryName?: string | null;
    rothRolloverEnabled?: boolean;
    rothRolloverStartYear?: number | null;
    rothRolloverAccountId?: string | null;
  };
  growthRate: number;
  rmdEnabled: boolean;
  /**
   * Optional override of the prior calendar-year-end balance used for the
   * first projection year's RMD calculation. Set when the user-entered
   * `value` is not a true Dec-31 snapshot. Ignored after Year 1 — the
   * engine's own end-of-year balances are authoritative.
   */
  priorYearEndValue?: number;
  /**
   * Optional activation year: the account does not exist in the projection
   * before this year, then appears at `value` (a windfall) and behaves
   * normally after. Null / undefined ⇒ active from plan start (default).
   * Resolved from `activationYearRef` at load time; the ref is kept for
   * re-anchoring when household milestones move (see resolveRefYears).
   */
  activationYear?: number | null;
  /** Milestone anchor for `activationYear` (opaque string in the engine; a
   *  `YearRef` in @/lib). Null ⇒ plain calendar-year activation. */
  activationYearRef?: string | null;
  beneficiaries?: BeneficiaryRef[];
  isDefaultChecking?: boolean;
  annualPropertyTax?: number;
  propertyTaxGrowthRate?: number;
  insuredPerson?: "client" | "spouse" | "joint" | null;
  lifeInsurance?: LifeInsurancePolicy;
  /** Annuity contract detail. Present only for `category === "annuity"`.
   *  Drives tax treatment, guarantees, and annuitization in engine/annuity/. */
  annuity?: import("./annuity/types").AnnuityContract;
  // CMA realization model — present when account uses a model portfolio or has overrides
  realization?: {
    pctOrdinaryIncome: number;
    pctLtCapitalGains: number;
    pctQualifiedDividends: number;
    pctTaxExempt: number;
    turnoverPct: number;
  };
  /**
   * Titling form for joint-household accounts. Determines basis step-up
   * behavior at first death — `jtwros` gives a half step-up (decedent's
   * 50% → FMV), `community_property` gives a full step-up on both halves
   * (§1014(b)(6)). Ignored for solo-owned or entity-owned accounts; the
   * engine only consults it when `isJointHousehold(a)` is true. Required
   * (not optional) so call sites never silently default.
   */
  titlingType: "jtwros" | "community_property";
  owners: AccountOwner[];
  /** Set when this account is tagged into a revocable trust (the trust's name).
   *  Null/undefined = not in a revocable trust. Drives probate exclusion in
   *  isNonProbateAccount and the report badge. Does NOT change ownership,
   *  gross-estate inclusion, or will distribution. */
  revocableTrustName?: string | null;
  /**
   * View-only metadata carried through from the DB row (like SavingsRule's
   * startYearRef/growthSource). Engine math NEVER reads these — `growthRate`
   * and `realization` above are already resolved from them at load time. They
   * exist so an editor that rewrites a whole account (the Solver's
   * account-upsert lever) can carry the account's growth BASIS back to the
   * database instead of silently re-defaulting it to the category rate.
   */
  growthSource?: string | null;
  modelPortfolioId?: string | null;
  /** For business-owned child accounts: the id of the parent business account. */
  parentAccountId?: string | null;
  /** Business-as-asset fields. Present only when `category === "business"` and
   *  `parentAccountId == null` (top-level business accounts). Child business
   *  accounts and non-business accounts leave these undefined. */
  businessType?:
    | "sole_prop"
    | "partnership"
    | "s_corp"
    | "c_corp"
    | "llc"
    | "other"
    | null;
  /** Fraction (0-1) of net income flowing to household checking each year.
   *  Null defaults to 1.0 (full pass-through). */
  distributionPolicyPercent?: number | null;
  /** 'annual' = engine reads income/expense rows (annualAmount + growthRate)
   *  and distributionPolicyPercent. 'schedule' = engine reads per-year
   *  overrides exclusively. Defaults to 'annual'. */
  flowMode?: "annual" | "schedule";
  /** Tax treatment of the business' pass-through income.
   *    qbi          → taxDetail.qbi
   *    ordinary     → taxDetail.ordinaryIncome
   *    non_taxable  → taxDetail.taxExempt
   */
  businessTaxTreatment?: "qbi" | "ordinary" | "non_taxable" | null;
}

/** Stress test: one person is disabled from `startYear` through `endYear`.
 *
 *  `endYear` is the LAST disabled year (inclusive), matching every other
 *  start/end window in the engine — the paycheck picks back up the following
 *  January, the policy benefit stops paying, and a waived premium resumes
 *  being billed. Omit it (or null) for a disability that never ends, which is
 *  the original and still the default behavior. */
export interface DisabilityEvent {
  person: "client" | "spouse";
  startYear: number;
  /** Inclusive last disabled year. Null / absent = never recovers. */
  endYear?: number | null;
}

/** A hole punched in a time-windowed row: it pays nothing from `fromYear`
 *  through `throughYear` (both inclusive), then resumes on its original terms.
 *  `throughYear: null` = never resumes.
 *
 *  Honored inside `itemProrationGate`, which every consumer of incomes,
 *  expenses and savings rules runs through — the cash-routing loop, the
 *  tax-base mapping and the display totals alike. That is the whole reason the
 *  suspension lives on the row instead of being filtered per-consumer: the
 *  disability stress test learned the hard way that suppressing a row inside
 *  `computeIncome` only blanks the DISPLAY while cash routing re-derives the
 *  full paycheck from `annualAmount x growth`.
 *
 *  ⚠️ The one consumer that does NOT run through the gate is the deduction
 *  mapping (`ExpenseForDeduction` in lib/tax/derive-deductions.ts), which
 *  hand-copies expense fields and does its own window check. It carries
 *  `suspended` too — keep it that way, or a deductible expense with a hole is
 *  deducted straight through it in silence.
 *
 *  Growth is untouched by the hole: the amount still compounds from
 *  `inflationStartYear ?? startYear`, so a salary resumes at the level it would
 *  have reached had it never stopped.
 *
 *  Set only by the engine / synthesizers (today: the disability stress test).
 *  It is not a persisted column. */
export interface SuspensionWindow {
  fromYear: number;
  /** Inclusive last suspended year. Null = suspended for good. */
  throughYear: number | null;
}

export interface Income {
  id: string;
  type: "salary" | "social_security" | "business" | "deferred" | "capital_gains" | "trust" | "other";
  name: string;
  annualAmount: number;
  startYear: number;
  endYear: number;
  growthRate: number;
  /**
   * Year from which inflation compounds. When set and earlier than startYear,
   * annualAmount is treated as a today's-dollars amount and the engine grows it
   * through the gap. Null → compound only from startYear (current-dollar amount).
   */
  inflationStartYear?: number;
  owner: "client" | "spouse" | "joint";
  claimingAge?: number;
  ownerEntityId?: string;
  /** Business-account owner (business-as-asset model). Mutually exclusive with
   *  ownerEntityId. When set, the income belongs to the named top-level business
   *  account and flows through its distribution policy / tax treatment. */
  ownerAccountId?: string;
  // Cash account this income deposits into. When unset, the engine falls back to the
  // household default checking (or the entity's default checking if ownerEntityId is set).
  cashAccountId?: string;
  taxType?: IncomeTaxType;
  /** Year-by-year amount overrides. When present, bypasses growth-rate calc.
   *  Plain object keyed by year (number). Maps were tried, but they JSON-
   *  serialize to `{}`, which broke client-side projection runs that go
   *  through the projection-data API or a frozen scenario snapshot. */
  scheduleOverrides?: Record<number, number>;
  /** Provenance. "policy" = synthesized from a life-insurance policy's
   *  scheduled income column. Mirrors Expense.source. */
  source?: "manual" | "extracted" | "policy";
  /** When source = "policy", the life-insurance account whose income
   *  schedule produced this synthetic income row. */
  sourcePolicyAccountId?: string;
  /** When set, the disability policy whose benefit produced this row. Kept
   *  separate from `sourcePolicyAccountId` because `withSynthesizedPolicyIncome`
   *  strips every `source === "policy"` row and re-derives from life-insurance
   *  ACCOUNTS — a disability row caught by that filter would vanish. Disability
   *  rows are built inside the engine, after loading, so they never meet it;
   *  this field keeps the two provenances distinguishable regardless. */
  sourceDisabilityPolicyId?: string;
  /** SS-specific. When unset, engine treats as "manual_amount" (legacy). */
  ssBenefitMode?: "manual_amount" | "pia_at_fra" | "no_benefit";
  /** SS-specific. Monthly PIA in today's dollars. Required when ssBenefitMode=pia_at_fra. */
  piaMonthly?: number;
  /** Fraction (0..1) of a deferred income the surviving spouse continues to
   *  receive after the owner's death. null/0 = income simply ends at owner death.
   *  Only honored for type === "deferred" with a single owner. */
  survivorshipPct?: number | null;
  /** §2056(b)(7)(C): a survivor annuity whose only continuing beneficiary is
   *  the surviving spouse is deemed QTIP and offsets its own §2039 inclusion
   *  with a marital deduction at first death by default. Set true to elect OUT —
   *  the PV is then taxed in the first decedent's estate with no offset. */
  survivorAnnuityQtipElectOut?: boolean | null;
  /** Additional months beyond `claimingAge` (0-11). Absent = 0. */
  claimingAgeMonths?: number;
  /** SS-specific. Resolves effective claim age at projection time.
   *  When unset, engine treats as "years" (legacy). */
  claimingAgeMode?: "years" | "fra" | "at_retirement";
  /** Self-employment income flag. When true, the year's amount counts as
   *  net SE earnings for SECA tax (both halves of FICA, plus deductible
   *  half above-line). Does NOT change the cash-flow routing or how the
   *  income shows in totals. Applies typically to schedule C / K-1 SE
   *  streams on `business` type. Absent = treated as W-2-style for tax. */
  isSelfEmployment?: boolean;
  /** When set (only on type === "other"), the income follows this real estate
   *  account's per-year ownership. Consumed by expandLinkedIncomes at the top
   *  of runProjection; the rest of the engine never reads it. */
  linkedPropertyId?: string;
  // ── View-only metadata ─────────────────────────────────────────────
  // Carried through from the DB row so page-level adapters can render
  // milestone-relative editing UI. Engine math ignores these fields.
  startYearRef?: string | null;
  endYearRef?: string | null;
  growthSource?: string | null;
  /** Calendar month (1-12) the whole year's amount lands in, for the solver's
   *  month-by-month view. Null/absent = spread across all twelve months.
   *  Engine math ignores this, like everything else in this block. */
  paymentMonth?: number | null;
  /** Years this row pays nothing before resuming. See `SuspensionWindow`. */
  suspended?: SuspensionWindow | null;
}

export interface Expense {
  id: string;
  type: "living" | "other" | "insurance" | "education";
  name: string;
  annualAmount: number;
  startYear: number;
  endYear: number;
  growthRate: number;
  /** See Income.inflationStartYear. */
  inflationStartYear?: number;
  ownerEntityId?: string;
  /** Business-account owner (business-as-asset model). Mutually exclusive with
   *  ownerEntityId. When set, the expense is incurred by the named top-level
   *  business account and reduces its net income. */
  ownerAccountId?: string;
  // Cash account this expense is paid from.
  cashAccountId?: string;
  deductionType?: "charitable" | "above_line" | "below_line" | "property_tax" | null;
  /** Year-by-year amount overrides. When present, bypasses growth-rate calc. */
  scheduleOverrides?: Record<number, number>;
  /** Provenance. "manual" = user-entered, "extracted" = from a parsed document,
   *  "policy" = synthesized from a life-insurance policy's premium. */
  source?: "manual" | "extracted" | "policy";
  /** When source = "policy", the life-insurance account whose premium produced
   *  this synthetic expense. Used by downstream consumers (cash routing, UI
   *  disambiguation, payout transform) to link the expense to its policy. */
  sourcePolicyAccountId?: string;
  /** Marks the auto-seeded current/retirement living expenses; protected from deletion. */
  isDefault?: boolean;
  /** When set, the engine zeros this expense from the named owner's Medicare
   *  enrollment year onward. Used to flag pre-Medicare health-insurance
   *  expenses so they auto-end when projected Medicare premiums kick in,
   *  preventing double-counting alongside the modeled Medicare cost. */
  endsAtMedicareEligibilityOwner?: "client" | "spouse";
  /** Education-goal: ordered dedicated funding accounts (drawn first, in order). */
  dedicatedAccountIds?: string[];
  /** Education-goal: pay the uncovered goal cost from household cash when true;
   *  otherwise it's an unfunded shortfall. Ignored for non-education rows. */
  payShortfallOutOfPocket?: boolean;
  /** Education-goal free-text labels (no cost-lookup DB in v1). */
  institutionState?: string | null;
  institutionName?: string | null;
  /** Education-goal "For" (student/beneficiary). Attribution only. */
  forFamilyMemberId?: string | null;
  // ── View-only metadata ─────────────────────────────────────────────
  // Carried through from the DB row so page-level adapters can render
  // milestone-relative editing UI. Engine math ignores these fields.
  startYearRef?: string | null;
  endYearRef?: string | null;
  growthSource?: string | null;
  /** Calendar month (1-12) the whole year's amount lands in, for the solver's
   *  month-by-month view. Null/absent = spread across all twelve months.
   *  Engine math ignores this, like everything else in this block. */
  paymentMonth?: number | null;
  /** Advisor-set flag surfacing this expense on the Household Map Goals board.
   *  Presentation only — engine math ignores it. Education rows are treated as
   *  goals regardless of this flag; see src/lib/household-map/goals.ts. */
  isGoal?: boolean;
  /** Living rows only. When true the row spends the household's entire
   *  remaining cash flow in each year it is active, and `annualAmount` is a
   *  floor rather than the amount. Consumed by the surplus-allocation phase in
   *  projection.ts — see `absorbingLivingRow` in ./surplus-spend. */
  absorbsRemainingCashFlow?: boolean;
  /** Years this row costs nothing before resuming. See `SuspensionWindow`.
   *  Today's only writer is waiver of premium on a disability policy whose
   *  stress-test event has an end year. */
  suspended?: SuspensionWindow | null;
}

export interface ExtraPayment {
  id: string;
  liabilityId: string;
  year: number;
  type: "per_payment" | "lump_sum";
  amount: number;
}

export interface Liability {
  id: string;
  name: string;
  balance: number;
  interestRate: number;
  monthlyPayment: number;
  startYear: number;
  startMonth: number; // 1-12
  termMonths: number;
  balanceAsOfMonth?: number;
  balanceAsOfYear?: number;
  linkedPropertyId?: string;
  /** Set by the final-death event (4c) when an unlinked household liability
   *  is distributed proportionally to a family-member heir. Null / absent
   *  for household-originated liabilities. */
  ownerFamilyMemberId?: string;
  isInterestDeductible?: boolean;
  /** When true the schedule writes off whatever balance remains at the end of
   *  the term instead of paying it. Inert on held-flat rows — they build no
   *  schedule. */
  forgiveAtTermEnd?: boolean;
  /** Debt-type discriminator. `credit_card` → held flat (non-amortizing) by
   *  the engine. Null/absent → amortizing term loan (legacy behavior). */
  liabilityType?: LiabilityType | null;
  extraPayments: ExtraPayment[];
  owners: AccountOwner[];
  /** Parent business account: lets a liability hang off the business that
   *  carries it (e.g. an LLC's mortgage on its real estate). Null for
   *  household / individually-owned liabilities. */
  parentAccountId?: string | null;
}

export interface SavingsRule {
  id: string;
  accountId: string;
  annualAmount: number;
  /** When non-null, contribution resolves as ownerSalary × annualPercent per year.
   *  When null, annualAmount is used. Stored as a decimal ratio (0.10 = 10%). */
  annualPercent?: number | null;
  /** When true, the rule contributes the applicable IRS limit for the owner's
   *  age in that year (401k/403b deferral for deferral-group accounts, IRA
   *  base+catch-up for IRA-group accounts). Overrides annualAmount and
   *  annualPercent. Non-retirement subtypes resolve to 0. */
  contributeMax?: boolean;
  /** When true the projection funds this rule's contribution via a waterfall —
   *  first the year's positive net cash flow, then by reducing living expenses —
   *  and never by drawing the withdrawal strategy. Used by the Retirement
   *  Analysis "Minimum Additional Savings" synthetic account and by the Solver's
   *  "minimum additional savings" goal-seek (which DOES persist this flag on a
   *  real account). */
  fundFromExpenseReduction?: boolean;
  /** Fraction (0..1) of the resolved contribution designated Roth. Applies
   *  to 401(k)/403(b) accounts only; null/0 means fully pre-tax. The Roth
   *  slice feeds the account's rothValue and is excluded from the
   *  above-the-line deduction. */
  rothPercent?: number | null;
  /** Whether this contribution counts as an above-the-line deduction.
   *  The derive-deductions logic gates on both subtype eligibility AND this flag. */
  isDeductible: boolean;
  /** When true (default), the engine caps the resolved contribution at the
   *  applicable IRS limit (401k/403b deferral or IRA base+catch-up). When
   *  false, the rule bypasses the cap entirely. */
  applyContributionLimit?: boolean;
  /** Which salaries the percent-of-salary contribution and the employer match
   *  resolve against. "owner" (default) derives one salary from the controlling
   *  family member of the destination account — the historical behaviour, and
   *  the reason a jointly-owned account resolves to zero. "all" sums every
   *  personal salary. "selected" sums `salaryIncomeIds`. */
  salaryBasis?: "owner" | "all" | "selected";
  /** Income ids summed when salaryBasis is "selected". Empty otherwise. */
  salaryIncomeIds?: string[];
  startYear: number;
  endYear: number;
  /** Resolved growth rate for this savings rule (inflation-linked or explicit). */
  growthRate?: number;
  employerMatchPct?: number;
  employerMatchCap?: number;
  /** Flat annual dollar amount. When set, overrides the percentage/cap style. */
  employerMatchAmount?: number;
  /** Year-by-year amount overrides. When present, bypasses growth-rate calc. */
  scheduleOverrides?: Record<number, number>;
  // ── View-only metadata ─────────────────────────────────────────────
  // Carried through from the DB row so page-level adapters can render
  // milestone-relative editing UI. Engine math ignores these fields.
  startYearRef?: string | null;
  endYearRef?: string | null;
  growthSource?: string | null;
}

export interface WithdrawalPriority {
  /** DB row uuid. Present on rows loaded from the database so scenario
   *  edit/remove overlays can match them by id. Optional because the engine
   *  also synthesizes withdrawal strategies on the fly
   *  (buildDefaultWithdrawalStrategy / buildEntityWithdrawalStrategy) where
   *  there is no row id, as do the engine test fixtures. */
  id?: string;
  accountId: string;
  priorityOrder: number;
  startYear: number;
  endYear: number;
}

export interface Transfer {
  id: string;
  name: string;
  sourceAccountId: string;
  targetAccountId: string;
  amount: number;
  mode: "one_time" | "recurring" | "scheduled";
  startYear: number;
  endYear?: number;
  growthRate: number;
  schedules: TransferSchedule[];
  // View-only metadata. Engine math ignores these.
  startYearRef?: string | null;
  endYearRef?: string | null;
}

export interface TransferSchedule {
  year: number;
  amount: number;
}

export interface Reinvestment {
  id: string;
  /** When false, the technique is retained but excluded from the projection
   *  (non-destructive "off" toggle). undefined/true = active. */
  enabled?: boolean;
  name: string;
  /** Accounts this reinvestment retargets. */
  accountIds: string[];
  /** Resolved absolute year the switch takes effect. */
  year: number;
  /** Resolved blended growth rate applied from `year` forward. */
  newGrowthRate: number;
  /** Resolved realization mix for taxable/cash accounts. Undefined leaves the
   *  account's realization untouched (retirement accounts defer tax). */
  newRealization?: Account["realization"];
  /** When true, the switch realizes capital gains on taxable accounts. */
  realizeTaxesOnSwitch: boolean;
  /** Per-account fraction of holdings turned over by the reallocation.
   *  Populated at load time per (reinvestment, account) by `resolveReinvestments`.
   *  Engine multiplies the unrealized gain by this; a missing entry is treated
   *  as 0. */
  soldFractionByAccount: Record<string, number>;
  // View-only metadata. Engine math ignores these.
  yearRef?: string | null;
  targetType?: "model_portfolio" | "custom";
  // ── Resolution INPUTS ──────────────────────────────────────────────
  // The raw form/DB-shaped fields the resolver consumes to (re)compute
  // `newGrowthRate`, `newRealization`, and `soldFractionByAccount`. The
  // engine's projection math NEVER reads these — they exist purely so the
  // scenario overlay can re-resolve the resolved fields above after
  // `applyScenarioChanges` merges a raw-shaped scenario payload onto the
  // effective tree. Carried as metadata, exactly like `targetType`/`yearRef`;
  // no new imports, so engine purity is preserved.
  modelPortfolioId?: string | null;
  customGrowthRate?: number | null;
  customPctOrdinaryIncome?: number | null;
  customPctLtCapitalGains?: number | null;
  customPctQualifiedDividends?: number | null;
  customPctTaxExempt?: number | null;
  /** View/round-trip metadata: the account-group keys this reinvestment
   *  targets (default keys or custom group UUIDs). Engine math NEVER reads
   *  this — `accountIds` is the expanded union computed at load time. Carried
   *  so the form can round-trip the selection and the solver-draft path can
   *  persist the live group reference. */
  groupKeys?: string[];
}

export type RothConversionType =
  | "fixed_amount"
  | "full_account"
  | "deplete_over_period"
  | "fill_up_bracket";

export interface RothConversion {
  id: string;
  /** When false, the technique is retained but excluded from the projection
   *  (non-destructive "off" toggle). undefined/true = active. */
  enabled?: boolean;
  name: string;
  destinationAccountId: string;
  sourceAccountIds: string[];
  conversionType: RothConversionType;
  fixedAmount: number;
  /** Top of the ordinary-income bracket to fill (e.g., 0.22). Used only when
   *  conversionType === "fill_up_bracket". */
  fillUpBracket?: number;
  /** Highest IRMAA tier this conversion may push MAGI into. null/undefined =
   *  uncapped. 0 = stay surcharge-free; 1-4 = stay within that tier. */
  irmaaCapTier?: number | null;
  startYear: number;
  endYear?: number;
  /** Annual indexing rate applied to fixedAmount. Only meaningful for
   *  conversionType === "fixed_amount". */
  indexingRate: number;
  /** When set, indexing compounds from this year. Defaults to startYear. */
  inflationStartYear?: number;
  // View-only metadata.
  startYearRef?: string | null;
  endYearRef?: string | null;
}

export interface AssetTransaction {
  id: string;
  /** When false, the technique is retained but excluded from the projection
   *  (non-destructive "off" toggle). undefined/true = active. */
  enabled?: boolean;
  name: string;
  type: "buy" | "sell";
  year: number;
  // Sale fields
  accountId?: string;
  /** Sell-only. References an existing business account (accounts.category =
   *  'business'). Mutually exclusive with accountId and purchaseTransactionId.
   *  Validated at the API + engine layers. */
  businessAccountId?: string;
  overrideSaleValue?: number;
  overrideBasis?: number;
  transactionCostPct?: number;
  transactionCostFlat?: number;
  proceedsAccountId?: string;
  /** IRC §121 primary-residence exclusion. Engine applies only when this is
   *  true AND the sold account's category is "real_estate". */
  qualifiesForHomeSaleExclusion?: boolean;
  // Buy fields
  assetName?: string;
  assetCategory?: Account["category"];
  assetSubType?: string;
  purchasePrice?: number;
  growthRate?: number;
  basis?: number;
  fundingAccountId?: string;
  mortgageAmount?: number;
  mortgageRate?: number;
  mortgageTermMonths?: number;
  // Resolved at API layer (same as Account.realization)
  realization?: Account["realization"];
  /** Sell-only. References the buy row whose synthetic asset is being sold.
   *  Mutually exclusive with accountId on sells. Null when this is a sell of
   *  an existing real account, or when the referenced buy was deleted (orphan). */
  purchaseTransactionId?: string | null;
  /** Sell-only. Fraction of the source's balance + basis to sell.
   *  null = full sale (today's behavior). 0 < x ≤ 1 = partial. */
  fractionSold?: number | null;
}

export interface Relocation {
  id: string;
  /** When false, the relocation is retained but excluded from the projection
   *  (non-destructive "off" toggle). undefined/true = active. Overlay-only —
   *  base-plan rows never carry this. */
  enabled?: boolean;
  /** Display label for the technique row, e.g. "Move to Florida". */
  name: string;
  /** First full tax year taxed under destinationState (clean annual switch). */
  year: number;
  /** USPS 2-letter code the household relocates to. */
  destinationState: import("@/lib/usps-states").USPSStateCode;
}

export interface PlanSettings {
  flatFederalRate: number;
  flatStateRate: number;
  inflationRate: number;
  planStartYear: number;
  planEndYear: number;
  /** "flat" (default) uses flatFederalRate; "bracket" routes through the bracket engine. */
  taxEngineMode?: "flat" | "bracket";
  /** Annual rate for inflating tax brackets/thresholds beyond the last seeded year. */
  taxInflationRate?: number | null;
  /** Optional ceiling on the federal applicable exclusion (BEA). When set, the
   *  inflation-grown BEA is capped at this dollar amount: a value above today's
   *  $15M grows toward it then freezes; a value below $15M freezes the
   *  exemption at that amount for the whole plan. Null/undefined = uncapped. */
  lifetimeExemptionCap?: number | null;
  /** Plan-start capital-loss carryforward by character (§1212(b)), as a
   *  non-negative LOSS magnitude. Null/absent = start at zero. Seeded from the
   *  client's Schedule D carryover. */
  capitalLossCarryforwardShortTerm?: number | null;
  capitalLossCarryforwardLongTerm?: number | null;
  /** Annual rate for inflating the SS wage base (default: inflationRate + 0.005). */
  ssWageGrowthRate?: number | null;
  /** Lump-sum estate administration expenses (funerals, executor fees, etc.). */
  estateAdminExpenses?: number;
  /** USPS 2-letter code; null = no residence state set (fallback rate may still apply). */
  residenceState?: import("@/lib/usps-states").USPSStateCode | null;
  /** Flat state estate tax rate applied on top of federal estate tax. 0 disables.
   *  Used only when `residenceState` is null/absent. */
  flatStateEstateRate?: number;
  /** Effective tax rate applied to DNI distributed to out-of-household beneficiaries.
   *  Defaults to 0.37 (top federal bracket) when absent. */
  outOfHouseholdRate?: number;
  /** Pre-plan post-1976 cumulative taxable gifts per grantor.
   *  Seed for the gift-tax ledger and §2001(b)(1)(B) tentative-tax-base. */
  priorTaxableGifts?: { client: number; spouse: number };
  /** Flat IRD tax rate applied to pre-tax retirement assets passing to non-spouse,
   *  non-charity beneficiaries at any death event. 0 disables. */
  irdTaxRate?: number;
  /** Probate cost rate (decimal). Applied to the probate estate at each death
   *  event; additive to estateAdminExpenses. 0 disables. */
  probateCostRate?: number;
  /** General PV discount rate for actuarial valuations (e.g. survivor annuities).
   *  Falls back to inflationRate when unset. */
  pvDiscountRate?: number;
  /** 0–1 fraction of unaccounted-for surplus cash flow to spend each year.
   *  Surplus = max(0, surplusBeforeSavings − savings.total − cashGifts).
   *  The spent portion is recorded as a discretionary expense; the remainder
   *  either stays in household checking (default) or transfers to
   *  `surplusSaveAccountId`. Defaults to 0 = save 100% to checking (today's
   *  behavior). */
  surplusSpendPct?: number;
  /** Account that receives the saved (non-spent) portion of surplus each year.
   *  Null/undefined = leave it in household checking (today's behavior). */
  surplusSaveAccountId?: string | null;
  /** When true, every projection year strictly BEFORE the household's first
   *  retirement year spends 100% of surplus regardless of `surplusSpendPct`;
   *  from that retirement year onward `surplusSpendPct` applies as normal.
   *  Defaults to false = today's flat-percentage behavior. */
  surplusSpendAllUntilRetirement?: boolean;
  /** Stress test: cut ALL Social Security benefits by `pct` (decimal) for every
   *  projection year ≥ `startYear`. Applied in computeIncome before taxation. */
  ssBenefitHaircut?: { pct: number; startYear: number };
  /** Stress test: stop one person's earned income (salary + business they own)
   *  from `startYear` forward, modeling a disability. See `DisabilityEvent`. */
  disabilityEvent?: DisabilityEvent;
  /** Stress test: one-time drawdown of market-exposed account balances in `year`
   *  (e.g. drawdownPct 0.30 = −30%). Applied after the growth pass. */
  marketShock?: { year: number; drawdownPct: number };
  /** Stress test: grow `type === "living"` expenses at this rate instead of
   *  their resolved growthRate. Nothing else (tax indexing, incomes, savings,
   *  other expense types) reads it — the "Higher inflation" stressor hits
   *  living costs only. */
  livingExpenseInflationOverride?: number | null;
  /** Stress test: add `points` (a decimal fraction — 0.03 = three percentage
   *  points) to every federal marginal rate for projection years >=
   *  `startYear`. Covers the ordinary, preferential, and trust schedules.
   *  AMT, NIIT, state tax, and every threshold are deliberately unaffected —
   *  see src/lib/tax/rate-stress.ts. */
  taxRateStress?: TaxRateStress;
}

// ── Output Types ─────────────────────────────────────────────────────────────

export interface EducationGoalYear {
  goalId: string;
  /** Dedicated-account balances at the start of the year (before growth). */
  dedicatedAssetsBOY: number;
  /** Growth + savings contributions into the dedicated accounts this year. */
  growthAndSavings: number;
  /** Indexed goal cost for the year. */
  goalExpense: number;
  /** Non-goal changes to the dedicated accounts this year (e.g. a general draw). */
  otherExpenseFlows: number;
  /** Amount drawn from the dedicated accounts for the goal. */
  dedicatedWithdrawal: number;
  /**
   * Portion of the goal cost funded from household cash flow (out-of-pocket) —
   * non-zero only when the goal's `payShortfallOutOfPocket` is set. This is the
   * uncovered amount that WAS funded, as opposed to `shortfall` (unfunded).
   */
  outOfPocketWithdrawal: number;
  /** Dedicated-account balances at year end. */
  dedicatedAssetsEOY: number;
  /**
   * Goal cost that went unfunded — max(0, goalExpense − dedicatedWithdrawal)
   * when `payShortfallOutOfPocket` is off, otherwise 0 (the gap is funded from
   * cash flow and booked as `outOfPocketWithdrawal`).
   */
  shortfall: number;
  /**
   * True for a pre-expense *accumulation* year — a year before the goal is
   * active, emitted so the report chart/table show the dedicated funds growing
   * (goalExpense / dedicatedWithdrawal / shortfall are all 0). Expense years
   * omit this flag. The per-goal Monte Carlo gauge filters these rows out so its
   * probability stays scoped to the expense phase (see education-mc-inputs.ts).
   */
  accumulation?: boolean;
}

export interface ProjectionYear {
  year: number;
  ages: { client: number; spouse?: number };

  /** Present only when one or more `fundFromExpenseReduction` savings rules ran
   *  this year (Retirement Analysis min-savings solve). Lets the UI surface the
   *  funding split without re-deriving it. */
  hypotheticalSavings?: {
    /** Total deposited into the synthetic taxable account this year. */
    contribution: number;
    /** Portion funded from positive net cash flow. */
    fromCashFlow: number;
    /** Portion funded by reducing living expenses. */
    fromExpenseReduction: number;
  };

  income: {
    salaries: number;
    socialSecurity: number;
    business: number;
    trust: number;
    deferred: number;
    capitalGains: number;
    other: number;
    total: number;
    bySource: Record<string, number>;
  };

  /** Per-spouse retirement/spousal/survivor breakdown for SS rows in pia_at_fra mode. */
  socialSecurityDetail?: {
    client:  { retirement: number; spousal: number; survivor: number };
    spouse?: { retirement: number; spousal: number; survivor: number };
  };

  taxDetail?: {
    earnedIncome: number;
    /** Subset of `earnedIncome` bearing no FICA — see
     *  `CalcInput.ficaExemptEarnedIncome`. Absent/0 = all of it is wages. */
    ficaExemptEarnedIncome?: number;
    ordinaryIncome: number;
    dividends: number;
    capitalGains: number;
    stCapitalGains: number;
    qbi: number;
    taxExempt: number;
    /** Municipal-bond interest — broken out from the generic taxExempt total
     *  because it is needed as a MAGI input for IRMAA and for the IRC §86
     *  Social Security combined-income test. Three sources feed it: income
     *  rows classified `taxType: "muni_interest"`, tax adjustments classified
     *  `muni_interest`, and trust pass-through tax-exempt deltas (which
     *  originate from `realization.pctTaxExempt`).
     *
     *  Plain `tax_exempt` is deliberately EXCLUDED — an inheritance, a VA or
     *  disability benefit and a life-insurance payout are tax-free without
     *  being added back for either test. So is generic non-taxable business
     *  pass-through (Roth-equivalent distributions, return-of-capital). All of
     *  those land in `taxExempt` only. */
    taxExemptInterest: number;
    /** Drill-down itemization. `irmaaCapTier` rides on the ROW rather than on
     *  a per-conversion lookup because it is a per-YEAR outcome: the same cap
     *  can bind in 2030 and sit idle in 2031, and the drill's shared context
     *  is built once for every year. Set only on `roth_conversion:<id>` rows
     *  the cap actually limited. `irmaaCapExceeded` rides the same way and
     *  means the OPPOSITE outcome: the cap was named but the household still
     *  finished the year above it. */
    bySource: Record<
      string,
      { type: string; amount: number; irmaaCapTier?: number; irmaaCapExceeded?: boolean }
    >;
    /** End-of-year §1212(b) carryforward, for the drill-down. Post-drawdown:
     *  this year's §1211(b) offset has already been subtracted. */
    capitalLossCarryforward?: { shortTerm: number; longTerm: number };
    /** §1211(b) ordinary-income offset actually taken this year. */
    capitalLossDeduction?: number;
    /** §165(c) losses excluded from netting (personal-use property). Display only. */
    disallowedCapitalLoss?: number;
  };

  /** Per-person Medicare + IRMAA detail. Populated only for years where at
   *  least one household member is enrolled (age ≥ 65 and past the optional
   *  deferred enrollmentYear). */
  medicare?: {
    client?: MedicareYearDetail;
    spouse?: MedicareYearDetail;
    totalAnnualCost: number;
    totalIrmaaSurcharge: number;
  };

  /** Additional tax attributable to this year's equity-comp events, computed
   *  as a tax(actual) − tax(equity-removed) counterfactual. Present only in
   *  years with equity activity. */
  equityTaxImpact?: import("./equity/tax-impact").EquityTaxImpact;

  taxResult?: TaxResult;

  deductionBreakdown?: DeductionBreakdown;

  /**
   * The year's resolved threshold/phase-out inputs — household composition plus
   * each of the four MAGIs, which are NOT interchangeable (IRC 219(g)(3)(A) vs
   * 221(b)(2)(C)). Populated in bracket mode only; flat mode computes none of
   * these figures.
   *
   * `params` is excluded because the Thresholds report already receives the
   * resolved `TaxYearParameters` separately and the object is large. `year` IS
   * kept: it is the REQUESTED year, never `params.year` (which the resolver
   * stamps with the SOURCE year when inflating an out-year forward), and
   * keeping it makes that auditable downstream.
   */
  thresholdFacts?: Omit<ThresholdFacts, "params">;

  /**
   * What the two contribution-limit passes did to this year's savings rules:
   * IRS annual-limit reductions (`reason: "age_limit"`) and IRC 408A(c)(3)
   * Roth-MAGI re-tags (`reason: "roth_magi_backdoor"`, whose per-rule dollars
   * are also in `backdoorByRuleId`). Bracket mode only, and present only in
   * years where something was actually capped or re-tagged.
   *
   * `backdoorByRuleId` is a SLICE of the contribution, never an addition to it:
   * account balances are identical either way, only the tax treatment of the
   * portion that must arrive as a conversion differs. It rides on the
   * projection year because it is resolved against the year's real Roth MAGI,
   * which is only known after the deduction assembly — without it the Roth gate
   * would compute a result no consumer could observe.
   */
  contributionAdjustments?: {
    adjustments: CapAdjustment[];
    backdoorByRuleId: Record<string, number>;
  };

  withdrawals: {
    byAccount: Record<string, number>;
    total: number;
  };

  /** Liquidations triggered by entity gap-fill — when an entity's own
   * checking goes negative we drain the entity's other liquid assets to
   * refill it. Tracked separately from `withdrawals` because the household
   * Net Cash Flow drill is supposed to surface household supplemental
   * withdrawals only; mixing in entity-internal liquidations made the
   * "Withdrawal %" column overstate household stress. */
  entityWithdrawals: {
    byAccount: Record<string, number>;
    total: number;
  };

  expenses: {
    living: number;
    liabilities: number;
    /** Includes education-goal cost paid out of household cash flow
     *  (`payShortfallOutOfPocket`), keyed by the goal's expense id in `bySource`.
     *  The dedicated-account draw is NOT here — it pays the school straight out of
     *  the 529 without touching household cash — and neither is an unfunded
     *  shortfall, which moves no money. See EducationGoalYear. */
    other: number;
    insurance: number;
    realEstate: number;
    taxes: number;
    /** Cash gifts that drained a household-owned account in this year. Already
     *  rolled into `other` and `total`; surfaced separately so the cashflow
     *  report can show a dedicated column under Expenses > Other. */
    cashGifts: number;
    /** Surplus cash flow consumed via the `surplusSpendPct` assumption.
     *  Already rolled into `total`; surfaced separately for the
     *  "Surplus spent" cashflow column. */
    discretionary: number;
    total: number;
    bySource: Record<string, number>;
    byLiability: Record<string, number>;
    interestByLiability: Record<string, number>;
  };

  /** Present only when the plan has education goals with dedicated funding. */
  educationGoals?: EducationGoalYear[];

  savings: {
    byAccount: Record<string, number>;
    total: number;
    employerTotal: number;
  };

  totalIncome: number;
  totalExpenses: number;
  netCashFlow: number;

  portfolioAssets: {
    taxable: Record<string, number>;
    cash: Record<string, number>;
    retirement: Record<string, number>;
    /** Deferred/immediate annuity contract values. Investable like retirement,
     *  so it belongs to liquidTotal — kept in its own bucket because the balance
     *  sheet and the Portfolio Assets drill both show Annuity as its own line. */
    annuity: Record<string, number>;
    realEstate: Record<string, number>;
    business: Record<string, number>;
    lifeInsurance: Record<string, number>;
    /** Not-yet-acquired equity value (unvested RSU FMV + unexercised in-the-money
     *  option intrinsic). Acquired shares live in the destination taxable account,
     *  so the two never overlap in net worth. Illiquid — excluded from liquidTotal. */
    stockOptions: Record<string, number>;
    taxableTotal: number;
    cashTotal: number;
    retirementTotal: number;
    annuityTotal: number;
    realEstateTotal: number;
    businessTotal: number;
    lifeInsuranceTotal: number;
    stockOptionsTotal: number;
    /** Bucket for entity-owned shares where entity is non-IIP and not flagged
     *  accessibleToClient — plus household-owned business-category accounts.
     *  Powers the "Trusts and Businesses" column on the cashflow drill. */
    trustsAndBusinesses: Record<string, number>;
    trustsAndBusinessesTotal: number;
    /** Bucket for entity-owned shares where entity is non-IIP and accessibleToClient.
     *  Powers the "Accessible Trust Assets" column on the cashflow drill. */
    accessibleTrustAssets: Record<string, number>;
    accessibleTrustAssetsTotal: number;
    total: number;
    /** Canonical "Portfolio Assets" reconciling total = liquid investable only:
     *  taxable + cash + retirement + annuity + lifeInsurance + accessibleTrustAssets.
     *  Excludes real estate, business, and locked (non-accessible) trust assets,
     *  which are net-worth not portfolio. Single source of truth for the chart,
     *  the summary cell, and the next-year beginning-of-year carry-forward (H1). */
    liquidTotal: number;
  };

  accountLedgers: Record<string, AccountLedger>;

  /** Per-account basis at beginning of year, before any activity. Used by UI
   * previews (e.g. sale-form autofill) to show projected cost basis. */
  accountBasisBoY: Record<string, number>;

  /** Per-liability balance at beginning of year, before that year's amortization
   * runs. Used by UI previews to show the projected mortgage payoff amount for
   * a given sale year. */
  liabilityBalancesBoY: Record<string, number>;

  /** Per-note-receivable per-year breakdown. Records interest income,
   *  installment-sale principal split (LTCG vs basis recovery), total cash
   *  inflow, and ending balance for each note in this year. Used by the
   *  balance-sheet UI to render the "Notes Receivable" row and by reports
   *  to drill into installment-sale tax detail. Empty when the projection
   *  has no notes_receivable rows. */
  notesReceivableByNote?: Record<string, {
    interest: number;
    principalLTCG: number;
    principalBasis: number;
    totalCashIn: number;
    endingBalance: number;
  }>;

  /** Per-year totals across every note in `notesReceivableByNote`. Reports
   *  read this directly instead of re-aggregating `byNote`. Present only
   *  in years where at least one note contributed. */
  notesReceivableTotals?: {
    interest: number;
    principalLTCG: number;
    principalBasis: number;
    totalCashIn: number;
    /** Family-member-owner share of totalCashIn — the cash that actually hits
     *  household checking and funds household expenses (entity-owner shares route
     *  to entity checking). Reports use this for the funding/inflow stack so the
     *  shortfall reconciles. <= totalCashIn. */
    householdCashIn: number;
  };

  /** Engine-minted accounts not present in ClientData.accounts (equity
   *  destination accounts holding vested shares). Consumers merge these into
   *  tree.accounts before buildViewModelInputs so the balance-sheet and
   *  cash-flow name maps resolve them. */
  syntheticAccounts?: Array<{
    id: string;
    name: string;
    category: string;
    owners: AccountOwner[];
  }>;

  /** Technique breakdown for drill-down UI — only present in years where techniques execute. */
  techniqueBreakdown?: {
    sales: {
      transactionId: string;
      name: string;
      saleValue: number;
      transactionCosts: number;
      mortgagePaidOff: number;
      netProceeds: number;
      capitalGain: number;
    }[];
    purchases: {
      transactionId: string;
      name: string;
      purchasePrice: number;
      mortgageAmount: number;
      equity: number;
      /** Synthetic liability id created for the mortgage, if any. Used by the
       * liabilities drill to label the new-mortgage column. */
      liabilityId?: string;
      /** Display name for the synthetic liability. */
      liabilityName?: string;
    }[];
  };
  /** Per-conversion summary for years where Roth conversions ran. `gross` is
   *  the amount moved out of source IRAs; `taxable` is the ordinary-income
   *  portion (lower than gross when the source has after-tax basis — Form
   *  8606 pro-rata). The Tax Bracket report consumes both columns.
   *
   *  `requested` / `limitedBy` / `irmaaCapTier` say WHY the conversion came
   *  out this size — see `RothConversionOutcome` in `roth-conversions.ts`.
   *  A conversion an IRMAA cap zeroed out appears here with `gross: 0` rather
   *  than being omitted, so the technique reads as "ran, converted nothing"
   *  instead of vanishing from the year. */
  rothConversions?: {
    id: string;
    name: string;
    gross: number;
    taxable: number;
    requested: number;
    limitedBy: "irmaa" | "bracket" | "sources" | null;
    irmaaCapTier?: number | null;
    /** True when the cap named by `irmaaCapTier` did NOT hold at the household
     *  level — see the `irmaa_cap_not_enforced` warning. `limitedBy` stays
     *  "irmaa" because this conversion WAS sized to the ceiling; what failed is
     *  the year's total. Absent means the cap held (or there was no cap). */
    irmaaCapExceeded?: boolean;
  }[];
  /** Only populated on death-event years. One entry per (source × recipient).
   *  Same-year double death (4b + 4c in the same year) produces both
   *  deathOrder = 1 and deathOrder = 2 entries on the same row. */
  deathTransfers?: DeathTransfer[];
  /** Non-fatal warnings emitted by the first-death precedence chain. */
  deathWarnings?: string[];
  /** Estate-tax computation result. Only present in death-event years. */
  estateTax?: EstateTaxResult;
  /** 4d-2: hypothetical estate-tax if both spouses (or the single filer)
   *  died in this year. Attached to every projection year, not only real
   *  death-event years. `spouseFirst` is present only for married
   *  households. */
  hypotheticalEstateTax: HypotheticalEstateTax;
  /** Per-entity trust-tax breakdown. Populated only when non-grantor trusts exist. */
  trustTaxByEntity?: Map<string, TrustTaxBreakdown>;
  /** Per-entity total distribution amount in dollars. Populated for non-grantor
   *  trusts that ran an annual pass this year (mandatory + discretionary).
   *  Sourced from trustPassResult.distributionsByEntity[entityId].drawFromCash.
   *  Excludes grantor-trust distributions (those flow through ledger entries
   *  with category: "expense" / "income") and CLT charity payments
   *  (read charitableOutflowDetail for those). */
  trustDistributionsByEntity?: Map<string, number>;
  /** Per-grantor-entity realized asset-sale capital gain (net of selling costs,
   *  before §121). The gain is taxed on the grantor's household 1040; this map
   *  lets the entity cash-flow rollup + tax ledger surface it in the grantor
   *  trust's own section with an offsetting pass-through. Populated only when
   *  grantor trusts realized a gain this year. */
  grantorCapGainsByEntity?: Map<string, number>;
  /** Per-entity cash-flow rollup. Keyed by entity id. Empty map if no
   *  entities exist or none have activity in this year. */
  entityCashFlow: Map<string, EntityCashFlowRow>;
  /** End-of-year locked share for split-owned accounts: entityId → accountId
   *  → entity's EoY dollar share. Populated only for accounts where the entity
   *  owns < 100%. Household-driven flows on the joint account don't reduce
   *  the entity's locked share. Consumers (balance sheet, reports) should use
   *  this in place of `ledger.endingValue × ownerPercent` to keep the entity
   *  view consistent with the cash-flow report. */
  entityAccountSharesEoY?: Map<string, Map<string, number>>;
  /** End-of-year locked share for jointly-held family-member accounts:
   *  familyMemberId → accountId → that member's EoY dollar share. Populated
   *  only for accounts with ≥2 distinct family-member owners. Attributed
   *  income deposits and cash-gift outflows shift the share; passive growth
   *  and pro-rata withdrawals preserve current proportions. Consumers
   *  (balance sheet) should use this in place of `value × authored ownerPercent`
   *  so projected percentages reflect drift from the original split. */
  familyAccountSharesEoY?: Map<string, Map<string, number>>;
  /** Sum of estimated beneficiary-level tax on distributed DNI to out-of-household beneficiaries. */
  estimatedBeneficiaryTax?: number;
  /** Non-fatal warnings emitted by the trust annual pass. */
  trustWarnings?: TrustWarning[];
  /** IRC §170(b) charitable-deduction carryforward state at end of this year. */
  charityCarryforward?: CharityCarryforward;
  /** Sum of split-interest-trust outflows to charity this year (CLT annual
   * lead payments — unitrust or annuity). 0 in years with no trust-driven
   * charitable flow. */
  charitableOutflows: number;
  /** Per-trust-per-charity breakdown of charitableOutflows. Populated only
   * when charitableOutflows > 0. */
  charitableOutflowDetail?: Array<{
    kind: "clt_payment";
    trustId: string;
    trustName: string;
    charityId: string;
    amount: number;
    payoutType: "unitrust" | "annuity";
  }>;
  /** End-of-term trust termination distributions. One entry per CLT whose
   * lead term ended in the prior year (distributions fire the year after
   * the last lead payment). Populated only in the termination year. */
  trustTerminations?: Array<{
    trustId: string;
    trustName: string;
    totalDistributed: number;
    toBeneficiaries: Array<{
      designationId: string;
      recipientLabel: string;
      familyMemberId?: string;
      externalBeneficiaryId?: string;
      amount: number;
    }>;
  }>;
}

export interface AccountLedger {
  beginningValue: number;
  growth: number;
  contributions: number;
  distributions: number;
  /**
   * Subset of `contributions` / `distributions` that originated from internal
   * portfolio-to-portfolio transfers (supplemental withdrawal refill, entity
   * gap-fill refill). Reports use these to derive "external" flows by
   * subtracting from the gross totals — the supplemental draw against a
   * taxable account and its mirror credit to checking should net to zero in
   * Portfolio Activity rather than show as gross movement on both sides.
   */
  internalContributions: number;
  internalDistributions: number;
  rmdAmount: number;
  fees: number;
  endingValue: number;
  /** Cost basis at the start of the year (post-prior-year mutations,
   * pre-current-year activity). Used by the cash-flow drill-down so an
   * advisor can see embedded gain/loss alongside market value. */
  basisBoY?: number;
  /** Cost basis at the end of the year, after sales, growth realization,
   * contributions, and Roth conversions. Excludes any death-event basis
   * step-up — those land on the next year's BoY. */
  basisEoY?: number;
  /** For 401k/403b only: Roth-designated portion of the balance at the
   * start of the year. The cash-flow ledger renders this in place of
   * basis for those subtypes. */
  rothValueBoY?: number;
  /** For 401k/403b only: Roth-designated portion of the balance at the
   * end of the year, after growth, contributions, withdrawals, and any
   * Roth conversions out have settled. */
  rothValueEoY?: number;
  /**
   * Itemized entries for everything that happened in this account this year,
   * in the order it was applied. Amounts are signed: positive = inflow, negative = outflow.
   */
  entries: AccountLedgerEntry[];
  growthDetail?: {
    ordinaryIncome: number;
    qualifiedDividends: number;
    stCapitalGains: number;
    ltCapitalGains: number;
    taxExempt: number;
    basisIncrease: number;
  };
  /**
   * Per-year realization detail from withdrawals/transfers that left this
   * taxable or cash account. Distinct from `growthDetail.ltCapitalGains`,
   * which is *embedded* appreciation eligible for LTCG when sold;
   * `withdrawalDetail.realizedLtcg` is what was *actually recognized* this
   * year against the 1040.
   */
  withdrawalDetail?: {
    realizedLtcg: number;
    basisReturn: number;
  };
}

export interface AccountLedgerEntry {
  category:
    | "growth"
    | "income"
    | "rmd"
    | "expense"
    | "liability"
    | "tax"
    | "savings_contribution"
    | "employer_match"
    | "withdrawal"
    | "withdrawal_tax"
    | "gift"
    | "entity_distribution"
    | "discretionary"
    | "surplus_transfer"
    | "surplus_retained";
  label: string;
  amount: number;
  sourceId?: string;
  /** True for the source/target legs of pure portfolio-to-portfolio
   * transfers (supplemental withdrawal refill, entity gap-fill refill).
   * Reports filter these out so the same dollars don't appear as both an
   * addition and a distribution at the aggregate level. */
  isInternalTransfer?: boolean;
  /** True for the cash leg of an asset sale (net proceeds credited to a cash
   * account). The entry is an asset→cash conversion, not operating income, so
   * entity income rollups exclude it — the taxable capital gain is recognized
   * separately on the 1040 / 1041. */
  isSaleProceeds?: boolean;
  /** Signed cost-basis delta for this entry. Invariant per account:
   *  basisBoY + Σ entry.basis ≈ basisEoY. Reuses already-computed figures —
   *  never re-derive realization numbers here. Cash/checking: basis == amount. */
  basis?: number;
  /** Counterparty account or entity id for transfer-style rows, surfaced as the
   *  Asset Ledger "Other Account" column. Undefined for external income/expense. */
  counterpartyId?: string;
}

export interface DeductionBreakdown {
  aboveLine: {
    retirementContributions: number;
    taggedExpenses: number;
    manualEntries: number;
    /** IRC 221 student-loan interest, post-cap and post-MAGI-phase-out. */
    studentLoanInterest: number;
    total: number;
    bySource: Record<string, { label: string; amount: number }>;
  };
  belowLine: {
    charitable: number;
    taxesPaid: number;           // SALT total (capped): state income tax + property taxes
    stateIncomeTax: number;      // estimated state income tax (AGI × flat rate), pre-cap
    propertyTaxes: number;       // property taxes from all sources, pre-cap
    interestPaid: number;
    otherItemized: number;
    itemizedTotal: number;
    standardDeduction: number;
    taxDeductions: number;
    bySource: Record<string, { label: string; amount: number }>;
  };
}

/**
 * 5-year FIFO carryforward of unused charitable deductions, partitioned by AGI bucket.
 */
export interface CharityCarryforward {
  /** Cash gifts to public charities — 60% AGI limit. */
  cashPublic: CarryforwardEntry[];
  /** Cash gifts to private foundations — 30% AGI limit. */
  cashPrivate: CarryforwardEntry[];
  /** Appreciated-property gifts to public charities — 30% AGI limit. */
  appreciatedPublic: CarryforwardEntry[];
  /** Appreciated-property gifts to private foundations — 20% AGI limit. */
  appreciatedPrivate: CarryforwardEntry[];
}

export interface CarryforwardEntry {
  amount: number;
  originYear: number;
}

export function emptyCharityCarryforward(): CharityCarryforward {
  return {
    cashPublic: [],
    cashPrivate: [],
    appreciatedPublic: [],
    appreciatedPrivate: [],
  };
}

export type { EntityCashFlowRow, TrustCashFlowRow, BusinessCashFlowRow } from "./entity-cashflow";
export type { NoteReceivable, NoteExtraPayment, NotePaymentType as NoteReceivablePaymentType, NoteYearResult, NotesReceivableResult, NoteScheduleMap, NoteScheduleRow } from "./notes-receivable/types";
