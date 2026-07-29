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
import type { ImportPayload, MatchAnnotation } from "./types";

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
 * ONLY a `"hint"` resolution is forwarded — one where the statement's verbatim
 * registration line actually named somebody on the roster. The other two
 * sources are guesses, and a guess is worse than silence here because
 * `ownerAgreement` has no "maybe": it scores 1.0 or 0.0, never the neutral 0.5
 * it reserves for genuinely unknown ownership.
 *
 * - `"default"` is the parser's trailing "somebody has to own it, so use the
 *   client" fallback. Correct when WRITING an account, a fabrication when
 *   matching one: it zeroes the owner term against every spouse-owned
 *   candidate, pushing a genuine renamed-account match under SCORE_FLOOR and
 *   out of the picker entirely.
 * - `"coarse"` is the model's inferred client/spouse/joint enum.
 *   `prompts/account-statement.ts` tells the extractor to fill it by inferring
 *   "from account title or registration", so it is present on essentially every
 *   row and asserted with the same confidence whether the registration was
 *   unambiguous or absent. Scoring it as evidence was the more damaging half:
 *   W_OWNER (0.25) + W_CATEGORY (0.20) is exactly SCORE_FLOOR (0.45) under a
 *   `>=` test, so a correctly-guessed owner plus an agreeing category cleared
 *   the floor with ZERO name overlap — making name, the point of this ladder,
 *   decorative on the dominant production path.
 *
 * The cost is real and accepted: an account registered to a trust, or to anyone
 * else off the roster, no longer earns owner credit from the coarse enum, so a
 * renamed one can fall under the floor and be offered as `new`. That was the
 * behaviour before this branch too, so it forgoes a gain rather than causing a
 * regression — and the wrongly-surfaced direction is the more expensive error,
 * since a `fuzzy` row is skipped at commit while a bad merge overwrites.
 */
function resolveOwnerIds(
  row: { ownerNameHint?: string; owner?: "client" | "spouse" | "joint" },
  family: OwnerMatchFamilyMember[],
): string[] {
  if (family.length === 0) return [];
  const { owners, source } = resolveOwnersFromHint(row.ownerNameHint, row.owner, family);
  if (source !== "hint") return [];
  // Narrowing only — this parser never emits entity or external-beneficiary
  // owners, but AccountOwner is a union and the ids have to be extracted.
  return owners.flatMap((o) => (o.kind === "family_member" ? [o.familyMemberId] : []));
}

/**
 * Annotate `rows` such that no existing record is claimed twice.
 *
 * Each row is matched against only the candidates not yet claimed by an
 * earlier row, so a second row that would have hit the same record degrades
 * rather than hitting it too. Without this the commit step issues two UPDATEs
 * against one record — last-wins — and the other imported row disappears with
 * no warning. Only `exact` claims: `fuzzy` is a ranked suggestion the advisor
 * still has to confirm, so it reserves nothing.
 *
 * A blocked row must not degrade all the way to `new`. `new` is an INSERT at
 * commit, and the merge step folds every uploaded file's rows into one payload
 * with no cross-file dedupe (see `merge.ts`), so one account appearing in two
 * overlapping statements would silently become two accounts — double-counting
 * net worth and every projection downstream. Two extractions of the same
 * living-expense total would likewise double-count cash flow. So when the
 * normal pass yields `new`, we ask what the row would have matched in an
 * unclaimed world; if that is an `exact` on an id someone else already took,
 * the row is a duplicate, not a new record, and becomes `fuzzy`. Every commit
 * module skips `fuzzy`, so the row writes nothing, renders as "Ambiguous" in
 * the review step, and counts in `result.skipped` — the pre-branch outcome,
 * surfaced instead of silent. A row that scores nothing against the FULL
 * candidate set is genuinely new and stays `new`.
 *
 * The probe passes an empty `claimed` rather than only an unfiltered candidate
 * list because `annotateExpenses` reads the set directly (its slot pool is not
 * in `candidates` at all in onboarding mode) — filtering alone would return the
 * post-claim answer and the expenses half would never degrade.
 */
