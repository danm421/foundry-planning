import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import {
  accountOwners,
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
import { resolveOwnersFromHint, type OwnerMatchFamilyMember } from "./owner-match";
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
  /**
   * Household roster, used to resolve an extracted account's registration
   * hint into family_member ids so ownership can be compared against
   * `AccountCandidate.ownerIds`. Empty in onboarding mode.
   */
  family: OwnerMatchFamilyMember[];
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
    family: [],
  };
}

/**
 * Resolve an extracted account's owners to family_member ids for *matching*,
 * reusing the same registration-hint parser the commit step uses so the two
 * agree on who owns what.
 *
 * Only evidence-derived ownership is forwarded. The parser ends in a "somebody
 * has to own it, so use the client" default — correct when writing an account,
 * wrong as matching evidence: a fabricated client id replaces
 * `ownerAgreement`'s neutral 0.5 with 0.0 against every spouse-owned
 * candidate, which can push a genuine renamed-account match under SCORE_FLOOR
 * and drop it from the picker entirely. So a `"default"` resolution yields no
 * ids and scores neutral — an account with no registration hint, one
 * registered to a trust or any other name the roster does not contain, or one
 * whose `owner: "spouse"` names a spouse this household does not have, costs
 * nothing rather than counting against the right candidate.
 */
function resolveOwnerIds(
  row: { ownerNameHint?: string; owner?: "client" | "spouse" | "joint" },
  family: OwnerMatchFamilyMember[],
): string[] {
  if (family.length === 0) return [];
  const { owners, source } = resolveOwnersFromHint(row.ownerNameHint, row.owner, family);
  if (source === "default") return [];
  // Narrowing only — this parser never emits entity or external-beneficiary
  // owners, but AccountOwner is a union and the ids have to be extracted.
  return owners.flatMap((o) => (o.kind === "family_member" ? [o.familyMemberId] : []));
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
  // One row -> one slot: the first row that matches a given living-expense
  // slot claims it. Any later row that would resolve to the same slot id
  // falls through to matchExpense instead of re-claiming it (which would
  // otherwise cause a last-wins UPDATE at commit and silently drop a row).
  const claimedSlotIds = new Set<string>();
  return {
    ...payload,
    accounts: payload.accounts.map((row) => ({
      ...row,
      match: matchAccount(row, candidates.accounts, resolveOwnerIds(row, candidates.family)),
    })),
    incomes: payload.incomes.map((row) => ({
      ...row,
      match: matchIncome(row, candidates.incomes),
    })),
    expenses: payload.expenses.map((row) => {
      const slotMatch = matchLivingSlot(row, candidates.livingSlots);
      if (
        slotMatch &&
        slotMatch.kind === "exact" &&
        !claimedSlotIds.has(slotMatch.existingId)
      ) {
        claimedSlotIds.add(slotMatch.existingId);
        return { ...row, match: slotMatch };
      }
      return { ...row, match: matchExpense(row, candidates.expenses) };
    }),
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
  annotated.expenseSlots = livingSlots.map((s) => ({ id: s.id, name: s.name, role: s.role }));
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
    ownerRows,
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
        role: familyMembers.role,
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
    db
      .select({
        accountId: accountOwners.accountId,
        familyMemberId: accountOwners.familyMemberId,
      })
      .from(accountOwners)
      .innerJoin(accounts, eq(accounts.id, accountOwners.accountId))
      .where(and(eq(accounts.clientId, clientId), eq(accounts.scenarioId, scenarioId))),
  ]);

  const ownerIdsByAccount = new Map<string, string[]>();
  for (const r of ownerRows) {
    // Entity- and external-beneficiary-owned rows have a null familyMemberId
    // and contribute nothing to family-based owner comparison.
    if (!r.familyMemberId) continue;
    const list = ownerIdsByAccount.get(r.accountId);
    if (list) list.push(r.familyMemberId);
    else ownerIdsByAccount.set(r.accountId, [r.familyMemberId]);
  }

  return {
    accounts: accountsRows.map((r) => ({
      id: r.id,
      name: r.name,
      category: r.category,
      accountNumberLast4: r.accountNumberLast4,
      custodian: r.custodian,
      value: Number(r.value),
      ownerIds: ownerIdsByAccount.get(r.id) ?? [],
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
    family: familyRows.map((r) => ({
      id: r.id,
      role: r.role,
      firstName: r.firstName,
      lastName: r.lastName,
    })),
    // overridden by runMatchingPass; empty stub keeps the type total
    livingSlots: [],
  };
}
