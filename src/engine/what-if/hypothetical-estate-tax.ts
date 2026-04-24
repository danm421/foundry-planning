import { applyFirstDeath, applyFinalDeath } from "../death-event";
import type {
  Account,
  EntitySummary,
  EstateTaxResult,
  FamilyMember,
  Gift,
  HypotheticalEstateTax,
  HypotheticalEstateTaxOrdering,
  Income,
  Liability,
  PlanSettings,
  Will,
} from "../types";
import type { ExternalBeneficiarySummary } from "../death-event";

/**
 * Input snapshot for the hypothetical computation. Pass the year-N state
 * you'd pass to `applyFirstDeath` — the function clones it internally so
 * the caller's state is never mutated.
 */
export interface HypotheticalEstateTaxInput {
  year: number;
  /** "married_joint" | "married_separate" → run both orderings;
   *  other statuses → single-filer path, only `primaryFirst`. */
  isMarried: boolean;
  accounts: Account[];
  accountBalances: Record<string, number>;
  basisMap: Record<string, number>;
  incomes: Income[];
  liabilities: Liability[];
  familyMembers: FamilyMember[];
  externalBeneficiaries: ExternalBeneficiarySummary[];
  entities: EntitySummary[];
  wills: Will[];
  planSettings: PlanSettings;
  gifts: Gift[];
  annualExclusionsByYear: Record<number, number>;
}

export function computeHypotheticalEstateTax(
  _input: HypotheticalEstateTaxInput,
): HypotheticalEstateTax {
  throw new Error("not implemented");
}
