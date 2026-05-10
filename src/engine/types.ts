import type { TaxResult, TaxYearParameters } from "../lib/tax/types";
import type { ClientDeductionRow } from "../lib/tax/derive-deductions";
import type { TrustSubType } from "@/lib/entities/trust";
import type { TrustTaxBreakdown, TrustWarning } from "./trust-tax/types";
import type { AccountOwner } from "./ownership";
import type { EntityCashFlowRow } from "./entity-cashflow";

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
   * 'clut_remainder_interest' on the gift auto-emitted at CLUT inception
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
  via:
    | "titling"
    | "beneficiary_designation"
    | "will"
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
  /** Source account id; null when this line is a liability. */
  accountId: string | null;
  /** Source liability id; null when this line is an asset. */
  liabilityId: string | null;
  /** Effective share of FMV included in this estate line (`amount / fmv`).
   *  0.5 for a pure-joint account at first death; 1.0 for a 100%-included
   *  account; intermediate values when contributions from a family pool and
   *  a rev-trust-grantor entity slice are summed onto the same account.
   *  Stored for display; `amount` is the authoritative dollar figure. */
  percentage: number;
  /** Positive for assets, negative for debts. */
  amount: number;
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

  // Tentative Tax Base
  adjustedTaxableGifts: number;
  lifetimeGiftTaxAdjustment: number; // always 0 in v1; reserved
  tentativeTaxBase: number;

  // Federal Tax
  tentativeTax: number;
  beaAtDeathYear: number;
  dsueReceived: number;
  applicableExclusion: number;       // BEA + DSUE
  unifiedCredit: number;
  federalEstateTax: number;

  // State Tax
  stateEstateTaxRate: number;
  stateEstateTax: number;

  // Totals
  totalEstateTax: number;            // federal + state
  totalTaxesAndExpenses: number;     // totalEstateTax + estateAdminExpenses

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
  relationship: "child" | "grandchild" | "parent" | "sibling" | "other";
  firstName: string;
  lastName: string | null;
  dateOfBirth: string | null;
}

export type GiftEventKind = "outright" | "clut_remainder_interest";

