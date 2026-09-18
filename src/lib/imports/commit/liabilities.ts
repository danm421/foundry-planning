import { and, eq } from "drizzle-orm";

import { accounts, liabilities, liabilityOwners } from "@/db/schema";
import { deriveLiabilityTerm } from "@/lib/imports/assemble/liability-term";

import { getExistingId, linkCreated, type ImportPayload } from "../types";
import { loadFamilyRoleIds, type FamilyRoleIds } from "./family-resolver";
import { matchMortgageToProperty, type PropertyRef } from "./mortgage-link";
import { emptyResult, type CommitContext, type CommitResult, type Tx } from "./types";

/**
 * Commits the liabilities tab. Mirrors accounts: insert/update keyed by
 * match annotation, owners synthesized on insert from the household's
 * role='client' familyMember row (liabilities have no `owner` enum, so
 * a single 100% client owner is the only synthesis path — joint/spouse
 * variants require manual setup post-commit).
 *
 * Field map (per plan):
 *   name: keep-existing
 *   balance, interestRate, monthlyPayment: replace
 *   balanceAsOfYear/Month: replaced only when the row carries a balance date
 *   startYear/startMonth/termMonths: replaced as ONE unit, and only when the
 *     row carries a maturity date that yielded a measured term — never the
 *     360-month placeholder, which would re-amortize a stored real term. A row
 *     with neither date leaves all three alone (bar the older payload's
 *     replace-if-non-null `startYear`).
 *
 * Notes:
 *   - startYear/startMonth/termMonths come from `deriveLiabilityTerm`: the
 *     statement's balance date is the start and the printed maturity sets the
 *     term, so the engine amortizes today's balance to the real payoff date.
 *     Falls back to a 360-month placeholder, with a warning, when the document
 *     prints no maturity.
 *   - liabilityOwners are NOT touched on update — advisor-managed.
 */
