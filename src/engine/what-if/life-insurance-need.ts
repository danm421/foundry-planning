import type {
  Account,
  BeneficiaryRef,
  ClientData,
  Expense,
  LifeInsurancePolicy,
} from "@/engine/types";
import type { AccountOwner } from "@/engine/ownership";
import { runProjection } from "@/engine/projection";

/**
 * Inputs to the Life Insurance solver's what-if assembler. Each field is a
 * solver knob — Task 6's bisection sweeps `faceValue`, the rest stay fixed for
 * a given run.
 */
export interface LifeInsuranceWhatIfInput {
  /** The household's base ClientData (untouched — the assembler clones it). */
  data: ClientData;
  /** Which household principal dies prematurely. */
  deceased: "client" | "spouse";
  /** Calendar year of the premature death. */
  deathYear: number;
  /** Candidate death benefit. Task 6 bisects on this value. */
  faceValue: number;
  /** Post-payout growth rate for the proceeds once they land in the
   *  survivor's portfolio (drives the §101 cash account's growth). */
  growthRate: number;
  /** One-time final / burial expenses charged at death. Overrides
   *  `planSettings.estateAdminExpenses`. */
  finalExpenses: number;
  /** Survivor's annual living expense after the death — Task 3. */
  livingExpenseAtDeath: number | null;
  /** Whether household debts are retired at death — Task 4. */
  payOffDebtsAtDeath: boolean;
}

/** Stable id for the assembler-injected policy. Re-running the assembler
 *  replaces any prior synthetic policy rather than stacking them. */
export const SYNTHETIC_POLICY_ID = "li-solver-synthetic-policy";

function birthYear(iso: string): number {
  return Number(iso.slice(0, 4));
}

/** The surviving spouse's household role — the opposite of the deceased. */
function survivorRole(deceased: "client" | "spouse"): "client" | "spouse" {
  return deceased === "client" ? "spouse" : "client";
}

/**
 * Beneficiary designation that routes the death benefit to the SURVIVOR.
 *
 * Engine-integration note: a `life_insurance` account is transformed into a
 * cash (or taxable) account carrying `faceValue` by `prepareLifeInsurancePayouts`
 * in the death-event Phase 0. The transformed account keeps its `beneficiaries`,
 * so the 4b precedence chain's `applyBeneficiaryDesignations` step routes the
 * proceeds. A `BeneficiaryRef` with `householdRole` = the survivor's role
 * resolves (in `applyBeneficiaryDesignations`) to that principal's
 * `FamilyMember` row and rewrites ownership to them — the proceeds land in the
 * survivor's portfolio. The survivor's `FamilyMember` row must exist in
 * `data.familyMembers`, else the designation is treated as "removed" and the
 * proceeds leave the household.
 */
function buildSurvivorBeneficiary(deceased: "client" | "spouse"): BeneficiaryRef[] {
  return [
    {
      id: `${SYNTHETIC_POLICY_ID}-bene`,
      tier: "primary",
      percentage: 100,
      householdRole: survivorRole(deceased),
      sortOrder: 0,
    },
  ];
}

/**
 * Owner of the synthetic policy = the INSURED (the deceased principal). At the
 * death event the policy is owned by the decedent, which is also what the
 * gross-estate builder expects (§2042-equivalent inclusion). Ownership is
 * resolved to the deceased's `FamilyMember` row.
 */
function buildInsuredOwner(
  deceased: "client" | "spouse",
  data: ClientData,
): AccountOwner[] {
  const fm = (data.familyMembers ?? []).find((m) => m.role === deceased);
  if (fm) {
    return [{ kind: "family_member", familyMemberId: fm.id, percent: 1 }];
  }
  // No FamilyMember row — fall back to a legacy-style owner so the engine's
  // `normalizeOwners` backfill still pro-rates sensibly. The death-event
  // routing keys off `insuredPerson`, not the owner, so the payout still fires.
  return [];
}

function syntheticPolicy(
  deceased: "client" | "spouse",
  faceValue: number,
  growthRate: number,
  data: ClientData,
): Account {
  const policy: LifeInsurancePolicy = {
    faceValue,
    costBasis: 0,
    premiumAmount: 0,
    premiumYears: null,
    policyType: "term",
    termIssueYear: null,
    termLengthYears: null,
    endsAtInsuredRetirement: false,
    cashValueGrowthMode: "basic",
    postPayoutGrowthRate: growthRate,
    cashValueSchedule: [],
  };
  const owners = buildInsuredOwner(deceased, data);
  return {
    id: SYNTHETIC_POLICY_ID,
    name: "Life Insurance Need (solver)",
    category: "life_insurance",
    subType: "term",
    value: 0,
    basis: 0,
    growthRate: 0,
    rmdEnabled: false,
    insuredPerson: deceased,
    lifeInsurance: policy,
    beneficiaries: buildSurvivorBeneficiary(deceased),
    owners,
  };
}

/**
 * Replace the household's living expenses from `deathYear` onward with a
 * single survivor-adjusted amount.
 *
 * - Living expenses whose `endYear` >= `deathYear` are truncated to
 *   `deathYear - 1` (they represent the pre-death household's spending).
 * - Living expenses whose `endYear` < `deathYear` are left untouched (they
 *   already ended before the death, so no truncation needed).
 * - Living expenses whose `startYear` >= `deathYear` are dropped: a
 *   `startYear === deathYear` expense would have its `endYear` truncated to
 *   `deathYear - 1`, producing an inverted range, and its spending is fully
 *   subsumed by the replacement row. Expenses starting strictly after
 *   `deathYear` are also dropped for the same reason.
 * - A single replacement expense is appended starting at `deathYear` and
 *   running through `planEndYear`, growing at the plan's inflation rate.
 */