export type GiftEvent =
  | {
      kind: "cash";
      year: number;
      amount: number;
      grantor: "client" | "spouse";
      recipientEntityId: string;
      sourceAccountId?: string;
      useCrummeyPowers: boolean;
      seriesId?: string; // present on fanned-out series occurrences
      eventKind?: GiftEventKind;
    }
  | {
      kind: "asset";
      year: number;
      accountId: string;
      percent: number; // 0.0001..1
      grantor: "client" | "spouse";
      recipientEntityId: string;
      amountOverride?: number; // if advisor provided a manual amount
      eventKind?: GiftEventKind;
    }
  | {
      kind: "liability";
      year: number;
      liabilityId: string;
      percent: number;
      grantor: "client" | "spouse";
      recipientEntityId: string;
      parentGiftId: string;
      eventKind?: GiftEventKind;
    };

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
  /** IRS-published tax year parameters seeded from the DB. Empty = flat-mode fallback. */
  taxYearRows?: TaxYearParameters[];
  /** Itemized deduction line items (charitable, SALT, mortgage interest, etc.). */
  deductions?: ClientDeductionRow[];
  /** Transfer techniques — move value between accounts with tax implications. */
  transfers?: Transfer[];
  /** Roth conversion techniques — multi-source, strategy-driven Trad → Roth conversions. */
  rothConversions?: RothConversion[];
  /** Asset buy/sell transactions — acquire or dispose of assets in specific years. */
  assetTransactions?: AssetTransaction[];
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
  /** Per-family-member ownership of a business entity (sourced from
   *  entity_owners). Trusts leave this undefined. Sum may be < 1 when legacy
   *  data is missing rows; in that case in-estate treatment defaults to fully
   *  family-owned. */
  owners?: Array<{ familyMemberId: string; percent: number }>;
  /** Frozen split-interest snapshot for CLUT/CLAT trusts. Populated only when
   *  trustSubType = 'clut'. Captures inception-time inputs and computed
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
}

export interface BeneficiaryRef {
  id: string;
  tier: "primary" | "contingent";
  percentage: number;
  familyMemberId?: string;
  externalBeneficiaryId?: string;
  sortOrder: number;
}

export interface LifeInsuranceCashValueScheduleRow {
  year: number;
  cashValue: number;
}

export interface LifeInsurancePolicy {
  faceValue: number;
  costBasis: number;
  premiumAmount: number;
  premiumYears: number | null;
  policyType: "term" | "whole" | "universal" | "variable";
  termIssueYear: number | null;
  termLengthYears: number | null;
  endsAtInsuredRetirement: boolean;
  cashValueGrowthMode: "basic" | "free_form";
  postPayoutMergeAccountId: string | null;
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

export interface Account {
  id: string;
  name: string;
  category: "taxable" | "cash" | "retirement" | "real_estate" | "business" | "life_insurance";
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
  growthRate: number;
  rmdEnabled: boolean;
  /**
   * Optional override of the prior calendar-year-end balance used for the
   * first projection year's RMD calculation. Set when the user-entered
   * `value` is not a true Dec-31 snapshot. Ignored after Year 1 — the
   * engine's own end-of-year balances are authoritative.
   */
  priorYearEndValue?: number;
  beneficiaries?: BeneficiaryRef[];
  isDefaultChecking?: boolean;
  annualPropertyTax?: number;
  propertyTaxGrowthRate?: number;
  insuredPerson?: "client" | "spouse" | "joint" | null;
  lifeInsurance?: LifeInsurancePolicy;
  // CMA realization model — present when account uses a model portfolio or has overrides
  realization?: {
    pctOrdinaryIncome: number;
    pctLtCapitalGains: number;
    pctQualifiedDividends: number;
    pctTaxExempt: number;
    turnoverPct: number;
  };
  owners: AccountOwner[];
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
  // Cash account this income deposits into. When unset, the engine falls back to the
  // household default checking (or the entity's default checking if ownerEntityId is set).
  cashAccountId?: string;
  taxType?: "earned_income" | "ordinary_income" | "dividends" | "capital_gains" | "qbi" | "tax_exempt" | "stcg";
  /** Year-by-year amount overrides. When present, bypasses growth-rate calc.
   *  Plain object keyed by year (number). Maps were tried, but they JSON-
   *  serialize to `{}`, which broke client-side projection runs that go
   *  through the projection-data API or a frozen scenario snapshot. */
  scheduleOverrides?: Record<number, number>;
  /** SS-specific. When unset, engine treats as "manual_amount" (legacy). */
  ssBenefitMode?: "manual_amount" | "pia_at_fra" | "no_benefit";
  /** SS-specific. Monthly PIA in today's dollars. Required when ssBenefitMode=pia_at_fra. */
  piaMonthly?: number;
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
  // ── View-only metadata ─────────────────────────────────────────────
  // Carried through from the DB row so page-level adapters can render
  // milestone-relative editing UI. Engine math ignores these fields.
  startYearRef?: string | null;
  endYearRef?: string | null;
  growthSource?: string | null;
}

