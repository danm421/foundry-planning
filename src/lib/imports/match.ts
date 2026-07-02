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
  wills,
} from "@/db/schema";

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
      match: matchExpense(row, candidates.expenses),
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
 * Orchestrates the matching pass. In onboarding mode every row stays as
 * `{ kind: "new" }` (already seeded by mergeExtractionResults), so we
 * skip the DB lookup entirely. In updating mode we load all eight
 * canonical row sets in parallel, project them into Candidate shapes,
 * and call `annotatePayload`.
 */
export async function runMatchingPass(
  args: RunMatchingPassArgs,
): Promise<ImportPayload> {
  if (args.mode === "onboarding") {
    return args.payload;
  }
  const candidates = await loadCandidates(args.clientId, args.scenarioId);
  return annotatePayload(args.payload, candidates);
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
  };
}