export async function commitLiabilities(
  tx: Tx,
  payload: ImportPayload,
  ctx: CommitContext,
  preloadedFamily?: FamilyRoleIds,
): Promise<CommitResult> {
  const result = emptyResult();
  const family = preloadedFamily ?? (await loadFamilyRoleIds(tx, ctx.clientId));
  const now = new Date();

  // Real-estate accounts (committed by the accounts tab earlier in this tx, or
  // by a prior commit) are auto-link candidates for mortgages.
  const propertyRows = (await tx
    .select({
      id: accounts.id,
      name: accounts.name,
      propertyAddress: accounts.propertyAddress,
    })
    .from(accounts)
    .where(
      and(
        eq(accounts.clientId, ctx.clientId),
        eq(accounts.scenarioId, ctx.scenarioId),
        eq(accounts.category, "real_estate"),
      ),
    )) as PropertyRef[];

  // Every stored debt's CURRENT link, read once here beside the property rows
  // above rather than per row inside the loop — one query either way, and no
  // N+1 inside a commit transaction. The UPDATE branch reads it to fill a
  // link that is missing without ever overwriting one that is not.
  const storedLinks = new Map(
    (
      await tx
        .select({ id: liabilities.id, linkedPropertyId: liabilities.linkedPropertyId })
        .from(liabilities)
        .where(
          and(
            eq(liabilities.clientId, ctx.clientId),
            eq(liabilities.scenarioId, ctx.scenarioId),
          ),
        )
    ).map((r) => [r.id, r.linkedPropertyId] as const),
  );

  // Built once outside the loop rather than `ctx.rowIds.includes(...)` per
  // row, which would be O(n^2) over the payload.
  const rowIdFilter = ctx.rowIds ? new Set(ctx.rowIds) : null;

  for (const row of payload.liabilities) {
    // An explicit id list means the advisor committed specific rows from the
    // chat surface. Absent list = commit everything, which is what the
    // wizard has always done and must keep doing. A row with no `__rowId`
    // can never be "listed", so it is skipped rather than guessed at.
    if (rowIdFilter && (!row.__rowId || !rowIdFilter.has(row.__rowId))) {
      continue;
    }

    const kind = row.match?.kind ?? "new";

    if (kind === "fuzzy") {
      result.skipped += 1;
      continue;
    }

    if (kind === "new") {
      const { term, warning } = deriveLiabilityTerm(row, now);
      if (warning) result.warnings.push(`${row.name}: ${warning}`);
      // An advisor-typed Start year (the wizard's review step seeds and edits
      // one) survives only while the document stated no dates of its own —
      // once it did, start/term are one derived pair and mixing a typed year
      // into it would measure the term from the wrong anchor.
      const typedStartYear =
        !row.balanceAsOfDate && !row.maturityDate && row.startYear != null
          ? row.startYear
          : null;
      const [inserted] = await tx
        .insert(liabilities)
        .values({
          clientId: ctx.clientId,
          scenarioId: ctx.scenarioId,
          name: row.name,
          balance: row.balance != null ? String(row.balance) : "0",
          interestRate: row.interestRate != null ? String(row.interestRate) : "0",
          monthlyPayment:
            row.monthlyPayment != null ? String(row.monthlyPayment) : "0",
          startYear: typedStartYear ?? term.startYear,
          // The month has to pair with the year beside it. The review step
          // types a year and no month, so a preserved typed year takes
          // January — `start_month`'s own schema default, and exactly what
          // this insert wrote before it derived anything. Today's month is a
          // derived figure; pairing it with an asserted year would originate
          // the loan up to 11 months late and shift every year's
          // interest/principal split (engine/liability-schedules.ts reads it).
          startMonth: typedStartYear != null ? 1 : term.startMonth,
          balanceAsOfYear: term.balanceAsOfYear,
          balanceAsOfMonth: term.balanceAsOfMonth,
          termMonths: term.termMonths,
          linkedPropertyId: matchMortgageToProperty(
            row.name,
            propertyRows,
            row.propertyAddress,
          ),
        })
        .returning({ id: liabilities.id });

      if (family.clientFmId) {
        await tx.insert(liabilityOwners).values({
          liabilityId: inserted.id,
          familyMemberId: family.clientFmId,
          entityId: null,
          percent: "1.0000",
        });
      }
      linkCreated(row, inserted.id);
      result.created += 1;
      continue;
    }

    const existingId = getExistingId(row);
    if (!existingId) {
      result.skipped += 1;
      continue;
    }
    const updates: Record<string, unknown> = { updatedAt: now };
    if (row.balance !== undefined) updates.balance = String(row.balance);
    if (row.interestRate !== undefined) {
      updates.interestRate = String(row.interestRate);
    }
    if (row.monthlyPayment !== undefined) {
      updates.monthlyPayment = String(row.monthlyPayment);
    }
    if (row.startYear != null) updates.startYear = row.startYear;

    // Every column named here overwrites a figure already in the database, and
    // `deriveLiabilityTerm` fills all five schedule fields on every call — an
    // absent maturity hands back the 360-month PLACEHOLDER, an absent balance
    // date a null as-of. So each cell is gated on the date that produced it:
    // writing an ungated one would replace something a document asserted with
    // something nothing asserted.
    const { term, warning } = deriveLiabilityTerm(row, now);

    // `warning` is set in exactly the two cases where `termMonths` is the
    // placeholder rather than a measured term — no maturity printed, or one
    // that precedes the balance date. Writing it would re-amortize a stored
    // 180-month loan over 360 and move its payoff date by fifteen years. The
    // start anchor is what a term is MEASURED from, so it moves only together
    // with the term — including when the anchor itself falls back to today.
    if (row.maturityDate !== undefined && !warning) {
      updates.startYear = term.startYear;
      updates.startMonth = term.startMonth;
      updates.termMonths = term.termMonths;
    }

    // Re-committing the mortgage is the advisor's natural recovery when it was
    // committed BEFORE its property existed — the INSERT above ran with no
    // property to match, so `linked_property_id` landed NULL and nothing on
    // this path ever repaired it (final review I1). Now it does.
    //
    // Gated on the STORED value being null, not on the row's: an advisor who
    // set — or deliberately UNSET — the link on the liability form owns that
    // decision, and a re-read of the same statement must not quietly undo it.
    // So this only ever fills a hole, which also makes it idempotent: the
    // second re-commit finds the link it wrote and leaves the key out.
    if (storedLinks.get(existingId) == null) {
      const link = matchMortgageToProperty(row.name, propertyRows, row.propertyAddress);
      if (link) updates.linkedPropertyId = link;
    }

    // The as-of pair records WHEN the balance was measured. A re-read that
    // printed no date said nothing about that, and writing the derived null
    // would erase the last statement's answer.
    if (row.balanceAsOfDate !== undefined) {
      updates.balanceAsOfYear = term.balanceAsOfYear;
      updates.balanceAsOfMonth = term.balanceAsOfMonth;
    }

    // The warning is deliberately NOT surfaced on this path: its text says the
    // loan "was given a 30-year term", which is true of an INSERT and false
    // here — the gate above is what stops that from happening.
    await tx
      .update(liabilities)
      .set(updates)
      .where(
        and(
          eq(liabilities.id, existingId),
          eq(liabilities.clientId, ctx.clientId),
          eq(liabilities.scenarioId, ctx.scenarioId),
        ),
      );
    result.updated += 1;
  }

  return result;
}