function claimOnce<T, C extends { id: string }>(
  rows: T[],
  candidates: C[],
  annotate: (row: T, available: C[], claimed: ReadonlySet<string>) => MatchAnnotation,
): Array<T & { match: MatchAnnotation }> {
  const claimed = new Set<string>();
  return rows.map((row) => {
    const available = candidates.filter((c) => !claimed.has(c.id));
    const match = annotate(row, available, claimed);
    if (match.kind === "exact") {
      claimed.add(match.existingId);
      return { ...row, match };
    }
    if (match.kind === "new" && claimed.size > 0) {
      const unclaimed = annotate(row, candidates, new Set<string>());
      if (unclaimed.kind === "exact" && claimed.has(unclaimed.existingId)) {
        // Empty `candidates` deliberately: the picker builds its option list
        // from the component's own `candidates` prop via `candidatesForRow`,
        // not from this annotation, so carrying the blocked id here would gain
        // the advisor nothing and would only invite them to re-select the
        // record another row already claimed — recreating the double-UPDATE
        // claimOnce exists to prevent.
        return { ...row, match: { kind: "fuzzy", candidates: [] } };
      }
    }
    return { ...row, match };
  });
}

/**
 * Pure annotation pass: walks each entity-array in the payload and
 * stamps `match` based on the supplied candidate set. The orchestrator
 * (`runMatchingPass`) builds the candidate set from the DB; tests can
 * pass any synthetic set.
 *
 * Every row type goes through `claimOnce`, so within one call no two rows of
 * the same type return `exact` on the same `existingId`.
 */
export function annotatePayload(
  payload: ImportPayload,
  candidates: MatchCandidates,
): ImportPayload {
  return {
    ...payload,
    accounts: claimOnce(payload.accounts, candidates.accounts, (row, available) =>
      matchAccount(row, available, resolveOwnerIds(row, candidates.family)),
    ),
    incomes: claimOnce(payload.incomes, candidates.incomes, matchIncome),
    expenses: annotateExpenses(payload, candidates),
    liabilities: claimOnce(payload.liabilities, candidates.liabilities, matchLiability),
    dependents: claimOnce(payload.dependents, candidates.familyMembers, matchFamilyMember),
    lifePolicies: claimOnce(payload.lifePolicies, candidates.lifePolicies, matchLifePolicy),
    wills: claimOnce(payload.wills, candidates.wills, matchWill),
    entities: claimOnce(payload.entities, candidates.entities, matchEntity),
  };
}

/**
 * Expenses carry two candidate pools: the persistent Current/Retirement living
 * slots and ordinary expense rows. A slot wins when it hits, but only once.
 *
 * Both pools name rows of the SAME table under the same ids — `loadLivingSlots`
 * selects the `isDefault` living expenses, and `loadCandidates` selects every
 * expense in the scenario with no such filter — so one slot is reachable
 * through either matcher and a claim made through one has to be visible to the
 * other. Hence a single `claimed` set threaded through `claimOnce` rather than
 * a slot-local one: an advisor who renames a default slot past
 * `matchLivingSlot`'s patterns ("Household Spending" fails CURRENT_RE) makes
 * that row exact-matchable by name through `matchExpense`, and a later
 * "Living Expenses" row would still claim the same slot by role.
 *
 * The slot branch only consults the set — `claimOnce` records the claim, since
 * it records every `exact` it returns. And it must consult the SET, not the
 * filtered `available` list: in onboarding mode `candidates.expenses` is empty
 * while `livingSlots` is populated, so a slot is absent from `available` for
 * reasons that have nothing to do with being claimed, and keying off it would
 * disable slot matching entirely.
 *
 * The set arrives as an ARGUMENT rather than being captured lexically, which
 * makes this closure a pure function of its inputs. `claimOnce`'s duplicate
 * probe depends on that: it re-asks the question with an empty `claimed`, and a
 * captured set would ignore the substitution and hand back the same post-claim
 * answer, leaving duplicate living-expense totals to insert as new rows.
 */
function annotateExpenses(
  payload: ImportPayload,
  candidates: MatchCandidates,
): ImportPayload["expenses"] {
  return claimOnce(
    payload.expenses,
    candidates.expenses,
    (row, available, claimed) => {
      const slotMatch = matchLivingSlot(row, candidates.livingSlots);
      if (slotMatch?.kind === "exact" && !claimed.has(slotMatch.existingId)) {
        return slotMatch;
      }
      return matchExpense(row, available);
    },
  );
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
