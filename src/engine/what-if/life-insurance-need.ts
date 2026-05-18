import type {
  Account,
  BeneficiaryRef,
  ClientData,
  LifeInsurancePolicy,
} from "@/engine/types";
import type { AccountOwner } from "@/engine/ownership";

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

function clone<T>(v: T): T {
  return structuredClone(v);
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
  const out = clone(data);

  // 1. Premature death — set the deceased's lifeExpectancy so the engine's
  //    death-event machinery fires in `deathYear`. lifeExpectancy is an age,
  //    and the engine computes deathYear = birthYear + lifeExpectancy.
  if (deceased === "client") {
    out.client.lifeExpectancy = deathYear - birthYear(out.client.dateOfBirth);
  } else {
    out.client.spouseLifeExpectancy =
      deathYear - birthYear(out.client.spouseDob ?? out.client.dateOfBirth);
  }

  // 2. Synthetic policy. Drop any prior assembler-injected policy first so
  //    re-running the assembler (e.g. the Task 6 bisection) replaces it.
  out.accounts = [
    ...out.accounts.filter((a) => a.id !== SYNTHETIC_POLICY_ID),
    syntheticPolicy(deceased, faceValue, growthRate, out),
  ];

  // 3. Final / burial expenses override estate admin expenses.
  out.planSettings = { ...out.planSettings, estateAdminExpenses: finalExpenses };

  // 4. Task 3 — survivor's living-expense-at-death override. `input.livingExpenseAtDeath`
  //    will replace / scale the post-death living expense once Task 3 lands here.

  // 5. Task 4 — pay-off-debts-at-death. When `input.payOffDebtsAtDeath` is set,
  //    Task 4 will retire household liabilities at the death year here.

  // Task 5 — horizon coverage. Task 5 may extend `planEndYear` so the
  //    projection runs long enough to cover the survivor's full lifetime.

  return out;
}
