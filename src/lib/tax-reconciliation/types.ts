import type { ProjectionYear } from "@/engine/types";
import type { TaxReturnFacts } from "@/lib/schemas/tax-return-facts";
import type { W2Pair } from "@/lib/tax-returns/supporting-payload";
import type { FindingLineRef } from "@/lib/tax-analysis/types";

export type SectionId = "income" | "spending" | "business" | "savings" | "deductions" | "household" | "tax";
export const SECTION_ORDER: readonly SectionId[] = ["income", "spending", "business", "savings", "deductions", "household", "tax"];
export const SECTION_TITLES: Record<SectionId, string> = {
  income: "Income", spending: "Spending", business: "Businesses & entities", savings: "Savings & contributions",
  deductions: "Deductions", household: "Household & assumptions", tax: "Why the tax differs",
};

export type SuggestionKind = "update" | "review" | "info";
export type DeltaTone = "short" | "over" | "missing" | "extra" | "neutral";
export type OwnerChoice = "client" | "spouse" | "split";

export interface ReturnFigure { label: string; amount: number | null; display: string; lineRefs: FindingLineRef[] }
export interface PlanFigure { label: string; amount: number | null; display: string; year: number }
export interface Delta { amount: number | null; display: string; tone: DeltaTone }

export type ActionTarget =
  | { kind: "income.update"; incomeId: string; patch: Record<string, unknown>; amountField: "annualAmount" }
  | { kind: "income.create"; input: Record<string, unknown>; amountField: "annualAmount"; ownerField?: "owner" }
  | { kind: "income.socialSecurity.claim"; rows: Array<{ owner: "client" | "spouse"; incomeId: string; patch: Record<string, unknown> }>; amount: number }
  | { kind: "expense.update"; expenseId: string; patch: Record<string, unknown>; amountField: "annualAmount" }
  | { kind: "savings_rule.update"; ruleId: string; patch: Record<string, unknown>; amountField: "annualAmount" }
  | { kind: "savings_rule.create"; input: Record<string, unknown>; amountField: "annualAmount" }
  | { kind: "deduction.create"; input: { type: "charitable"; name: string; owner: "joint"; annualAmount: number; growthRate: number; startYear: number; endYear: number }; amountField: "annualAmount" }
  | { kind: "deduction.update"; deductionId: string; patch: { annualAmount: number }; amountField: "annualAmount" }
  | { kind: "entity.create"; input: { name: string; entityType: "s_corp" | "partnership"; taxTreatment: "qbi" | "ordinary"; value: number } }
  | { kind: "entity.update"; entityId: string; patch: { taxTreatment: "qbi" } }
  | { kind: "plan_settings.update"; patch: { residenceState?: string; capitalLossCarryforwardLt?: number }; amountField?: "capitalLossCarryforwardLt" }
  | { kind: "client.update"; patch: { filingStatus: "single" | "married_joint" | "married_separate" | "head_of_household" } }
  | { kind: "medicare.upsert"; owner: "client" | "spouse"; priorYearMagi: number; amountField: "priorYearMagi" };

export interface SuggestionAction {
  label: string;            // button text, names the write: "Set salary to $150,000"
  describe: string;         // "Sets Salary — Acme Corp to $150,000 (2025 dollars)"
  amountEditable: boolean;
  defaultAmount: number | null;
  ownerChoices?: OwnerChoice[];
  target: ActionTarget;     // server-authoritative; echoed for transparency, never accepted back
}

export interface Suggestion {
  id: string;
  section: SectionId;
  kind: SuggestionKind;
  headline: string;
  meaning: string;
  returnFigure: ReturnFigure;
  planFigure: PlanFigure;
  delta: Delta;
  action?: SuggestionAction;
  link?: { label: string; href: string };
  status: "open" | "dismissed";
}

export interface Check { id: string; label: string; returnDisplay: string; planDisplay: string }
export interface RuleResult { suggestions: Suggestion[]; checks: Check[] }
export type Rule = (input: ReconciliationInput) => RuleResult;