export interface Expense {
  id: string;
  type: "living" | "other" | "insurance";
  name: string;
  annualAmount: number;
  startYear: number;
  endYear: number;
  growthRate: number;
  /** See Income.inflationStartYear. */
  inflationStartYear?: number;
  ownerEntityId?: string;
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
  // ── View-only metadata ─────────────────────────────────────────────
  // Carried through from the DB row so page-level adapters can render
  // milestone-relative editing UI. Engine math ignores these fields.
  startYearRef?: string | null;
  endYearRef?: string | null;
  growthSource?: string | null;
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
  extraPayments: ExtraPayment[];
  owners: AccountOwner[];
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
  /** Whether this contribution counts as an above-the-line deduction.
   *  The derive-deductions logic gates on both subtype eligibility AND this flag. */
  isDeductible: boolean;
  /** When true (default), the engine caps the resolved contribution at the
   *  applicable IRS limit (401k/403b deferral or IRA base+catch-up). When
   *  false, the rule bypasses the cap entirely. */
  applyContributionLimit?: boolean;
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

export type RothConversionType =
  | "fixed_amount"
  | "full_account"
  | "deplete_over_period"
  | "fill_up_bracket";

export interface RothConversion {
  id: string;
  name: string;
  destinationAccountId: string;
  sourceAccountIds: string[];
  conversionType: RothConversionType;
  fixedAmount: number;
  /** Top of the ordinary-income bracket to fill (e.g., 0.22). Used only when
   *  conversionType === "fill_up_bracket". */
  fillUpBracket?: number;
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
  name: string;
  type: "buy" | "sell";
  year: number;
  // Sale fields
  accountId?: string;
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
  /** Annual rate for inflating the SS wage base (default: inflationRate + 0.005). */
  ssWageGrowthRate?: number | null;
  /** Lump-sum estate administration expenses (funerals, executor fees, etc.). */
  estateAdminExpenses?: number;
  /** Flat state estate tax rate applied on top of federal estate tax. 0 disables. */
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
}

// ── Output Types ─────────────────────────────────────────────────────────────

export interface ProjectionYear {
  year: number;
  ages: { client: number; spouse?: number };

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
    ordinaryIncome: number;
    dividends: number;
    capitalGains: number;
    stCapitalGains: number;
    qbi: number;
    taxExempt: number;
    bySource: Record<string, { type: string; amount: number }>;
  };

  taxResult?: TaxResult;

  deductionBreakdown?: DeductionBreakdown;

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
    other: number;
    insurance: number;
    realEstate: number;
    taxes: number;
    /** Cash gifts that drained a household-owned account in this year. Already
     *  rolled into `other` and `total`; surfaced separately so the cashflow
     *  report can show a dedicated column under Expenses > Other. */
    cashGifts: number;
    total: number;
    bySource: Record<string, number>;
    byLiability: Record<string, number>;
    interestByLiability: Record<string, number>;
  };

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
    realEstate: Record<string, number>;
    business: Record<string, number>;
    lifeInsurance: Record<string, number>;
    taxableTotal: number;
    cashTotal: number;
    retirementTotal: number;
    realEstateTotal: number;
    businessTotal: number;
    lifeInsuranceTotal: number;
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
  };

  accountLedgers: Record<string, AccountLedger>;

  /** Per-account basis at beginning of year, before any activity. Used by UI
   * previews (e.g. sale-form autofill) to show projected cost basis. */
  accountBasisBoY: Record<string, number>;

  /** Per-liability balance at beginning of year, before that year's amortization
   * runs. Used by UI previews to show the projected mortgage payoff amount for
   * a given sale year. */
  liabilityBalancesBoY: Record<string, number>;

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
   *  8606 pro-rata). The Tax Bracket report consumes both columns. */
  rothConversions?: { id: string; name: string; gross: number; taxable: number }[];
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
   *  with category: "expense" / "income") and CLUT charity payments
   *  (read charitableOutflowDetail for those). */
  trustDistributionsByEntity?: Map<string, number>;
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
  /** Sum of split-interest-trust outflows to charity this year (CLUT annual
   * unitrust payments). 0 in years with no trust-driven charitable flow. */
  charitableOutflows: number;
  /** Per-trust-per-charity breakdown of charitableOutflows. Populated only
   * when charitableOutflows > 0. */
  charitableOutflowDetail?: Array<{
    kind: "clut_unitrust";
    trustId: string;
    trustName: string;
    charityId: string;
    amount: number;
  }>;
  /** End-of-term trust termination distributions. One entry per CLUT whose
   * lead term ended in the prior year (distributions fire the year after
   * the last unitrust payment). Populated only in the termination year. */
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
    | "entity_distribution";
  label: string;
  amount: number;
  sourceId?: string;
  /** True for the source/target legs of pure portfolio-to-portfolio
   * transfers (supplemental withdrawal refill, entity gap-fill refill).
   * Reports filter these out so the same dollars don't appear as both an
   * addition and a distribution at the aggregate level. */
  isInternalTransfer?: boolean;
}

export interface DeductionBreakdown {
  aboveLine: {
    retirementContributions: number;
    taggedExpenses: number;
    manualEntries: number;
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
