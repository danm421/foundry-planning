import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import {
  accounts,
  entities,
  expenses,
  familyMembers,
  incomes,
  liabilities,
  lifeInsurancePolicies,
  scenarios,
  wills,
} from "@/db/schema";
import type { YearRef } from "@/lib/milestones";

import { matchAccount, type AccountCandidate } from "./match-keys/account";
import { matchEntity, type EntityCandidate } from "./match-keys/entity";
import { matchExpense, type ExpenseCandidate } from "./match-keys/expense";
import {
  matchFamilyMember,
  type FamilyMemberCandidate,
} from "./match-keys/family-member";
import { matchIncome, type IncomeCandidate } from "./match-keys/income";
import { matchLiability, type LiabilityCandidate } from "./match-keys/liability";
import {
  matchLifePolicy,
  type LifePolicyCandidate,
} from "./match-keys/life-policy";
import {
  livingSlotRole,
  matchLivingSlot,
  type LivingSlot,
} from "./match-keys/living-slot";
import { matchWill, type WillCandidate } from "./match-keys/will";
import type { ImportPayload } from "./types";

export interface MatchCandidates {
  accounts: AccountCandidate[];
  incomes: IncomeCandidate[];
  expenses: ExpenseCandidate[];
  liabilities: LiabilityCandidate[];
  familyMembers: FamilyMemberCandidate[];
  lifePolicies: LifePolicyCandidate[];
  wills: WillCandidate[];
  entities: EntityCandidate[];
  livingSlots: LivingSlot[];
}

export function emptyCandidates(): MatchCandidates {
  return {
    accounts: [],
    incomes: [],
    expenses: [],
    liabilities: [],
    familyMembers: [],
    lifePolicies: [],
    wills: [],
    entities: [],
    livingSlots: [],
  };
}

/**
 * Pure annotation pass: walks each entity-array in the payload and
 * stamps `match` based on the supplied candidate set. The orchestrator
 * (`runMatchingPass`) builds the candidate set from the DB; tests can
 * pass any synthetic set.
 */
export function annotatePayload(
  payload: ImportPayload,
  candidates: MatchCandidates,
): ImportPayload {
  return {
    ...payload,
    accounts: payload.accounts.map((row) => ({
      ...row,
      match: matchAccount(row, candidates.accounts),
    })),
    incomes: payload.incomes.map((row) => ({
      ...row,
      match: matchIncome(row, candidates.incomes),
    })),
    expenses: payload.expenses.map((row) => ({
      ...row,
      match:
        matchLivingSlot(row, candidates.livingSlots) ??
        matchExpense(row, candidates.expenses),
    })),
    liabilities: payload.liabilities.map((row) => ({
      ...row,
      match: matchLiability(row, candidates.liabilities),
    })),
    dependents: payload.dependents.map((row) => ({
      ...row,
      match: matchFamilyMember(row, candidates.familyMembers),
    })),
    lifePolicies: payload.lifePolicies.map((row) => ({
      ...row,
      match: matchLifePolicy(row, candidates.lifePolicies),
    })),
    wills: payload.wills.map((row) => ({
      ...row,
      match: matchWill(row, candidates.wills),
    })),
    entities: payload.entities.map((row) => ({
      ...row,
      match: matchEntity(row, candidates.entities),
    })),
  };
}

export interface RunMatchingPassArgs {
  payload: ImportPayload;
  clientId: string;
  scenarioId: string;
  mode: "onboarding" | "updating";
}

/**
 * Orchestrates the matching pass. In both modes we load the persistent
 * Current/Retirement living-expense slots and use them to link imported
 * living-expense totals (via `matchLivingSlot`'s precedence over
 * `matchExpense`). In onboarding mode the other row sets stay as
 * `{ kind: "new" }` (already seeded by mergeExtractionResults) since there
 * is nothing else to match against yet. In updating mode we additionally
 * load all eight canonical row sets in parallel and project them into
 * Candidate shapes before calling `annotatePayload`.
 */
export async function runMatchingPass(
  args: RunMatchingPassArgs,
): Promise<ImportPayload> {
  const livingSlots = await loadLivingSlots(args.clientId, args.scenarioId);
  const candidates: MatchCandidates =
    args.mode === "onboarding"
      ? { ...emptyCandidates(), livingSlots }
      : { ...(await loadCandidates(args.clientId, args.scenarioId)), livingSlots };
  const annotated = annotatePayload(args.payload, candidates);
  annotated.expenseSlots = livingSlots.map((s) => ({ id: s.id, name: s.name }));
  return annotated;
}

/**
 * Load the two seeded `isDefault` living-expense slots (current + retirement)
 * for the scenario this import commits to. Onboarding imports leave scenarioId
 * empty, so we resolve the base-case scenario the same way the commit route
 * does — the slot ids MUST match the rows the commit will update.
 */