export type IncomeType = "salary" | "social_security" | "business" | "deferred" | "capital_gains" | "trust" | "other";
export interface PlanIncome {
  id: string; type: IncomeType; name: string; annualAmount: number; growthRate: number;
  startYear: number; endYear: number; inflationStartYear: number | null;
  owner: "client" | "spouse" | "joint";
  ownerAccountId: string | null; ownerEntityId: string | null; linkedPropertyId: string | null;
  ssBenefitMode: "manual_amount" | "pia_at_fra" | "no_benefit" | null;
  piaMonthly: number | null; claimingAge: number | null;
}
export interface PlanExpense {
  id: string; type: "living" | "other" | "insurance" | "education"; name: string; annualAmount: number; growthRate: number;
  startYear: number; endYear: number; inflationStartYear: number | null; isDefault: boolean; startYearRef: string | null;
}
export interface PlanSavingsRule {
  id: string; accountId: string; annualAmount: number; startYear: number; endYear: number;
  /** Percent-of-salary mode. The engine resolves the contribution as ownerSalary x annualPercent and
   *  IGNORES annualAmount whenever this is set and above zero (src/engine/savings.ts:20-25). Null or
   *  zero means annualAmount is the live figure. Carried here because `savings_rules.annual_amount`
   *  is NOT NULL DEFAULT '0' (src/db/schema.ts:3327-3329), so a percent rule reads as $0 off the row
   *  and would otherwise show a phantom gap against a fully funded plan. */
  annualPercent: number | null;
  /** Max-funded mode. The engine resolves the contribution to the IRS limit for the owner's age and
   *  the account's sub-type, overriding BOTH annualAmount and annualPercent
   *  (src/engine/projection.ts:3910-3924). Same phantom-gap hazard as annualPercent. */
  contributeMax: boolean;
}
export interface PlanAccount { id: string; name: string; category: string; subType: string }
export interface PlanEntity { id: string; name: string; entityType: string; taxTreatment: "qbi" | "ordinary" | "non_taxable" }
export interface PlanDeduction { id: string; type: "charitable" | "above_line" | "below_line" | "property_tax"; name: string | null; annualAmount: number; growthRate: number; startYear: number; endYear: number }
export interface PlanFamilyMember { id: string; role: "client" | "spouse" | "child" | "other"; relationship: string; dateOfBirth: string | null; claimedAsDependent: "auto" | "yes" | "no" }
export interface PlanMedicare { owner: "client" | "spouse"; priorYearMagi: number | null }

export interface PlanSnapshot {
  client: { filingStatus: "single" | "married_joint" | "married_separate" | "head_of_household"; dateOfBirth: string; spouseDob: string | null };
  planSettings: { planStartYear: number; planEndYear: number; inflationRate: number; residenceState: string | null; capitalLossCarryforwardLt: number | null; capitalLossCarryforwardSt: number | null };
  incomes: PlanIncome[]; expenses: PlanExpense[]; savingsRules: PlanSavingsRule[]; accounts: PlanAccount[];
  entities: PlanEntity[]; deductions: PlanDeduction[]; familyMembers: PlanFamilyMember[]; medicare: PlanMedicare[];
}

export type EngineYear = Pick<ProjectionYear, "year" | "income" | "taxDetail" | "taxResult" | "deductionBreakdown" | "withdrawals" | "expenses" | "savings" | "accountLedgers">;

export interface ReconciliationInput {
  clientId: string;           // only for review links
  taxYear: number;
  planYear: number;
  facts: TaxReturnFacts;
  w2s: W2Pair[];              // every W-2 document's pairs, flattened, in document order
  plan: PlanSnapshot;
  engineYear: EngineYear | null;
  stateTaxEstimate: number;   // runCalc(facts).flow.stateTax, 0 when unknown
  /** runCalc(facts).flow.fica, 0 when unknown — employee Social Security and Medicare withheld.
   *  Needed because 1040 line 24 EXCLUDES it (it lives only on W-2 boxes 4 and 6), while the
   *  engine's own tax total includes it (src/lib/tax/calculate.ts). Without it the spending rule
   *  would count money the household never had as available to spend. */
  ficaEstimate: number;
}

export interface Pair { return: number | null; plan: number | null }
export interface Reconciliation {
  taxYear: number; planYear: number; planStartYear: number;
  status: "extracting" | "needs_review" | "ready" | "failed";
  overview: { totalIncome: Pair; federalTax: Pair; agi: Pair; effectiveRate: Pair; openCount: number; dismissedCount: number; inLineCount: number };
  sections: Array<{ id: SectionId; title: string; items: Suggestion[] }>;
  checks: Check[];
  dismissed: Suggestion[];
  notes: string[];
  dismissalsUnavailable: boolean;
}
