import type { ClientData } from "@/engine/types";
import type { PlanDeduction, PlanSnapshot } from "./types";

/** Narrow the effective base-case tree to what the rules read. Synthesized
 *  rows (`source: "policy"` incomes/expenses) are dropped — they are not
 *  advisor data and have no row to update. Deductions come from the db rows
 *  because the tree's deduction rows carry no id.
 *
 *  Pure by design: this module must stay free of db and Next imports so the
 *  rules can be exercised against a hand-built tree in plain vitest. */
export function snapshotFromTree(tree: ClientData, deductionRows: PlanDeduction[]): PlanSnapshot {
  return {
    client: { filingStatus: tree.client.filingStatus, dateOfBirth: tree.client.dateOfBirth, spouseDob: tree.client.spouseDob ?? null },
    planSettings: {
      planStartYear: tree.planSettings.planStartYear, planEndYear: tree.planSettings.planEndYear, inflationRate: tree.planSettings.inflationRate,
      residenceState: tree.planSettings.residenceState ?? null,
      capitalLossCarryforwardLt: tree.planSettings.capitalLossCarryforwardLongTerm ?? null,
      capitalLossCarryforwardSt: tree.planSettings.capitalLossCarryforwardShortTerm ?? null,
    },
    incomes: tree.incomes.filter((i) => i.source !== "policy").map((i) => ({
      id: i.id, type: i.type, name: i.name, annualAmount: i.annualAmount, growthRate: i.growthRate, startYear: i.startYear, endYear: i.endYear,
      inflationStartYear: i.inflationStartYear ?? null, owner: i.owner, ownerAccountId: i.ownerAccountId ?? null, ownerEntityId: i.ownerEntityId ?? null,
      linkedPropertyId: i.linkedPropertyId ?? null, ssBenefitMode: i.ssBenefitMode ?? null, piaMonthly: i.piaMonthly ?? null, claimingAge: i.claimingAge ?? null,
    })),
    expenses: tree.expenses.filter((e) => e.source !== "policy").map((e) => ({
      id: e.id, type: e.type, name: e.name, annualAmount: e.annualAmount, growthRate: e.growthRate, startYear: e.startYear, endYear: e.endYear,
      inflationStartYear: e.inflationStartYear ?? null, isDefault: e.isDefault ?? false, startYearRef: e.startYearRef ?? null,
    })),
    savingsRules: tree.savingsRules.map((r) => ({ id: r.id, accountId: r.accountId, annualAmount: r.annualAmount, startYear: r.startYear, endYear: r.endYear })),
    accounts: tree.accounts.map((a) => ({ id: a.id, name: a.name, category: a.category, subType: a.subType })),
    entities: (tree.entities ?? []).map((e) => ({ id: e.id, name: e.name ?? "", entityType: e.entityType ?? "trust", taxTreatment: e.taxTreatment ?? "ordinary" })),
    deductions: deductionRows,
    familyMembers: (tree.familyMembers ?? []).map((f) => ({ id: f.id, role: f.role, relationship: f.relationship, dateOfBirth: f.dateOfBirth, claimedAsDependent: f.claimedAsDependent ?? "auto" })),
    medicare: (tree.medicareCoverage ?? []).map((c) => ({ owner: c.owner, priorYearMagi: c.priorYearMagi })),
  };
}
