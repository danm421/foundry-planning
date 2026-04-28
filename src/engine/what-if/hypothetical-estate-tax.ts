import { applyFirstDeath, applyFinalDeath } from "../death-event";
import type {
  Account,
  EntitySummary,
  EstateTaxResult,
  FamilyMember,
  Gift,
  GiftEvent,
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
  /** Phase 3 gift events (asset + liability transfers) for lifetime exemption consumption.
   *  Optional; defaults to [] when absent. */
  giftEvents?: GiftEvent[];
}

function sumTotals(results: EstateTaxResult[]) {
  return results.reduce(
    (acc, r) => ({
      federal: acc.federal + r.federalEstateTax,
      state: acc.state + r.stateEstateTax,
      admin: acc.admin + r.estateAdminExpenses,
      total: acc.total + r.totalTaxesAndExpenses,
    }),
    { federal: 0, state: 0, admin: 0, total: 0 },
  );
}

function runOrdering(
  firstDecedent: "client" | "spouse",
  input: HypotheticalEstateTaxInput,
): HypotheticalEstateTaxOrdering {
  const survivor: "client" | "spouse" =
    firstDecedent === "client" ? "spouse" : "client";

  const firstWill = input.wills.find((w) => w.grantor === firstDecedent) ?? null;

  // structuredClone isolates the hypothetical run from the caller's state
  // (projection.ts keeps real-death state alive alongside these clones).
  const firstResult = applyFirstDeath({
    year: input.year,
    deceased: firstDecedent,
    survivor,
    will: firstWill,
    accounts: structuredClone(input.accounts),
    accountBalances: structuredClone(input.accountBalances),
    basisMap: structuredClone(input.basisMap),
    incomes: structuredClone(input.incomes),
    liabilities: structuredClone(input.liabilities),
    familyMembers: input.familyMembers,
    externalBeneficiaries: input.externalBeneficiaries,
    entities: structuredClone(input.entities),
    planSettings: input.planSettings,
    gifts: input.gifts,
    giftEvents: input.giftEvents ?? [],
    annualExclusionsByYear: input.annualExclusionsByYear,
    dsueReceived: 0,
  });

  if (!input.isMarried) {
    return {
      firstDecedent,
      firstDeath: firstResult.estateTax,
      totals: sumTotals([firstResult.estateTax]),
    };
  }

  const finalWill = input.wills.find((w) => w.grantor === survivor) ?? null;

  const finalResult = applyFinalDeath({
    year: input.year,
    deceased: survivor,
    survivor,
    will: finalWill,
    accounts: firstResult.accounts,
    accountBalances: firstResult.accountBalances,
    basisMap: firstResult.basisMap,
    incomes: firstResult.incomes,
    liabilities: firstResult.liabilities,
    familyMembers: input.familyMembers,
    externalBeneficiaries: input.externalBeneficiaries,
    // Adopt the post-first-death entity list (grantor-succession may have
    // flipped an IDGT/SLAT or revocable trust). applyFirstDeath now returns
    // the mutated entities so the survivor's final-death pass classifies
    // trusts against the true post-flip state.
    entities: firstResult.entities,
    planSettings: input.planSettings,
    gifts: input.gifts,
    giftEvents: input.giftEvents ?? [],
    annualExclusionsByYear: input.annualExclusionsByYear,
    dsueReceived: firstResult.dsueGenerated,
  });

  return {
    firstDecedent,
    firstDeath: firstResult.estateTax,
    finalDeath: finalResult.estateTax,
    totals: sumTotals([firstResult.estateTax, finalResult.estateTax]),
  };
}

export function computeHypotheticalEstateTax(
  input: HypotheticalEstateTaxInput,
): HypotheticalEstateTax {
  const primaryFirst = runOrdering("client", input);
  const spouseFirst = input.isMarried ? runOrdering("spouse", input) : undefined;
  return {
    year: input.year,
    primaryFirst,
    spouseFirst,
  };
}
