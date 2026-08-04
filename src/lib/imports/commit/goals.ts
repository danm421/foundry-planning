import { and, eq, isNull } from "drizzle-orm";

import { accounts, assetTransactions, clients, expenses, familyMembers } from "@/db/schema";
import { applyRiskPortfolioToScenario, resolveRiskPortfolioId } from "@/lib/cma/resolve-risk-portfolio";
import { replaceDedicatedAccounts } from "@/lib/clients/dedicated-accounts";
import type { AccountSubType } from "@/lib/extraction/types";
import { isRiskLevel } from "@/lib/risk-levels";
import { manualTolerancePatch } from "@/lib/risk/apply-rtq";
import { recomputeProfileTx } from "@/lib/risk/profile";
import { getExistingId, linkCreated, type ImportPayload } from "../types";
import { emptyResult, type CommitContext, type CommitResult, type Tx } from "./types";

/**
 * Parses a numeric text field to the decimal string a numeric column expects,
 * or `null` for blank/whitespace/non-finite input. `raw.trim()` (not `!== ""`)
 * treats a whitespace-only field as empty, and `Number.isFinite` keeps stray
 * non-numeric text from ever landing as "NaN".
 */
function num(raw: string): string | null {
  const n = Number(raw);
  return raw.trim() !== "" && Number.isFinite(n) ? String(n) : null;
}

/**
 * Like `num`, but divides by 100. `HomePurchaseGoal.growthRate`/`mortgageRate`
 * mirror `BuyLegDraft`, which documents them as PERCENT strings
 * (asset-transaction-leg-model.ts:38,43) — `BuyLegEditor`'s `PercentInput`s
 * write the raw typed percent ("3.5") onto goal state. The advisor-facing form
 * converts on submit (`optDec` in use-asset-transaction-legs.ts:14); this path
 * must too, or "3.5" lands in a decimal(5,4) column as 3.5 — no error (ceiling
 * 9.9999), just a home appreciating 350% a year.
 */
