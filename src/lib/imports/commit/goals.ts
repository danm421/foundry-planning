import { and, eq, isNull } from "drizzle-orm";

import { accounts, assetTransactions, expenses, familyMembers } from "@/db/schema";
import { replaceDedicatedAccounts } from "@/lib/clients/dedicated-accounts";
import type { AccountSubType } from "@/lib/extraction/types";
import type { ImportPayload } from "../types";
import { emptyResult, type CommitContext, type CommitResult, type Tx } from "./types";

/**
 * Writes the goals the advisor reviewed on the Goals step.
 *
 * CROSS-TAB REFERENCES RESOLVE BY QUERY, NOT BY ID REMAP. At assemble time the
 * funding 529 and the student are extracted rows with no DB id, so the goal
 * carries their NAMES. This module runs after `accounts` and `family-members`
 * in COMMIT_TABS and looks the ids up from rows those tabs already wrote — the
 * same way `commitLiabilities` resolves a mortgage to its property via
 * `mortgage-link.ts`, including scoping the candidate set by category BEFORE
 * matching on name (`real_estate` there, `education_savings`/`529` here) so a
 * same-named row of the wrong kind is never a match candidate at all.
 *
 * BLANK IS NOT COMMITTED. An education goal with no annual amount is skipped
 * rather than written at $0. A $0 education goal is the phase-2 "$0 spending"
 * defect wearing a different expense type, and the advisor is already flagged
 * in the wizard.
 */