function applyLivingExpenseAtDeath(
  out: ClientData,
  deathYear: number,
  livingExpenseAtDeath: number | null,
): void {
  if (livingExpenseAtDeath == null) return;
  const horizonEnd = out.planSettings.planEndYear;
  out.expenses = out.expenses
    .filter((e) => !(e.type === "living" && e.startYear >= deathYear))
    .map((e): Expense =>
      e.type === "living" && e.endYear >= deathYear
        ? { ...e, endYear: deathYear - 1 }
        : e,
    );
  out.expenses.push({
    id: "li-solver-living-at-death",
    type: "living",
    name: "Living Expenses (post-death)",
    annualAmount: livingExpenseAtDeath,
    startYear: deathYear,
    endYear: horizonEnd,
    growthRate: out.planSettings.inflationRate,
  });
}

/**
 * Sum the projected remaining balances of all liabilities at the beginning of
 * `deathYear` by running a pre-pass projection on the pre-transform `data`.
 *
 * Uses `ProjectionYear.liabilityBalancesBoY` (a `Record<string, number>` keyed
 * by liability id) — the per-liability balance at the start of each year,
 * before that year's amortisation runs. If no projection row exists for
 * `deathYear` (e.g. deathYear is before planStartYear), we fall back to the
 * sum of starting balances from `data.liabilities`.
 */
function liabilityBalancesAtDeathYear(data: ClientData, deathYear: number): number {
  const projection = runProjection(data);
  const row = projection.find((y) => y.year === deathYear);
  if (row) {
    return Object.values(row.liabilityBalancesBoY).reduce((s, v) => s + v, 0);
  }
  // Fallback: sum starting balances (conservative; accurate when deathYear is
  // before planStartYear or all loans have already terminated).
  return data.liabilities.reduce((s, l) => s + l.balance, 0);
}

/**
 * When `enabled`, wipe all household liabilities from the what-if clone and
 * book a one-time `"other"` expense in `deathYear` equal to the projected
 * outstanding debt — modelling life insurance proceeds retiring all debts at
 * the insured's death so the survivor inherits a debt-free household.
 *
 * The balance pre-pass runs against `baseForBalances` (the ORIGINAL,
 * pre-transform data) so projections of the actual plan — not the what-if
 * overrides — determine payoff amounts.
 */
function applyDebtPayoffAtDeath(
  out: ClientData,
  baseForBalances: ClientData,
  deathYear: number,
  enabled: boolean,
): void {
  if (!enabled || out.liabilities.length === 0) return;
  const payoff = liabilityBalancesAtDeathYear(baseForBalances, deathYear);
  out.liabilities = [];
  out.expenses.push({
    id: "li-solver-debt-payoff",
    type: "other",
    name: "Debt Payoff at Death",
    annualAmount: payoff,
    startYear: deathYear,
    endYear: deathYear,
    growthRate: 0,
  });
}

/**
 * Assemble a what-if `ClientData` for the Life Insurance solver: a premature
 * death of `deceased` in `deathYear` plus a synthetic term policy at the
 * candidate `faceValue` whose §101 tax-free proceeds route to the survivor.
 *
 * Pure — clones `data`, never mutates the caller's input.
 */
export function buildLifeInsuranceWhatIfData(
  input: LifeInsuranceWhatIfInput,
): ClientData {
  const { data, deceased, deathYear, faceValue, growthRate, finalExpenses } = input;
  const out = structuredClone(data);

  // 1. Premature death — set the deceased's lifeExpectancy so the engine's
  //    death-event machinery fires in `deathYear`. lifeExpectancy is an age,
  //    and the engine computes deathYear = birthYear + lifeExpectancy.
  if (deceased === "client") {
    out.client.lifeExpectancy = deathYear - birthYear(out.client.dateOfBirth);
  } else {
    if (!out.client.spouseDob) {
      throw new Error("buildLifeInsuranceWhatIfData: deceased='spouse' requires spouseDob");
    }
    out.client.spouseLifeExpectancy = deathYear - birthYear(out.client.spouseDob);
  }

  // 2. Synthetic policy. Drop any prior assembler-injected policy first so
  //    re-running the assembler (e.g. the Task 6 bisection) replaces it.
  out.accounts = [
    ...out.accounts.filter((a) => a.id !== SYNTHETIC_POLICY_ID),
    syntheticPolicy(deceased, faceValue, growthRate, out),
  ];

  // 3. Final / burial expenses override estate admin expenses.
  out.planSettings = { ...out.planSettings, estateAdminExpenses: finalExpenses };

  // Task 3 — survivor's living-expense-at-death override.
  applyLivingExpenseAtDeath(out, deathYear, input.livingExpenseAtDeath);

  // Task 4 — pay-off-debts-at-death override.
  applyDebtPayoffAtDeath(out, data, deathYear, input.payOffDebtsAtDeath);

  // Task 5 — extend planEndYear to cover the survivor's life expectancy.

  return out;
}