async function loadLivingSlots(
  clientId: string,
  scenarioId: string,
): Promise<LivingSlot[]> {
  let resolvedScenarioId = scenarioId;
  if (!resolvedScenarioId) {
    const [base] = await db
      .select({ id: scenarios.id })
      .from(scenarios)
      .where(and(eq(scenarios.clientId, clientId), eq(scenarios.isBaseCase, true)));
    resolvedScenarioId = base?.id ?? "";
  }
  if (!resolvedScenarioId) return [];

  const rows = await db
    .select({
      id: expenses.id,
      name: expenses.name,
      startYearRef: expenses.startYearRef,
    })
    .from(expenses)
    .where(
      and(
        eq(expenses.clientId, clientId),
        eq(expenses.scenarioId, resolvedScenarioId),
        eq(expenses.type, "living"),
        eq(expenses.isDefault, true),
      ),
    );

  const slots: LivingSlot[] = [];
  for (const r of rows) {
    const role = livingSlotRole((r.startYearRef ?? null) as YearRef | null);
    if (role) slots.push({ id: r.id, name: r.name, role });
  }
  return slots;
}

async function loadCandidates(
  clientId: string,
  scenarioId: string,
): Promise<MatchCandidates> {
  const [
    accountsRows,
    incomesRows,
    expensesRows,
    liabilitiesRows,
    familyRows,
    policyRows,
    willRows,
    entityRows,
  ] = await Promise.all([
    db
      .select({
        id: accounts.id,
        name: accounts.name,
        category: accounts.category,
        accountNumberLast4: accounts.accountNumberLast4,
        custodian: accounts.custodian,
        value: accounts.value,
      })
      .from(accounts)
      .where(and(eq(accounts.clientId, clientId), eq(accounts.scenarioId, scenarioId))),
    db
      .select({
        id: incomes.id,
        type: incomes.type,
        name: incomes.name,
        owner: incomes.owner,
      })
      .from(incomes)
      .where(and(eq(incomes.clientId, clientId), eq(incomes.scenarioId, scenarioId))),
    db
      .select({ id: expenses.id, type: expenses.type, name: expenses.name })
      .from(expenses)
      .where(and(eq(expenses.clientId, clientId), eq(expenses.scenarioId, scenarioId))),
    db
      .select({ id: liabilities.id, name: liabilities.name, balance: liabilities.balance })
      .from(liabilities)
      .where(
        and(eq(liabilities.clientId, clientId), eq(liabilities.scenarioId, scenarioId)),
      ),
    db
      .select({
        id: familyMembers.id,
        firstName: familyMembers.firstName,
        lastName: familyMembers.lastName,
        dateOfBirth: familyMembers.dateOfBirth,
      })
      .from(familyMembers)
      .where(eq(familyMembers.clientId, clientId)),
    db
      .select({
        id: lifeInsurancePolicies.accountId,
        carrier: lifeInsurancePolicies.carrier,
        policyNumberLast4: lifeInsurancePolicies.policyNumberLast4,
        insuredPerson: accounts.insuredPerson,
        policyType: lifeInsurancePolicies.policyType,
        faceValue: lifeInsurancePolicies.faceValue,
      })
      .from(lifeInsurancePolicies)
      .innerJoin(accounts, eq(accounts.id, lifeInsurancePolicies.accountId))
      .where(and(eq(accounts.clientId, clientId), eq(accounts.scenarioId, scenarioId))),
    db
      .select({ id: wills.id, grantor: wills.grantor })
      .from(wills)
      .where(eq(wills.clientId, clientId)),
    db
      .select({
        id: entities.id,
        name: entities.name,
        entityType: entities.entityType,
      })
      .from(entities)
      .where(eq(entities.clientId, clientId)),
  ]);

  return {
    accounts: accountsRows.map((r) => ({
      id: r.id,
      name: r.name,
      category: r.category,
      accountNumberLast4: r.accountNumberLast4,
      custodian: r.custodian,
      value: Number(r.value),
    })),
    incomes: incomesRows.map((r) => ({
      id: r.id,
      type: r.type,
      name: r.name,
      owner: r.owner,
    })),
    expenses: expensesRows.map((r) => ({
      id: r.id,
      type: r.type,
      name: r.name,
    })),
    liabilities: liabilitiesRows.map((r) => ({
      id: r.id,
      name: r.name,
      balance: Number(r.balance),
    })),
    familyMembers: familyRows.map((r) => ({
      id: r.id,
      firstName: r.firstName,
      lastName: r.lastName,
      dateOfBirth: r.dateOfBirth,
    })),
    lifePolicies: policyRows.flatMap((r) =>
      r.insuredPerson === null
        ? []
        : [
            {
              id: r.id,
              carrier: r.carrier,
              policyNumberLast4: r.policyNumberLast4,
              insuredPerson: r.insuredPerson,
              policyType: r.policyType,
              faceValue: Number(r.faceValue),
            },
          ],
    ),
    wills: willRows.map((r) => ({ id: r.id, grantor: r.grantor })),
    entities: entityRows.map((r) => ({
      id: r.id,
      name: r.name,
      entityType: r.entityType,
    })),
    // TODO(Task 3): load the persistent Current/Retirement living-expense
    // slots for this scenario. Stubbed empty here so MatchCandidates stays
    // fully typed until that task wires the DB query.
    livingSlots: [],
  };
}