export async function commitGoals(
  tx: Tx,
  payload: ImportPayload,
  ctx: CommitContext,
): Promise<CommitResult> {
  const result = emptyResult();
  const goals = payload.goals;
  if (!goals) return result;

  const accountRows = await tx
    .select({
      id: accounts.id,
      name: accounts.name,
      category: accounts.category,
      subType: accounts.subType,
      beneficiaryFamilyMemberId: accounts.beneficiaryFamilyMemberId,
      beneficiaryName: accounts.beneficiaryName,
    })
    .from(accounts)
    .where(and(eq(accounts.clientId, ctx.clientId), eq(accounts.scenarioId, ctx.scenarioId)));

  // Current beneficiary state per id, so the "only fill a null" guard below can
  // be decided in application code rather than trusted to the SQL WHERE alone.
  const beneficiaryStateById = new Map(
    accountRows.map((a) => [a.id, { familyMemberId: a.beneficiaryFamilyMemberId, name: a.beneficiaryName }]),
  );

  // Education dedicated-funding names resolve ONLY against education accounts.
  // `category === "education_savings"` is what Task 4 (commit 547234ef0)
  // heals a subType:"529" row into on BOTH insert and update via
  // `resolveAccountCategory` in `commit/accounts.ts`, so a 529 is already
  // `education_savings` by the time this module runs (after the `accounts`
  // tab, per COMMIT_TABS order). `subType === "529"` is kept as a fallback so
  // a row that somehow escaped that heal still resolves. Unscoped, a checking
  // account sharing a display name with a 529 (or a name reused after a
  // rename) could resolve an education goal onto it — joining a non-education
  // account into `expense_dedicated_accounts` and stamping a 529 beneficiary
  // onto it.
  const educationAccountRows = accountRows.filter(
    (a) => a.category === "education_savings" || a.subType === "529",
  );

  // Name -> queue of matching account ids, consumed FIFO. A plain
  // name -> id Map would keep only the LAST same-named account, so two 529s
  // both named "529 Plan" would both resolve to the second one — the first
  // left with no funding link at all, the second joined to two different
  // education expenses. Task 5 de-duped goal ids for exactly this reason
  // ("edu:<slug>", "edu:<slug>-2"); this queue is the same fix one layer down.
  // Consumption order follows whatever order the SELECT returns — Postgres
  // gives no ordering guarantee absent an ORDER BY, and `createdAt` cannot
  // disambiguate rows inserted by the same transaction (`now()` is constant
  // for the whole transaction). In practice a sequential scan over rows just
  // inserted in this same commit returns them in insertion order, so the
  // common case (two goals, two like-named accounts, same import) resolves
  // correctly; the guarantee that matters — an account is claimed by at most
  // one goal — holds regardless of order.
  const nameQueues = new Map<string, string[]>();
  for (const row of educationAccountRows) {
    const key = row.name.trim().toLowerCase();
    const queue = nameQueues.get(key);
    if (queue) queue.push(row.id);
    else nameQueues.set(key, [row.id]);
  }

  const memberRows = await tx
    .select({ id: familyMembers.id, firstName: familyMembers.firstName })
    .from(familyMembers)
    .where(eq(familyMembers.clientId, ctx.clientId));
  const memberByFirstName = new Map(
    memberRows.map((m) => [(m.firstName ?? "").trim().toLowerCase(), m.id]),
  );

  // ── Education goals ──
  for (const goal of goals.education) {
    if (goal.annualAmount.value == null) {
      result.skipped += 1;
      continue;
    }

    const startYear = goal.startYear.value;
    const years = goal.years.value ?? 1;
    if (startYear == null) {
      result.skipped += 1;
      result.warnings.push(
        `Education goal "${goal.name.value ?? goal.id}" has no start year and was not created.`,
      );
      continue;
    }

    const resolvedAccountIds: string[] = [];
    const unresolvedNames: string[] = [];
    for (const name of goal.dedicatedAccountNames) {
      const queue = nameQueues.get(name.trim().toLowerCase());
      const id = queue?.shift();
      if (id) resolvedAccountIds.push(id);
      else unresolvedNames.push(name);
    }

    const forFamilyMemberId =
      goal.forFamilyMemberName.value != null
        ? (memberByFirstName.get(goal.forFamilyMemberName.value.trim().toLowerCase()) ?? null)
        : null;

    const [row] = await tx
      .insert(expenses)
      .values({
        clientId: ctx.clientId,
        scenarioId: ctx.scenarioId,
        type: "education",
        name: goal.name.value ?? "Education Goal",
        annualAmount: String(goal.annualAmount.value),
        startYear,
        endYear: startYear + Math.max(1, years) - 1,
        growthRate: String(goal.growthRate.value ?? 0.05),
        payShortfallOutOfPocket: goal.payShortfallOutOfPocket.value ?? false,
        forFamilyMemberId,
        source: "extracted",
      })
      .returning({ id: expenses.id });

    // A name that failed to resolve is reported AFTER every name on this goal
    // has been tried, so the wording reflects whether the goal ended up with
    // SOME dedicated funding or none — a goal that resolved one of two named
    // 529s was not "created without dedicated funding".
    for (const name of unresolvedNames) {
      result.warnings.push(
        resolvedAccountIds.length > 0
          ? `Could not find the funding account "${name}" for education goal ` +
              `"${goal.name.value ?? goal.id}" — it was not linked as dedicated funding.`
          : `Could not find the funding account "${name}" for education goal ` +
              `"${goal.name.value ?? goal.id}" — the goal was created without dedicated funding.`,
      );
    }

    if (resolvedAccountIds.length > 0) {
      await replaceDedicatedAccounts(tx, row.id, resolvedAccountIds);

      // Extraction captures no 529 beneficiary (ExtractedAccount has no such
      // field), so the account commits with a null beneficiary and is
      // attributed to nobody. The student the advisor confirmed on this goal is
      // the best evidence there is. Only fill a NULL — never overwrite a
      // beneficiary someone set deliberately. Decided from the state read at
      // the top of this function (belt); the SQL isNull(...) conditions below
      // repeat the same guard at the database (suspenders).
      if (forFamilyMemberId) {
        for (const accountId of resolvedAccountIds) {
          const state = beneficiaryStateById.get(accountId);
          if (state && state.familyMemberId == null && state.name == null) {
            await tx
              .update(accounts)
              .set({ beneficiaryFamilyMemberId: forFamilyMemberId, updatedAt: new Date() })
              .where(
                and(
                  eq(accounts.id, accountId),
                  eq(accounts.clientId, ctx.clientId),
                  isNull(accounts.beneficiaryFamilyMemberId),
                  isNull(accounts.beneficiaryName),
                ),
              );
            state.familyMemberId = forFamilyMemberId;
          }
        }
      }
    }
    result.created += 1;
  }

  // ── Home-purchase goals ──
  // Plain string fields straight off the form draft — nothing here is derived,
  // so there is no provenance envelope to unwrap.
  const accountIds = new Set(accountRows.map((a) => a.id));
  for (const goal of goals.homePurchases) {
    const name = goal.name.trim() || goal.assetName.trim();
    const price = Number(goal.purchasePrice);
    const hasPrice = Number.isFinite(price) && price > 0;
    // Same minimum the advisor-facing form enforces (`buyHasData` in
    // add-asset-transaction-form.tsx): an asset name OR a real price.
    if (!name && !hasPrice) {
      result.skipped += 1;
      continue;
    }
    const year = Number(goal.year);
    if (!Number.isFinite(year) || year <= 0) {
      result.skipped += 1;
      result.warnings.push(`Planned purchase "${name || goal.id}" has no year and was not created.`);
      continue;
    }

    // The picker only offers already-committed accounts, so this is a real id.
    // Verified against this client's own rows anyway — an id from a stale
    // payload must never reach another client's account.
    const fundingAccountId =
      goal.fundingAccountId && accountIds.has(goal.fundingAccountId) ? goal.fundingAccountId : null;
    if (goal.fundingAccountId && !fundingAccountId) {
      result.warnings.push(
        `The down-payment account for "${name}" is no longer available; the purchase was created without one.`,
      );
    }

    const num = (raw: string): string | null => {
      const n = Number(raw);
      return raw.trim() !== "" && Number.isFinite(n) ? String(n) : null;
    };

    await tx.insert(assetTransactions).values({
      clientId: ctx.clientId,
      scenarioId: ctx.scenarioId,
      name: name || "Planned purchase",
      type: "buy",
      year,
      assetName: goal.assetName.trim() || name,
      assetCategory: "real_estate",
      // `HomePurchaseGoal.assetSubType` is bare `string` (form state, not a
      // provenance-wrapped field — see the type's doc comment), so this cast
      // is sound only because the wizard populates it exclusively from the
      // bounded `SUB_TYPE_BY_CATEGORY.real_estate` widget options.
      assetSubType: (goal.assetSubType || "primary_residence") as AccountSubType,
      purchasePrice: num(goal.purchasePrice),
      growthRate: num(goal.growthRate),
      basis: num(goal.basis),
      fundingAccountId,
      // The mortgage block is only written when the advisor expanded it.
      mortgageAmount: goal.showMortgage ? num(goal.mortgageAmount) : null,
      mortgageRate: goal.showMortgage ? num(goal.mortgageRate) : null,
      mortgageTermMonths: goal.showMortgage ? Number(goal.mortgageTermMonths) || null : null,
    });
    result.created += 1;
  }

  return result;
}