function pct(raw: string): string | null {
  const n = Number(raw);
  return raw.trim() !== "" && Number.isFinite(n) ? String(n / 100) : null;
}

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

    const goalValues = {
      type: "education" as const,
      name: goal.name.value ?? "Education Goal",
      annualAmount: String(goal.annualAmount.value),
      startYear,
      endYear: startYear + Math.max(1, years) - 1,
      growthRate: String(goal.growthRate.value ?? 0.05),
      payShortfallOutOfPocket: goal.payShortfallOutOfPocket.value ?? false,
      forFamilyMemberId,
    };

    // Re-commit: update the expense this goal already created rather than
    // adding a second one. `replaceDedicatedAccounts` below is already a
    // replace, so the funding links converge either way.
    let expenseId = getExistingId(goal);
    if (expenseId) {
      await tx
        .update(expenses)
        .set({ ...goalValues, updatedAt: new Date() })
        .where(
          and(
            eq(expenses.id, expenseId),
            eq(expenses.clientId, ctx.clientId),
            eq(expenses.scenarioId, ctx.scenarioId),
          ),
        );
      result.updated += 1;
    } else {
      const [inserted] = await tx
        .insert(expenses)
        .values({
          clientId: ctx.clientId,
          scenarioId: ctx.scenarioId,
          ...goalValues,
          source: "extracted",
        })
        .returning({ id: expenses.id });
      expenseId = inserted.id;
      linkCreated(goal, expenseId);
      result.created += 1;
    }

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
      await replaceDedicatedAccounts(tx, expenseId, resolvedAccountIds);

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

    const purchaseValues = {
      name: name || "Planned purchase",
      type: "buy" as const,
      year,
      assetName: goal.assetName.trim() || name,
      assetCategory: "real_estate" as const,
      // `HomePurchaseGoal.assetSubType` is bare `string` (form state, not a
      // provenance-wrapped field — see the type's doc comment), so this cast
      // is sound only because the wizard populates it exclusively from the
      // bounded `SUB_TYPE_BY_CATEGORY.real_estate` widget options.
      assetSubType: (goal.assetSubType || "primary_residence") as AccountSubType,
      purchasePrice: num(goal.purchasePrice),
      growthRate: pct(goal.growthRate),
      basis: num(goal.basis),
      fundingAccountId,
      // The mortgage block is only written when the advisor expanded it.
      mortgageAmount: goal.showMortgage ? num(goal.mortgageAmount) : null,
      mortgageRate: goal.showMortgage ? pct(goal.mortgageRate) : null,
      mortgageTermMonths: goal.showMortgage ? Number(goal.mortgageTermMonths) || null : null,
    };

    const purchaseId = getExistingId(goal);
    if (purchaseId) {
      await tx
        .update(assetTransactions)
        .set(purchaseValues)
        .where(
          and(
            eq(assetTransactions.id, purchaseId),
            eq(assetTransactions.clientId, ctx.clientId),
            eq(assetTransactions.scenarioId, ctx.scenarioId),
          ),
        );
      result.updated += 1;
      continue;
    }

    const [insertedPurchase] = await tx
      .insert(assetTransactions)
      .values({
        clientId: ctx.clientId,
        scenarioId: ctx.scenarioId,
        ...purchaseValues,
      })
      .returning({ id: assetTransactions.id });
    linkCreated(goal, insertedPurchase.id);
    result.created += 1;
  }

  // ── Risk tolerance ──
  // The advisor-stated rung (Goals step) writes clients.risk_tolerance and, when
  // the firm has a model portfolio tagged for that rung, points the base
  // scenario's taxable+retirement portfolios at it. Blank/derived (unstated) is
  // a no-op — nothing is committed until the advisor actually picks one.
  const tolerance = goals.riskTolerance?.value ?? null;
  if (tolerance != null && isRiskLevel(tolerance)) {
    await tx
      .update(clients)
      .set({ riskTolerance: tolerance, updatedAt: new Date() })
      .where(and(eq(clients.id, ctx.clientId), eq(clients.firmId, ctx.orgId)));
    result.updated += 1;

    // Seed the suitability record too. An import that states a rung is already
    // confident enough to repoint the client's portfolios (just below), so
    // leaving client_risk_profiles empty stranded exactly that household on
    // /risk as "no tolerance established" — an allocation set from a rung the
    // suitability record never learned about. Routed through recomputeProfile
    // so the composite, binding constraint, and history row stay derived from
    // their inputs rather than written by hand.
    //
    // On `tx`, not its own transaction: a profile seeded by an import that
    // later rolls back must roll back with it.
    await recomputeProfileTx(tx, {
      clientId: ctx.clientId,
      firmId: ctx.orgId,
      actorUserId: ctx.userId,
      kind: "tolerance_manual",
      reason: "Stated during document import",
      patch: manualTolerancePatch(tolerance),
    });

    const portfolioId = await resolveRiskPortfolioId(ctx.orgId, tolerance);
    if (portfolioId) {
      await applyRiskPortfolioToScenario(tx, ctx.scenarioId, portfolioId);
    } else {
      // Untagged rung: tolerance is saved, portfolios unchanged. The advisor was
      // flagged at input time (goals-step), since commit warnings are invisible.
      result.warnings.push(
        `No model portfolio is tagged for the selected risk tolerance; the scenario's portfolios were left unchanged.`,
      );
    }
  } else if (tolerance != null) {
    // R5: a non-null tolerance that isn't one of the five `RISK_LEVELS` rungs
    // used to be dropped here in total silence. The planner's schema now types
    // the field as the enum, so this should be unreachable from that path — but
    // `goals.riskTolerance` is a bare `PlanBasicsField<string>` (assemble/types.ts)
    // that anything upstream can write, so an unmappable value must say so
    // rather than vanish.
    result.warnings.push(
      `Risk tolerance "${String(tolerance).slice(0, 40)}" is not one of the firm's risk levels and was not saved.`,
    );
  }

  return result;
}
