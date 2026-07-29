import { and, eq } from "drizzle-orm";

import { accounts, savingsRules } from "@/db/schema";
import { defaultSavingsRuleRefs, resolveMilestone } from "@/lib/milestones";

import type { ImportPayload } from "../types";
import { emptyResult, type CommitContext, type CommitResult, type Tx } from "./types";

/** One destination account's merged employee + employer legs. */
interface MergedRule {
  destinationAccountName: string;
  owner: "client" | "spouse" | "joint";
  annualAmount?: number;
  annualPercent?: number;
  employerMatchPct?: number;
  employerMatchCap?: number;
  rothPercent?: number;
  growthRate?: number;
}

/**
 * Commits the savings tab.
 *
 * Planning-report exports emit the employee deferral and the employer match as
 * SEPARATE rows sharing a Destination column. `savings_rules` models both legs
 * on one row (annualPercent + employerMatchPct/Cap), so rows are grouped by
 * destination account and folded together before insert.
 *
 * Destination resolves BY NAME against already-committed accounts, mirroring
 * commitGoals' funding-account resolution and commit/mortgage-link.ts. This is
 * why "savings" sits after "accounts" in COMMIT_TABS.
 *
 * A row whose destination cannot be resolved is skipped with a warning rather
 * than dropped silently - an unattached contribution is invisible in the plan
 * and the advisor needs to know.
 */
export async function commitSavings(
  tx: Tx,
  payload: ImportPayload,
  ctx: CommitContext,
): Promise<CommitResult> {
  const result = emptyResult();
  if (payload.savings.length === 0) return result;

  // Fold the legs together, keyed by destination account name.
  const merged = new Map<string, MergedRule>();
  for (const row of payload.savings) {
    const key = row.destinationAccountName;
    if (!key) {
      result.skipped += 1;
      continue;
    }
    const existing = merged.get(key) ?? {
      destinationAccountName: key,
      owner: row.owner ?? "client",
    };
    // First non-null wins per field; the employer leg only carries match fields
    // and the employee leg only carries amount/percent, so they do not collide.
    if (existing.annualAmount == null && row.annualAmount != null) existing.annualAmount = row.annualAmount;
    if (existing.annualPercent == null && row.annualPercent != null) existing.annualPercent = row.annualPercent;
    if (existing.employerMatchPct == null && row.employerMatchPct != null) existing.employerMatchPct = row.employerMatchPct;
    if (existing.employerMatchCap == null && row.employerMatchCap != null) existing.employerMatchCap = row.employerMatchCap;
    if (existing.rothPercent == null && row.rothPercent != null) existing.rothPercent = row.rothPercent;
    if (existing.growthRate == null && row.growthRate != null) existing.growthRate = row.growthRate;
    // A non-client owner on any leg wins: the employee leg carries the real owner.
    if (row.owner && row.owner !== "client") existing.owner = row.owner;
    merged.set(key, existing);
  }

  // One read of this client's accounts, then match by exact then normalized name.
  const existingAccounts = await tx
    .select({ id: accounts.id, name: accounts.name })
    .from(accounts)
    .where(and(eq(accounts.clientId, ctx.clientId), eq(accounts.scenarioId, ctx.scenarioId)));

  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const byExact = new Map(existingAccounts.map((a) => [a.name, a.id]));
  const byNormalized = new Map(existingAccounts.map((a) => [normalize(a.name), a.id]));

  for (const rule of merged.values()) {
    const accountId =
      byExact.get(rule.destinationAccountName) ??
      byNormalized.get(normalize(rule.destinationAccountName));

    if (!accountId) {
      result.skipped += 1;
      result.warnings.push(
        `Could not attach the contribution to "${rule.destinationAccountName}" - no matching account was found, so it was not imported.`,
      );
      continue;
    }

    const refs = defaultSavingsRuleRefs(rule.owner);
    const startYear =
      (refs.startYearRef && ctx.milestones
        ? resolveMilestone(refs.startYearRef, ctx.milestones, "start")
        : null) ?? ctx.milestones?.planStart ?? 0;
    const endYear =
      (refs.endYearRef && ctx.milestones
        ? resolveMilestone(refs.endYearRef, ctx.milestones, "end")
        : null) ?? ctx.milestones?.planEnd ?? 0;

    await tx.insert(savingsRules).values({
      clientId: ctx.clientId,
      scenarioId: ctx.scenarioId,
      accountId,
      annualAmount: rule.annualAmount != null ? String(rule.annualAmount) : "0",
      annualPercent: rule.annualPercent != null ? String(rule.annualPercent) : null,
      employerMatchPct: rule.employerMatchPct != null ? String(rule.employerMatchPct) : null,
      employerMatchCap: rule.employerMatchCap != null ? String(rule.employerMatchCap) : null,
      rothPercent: rule.rothPercent != null ? String(rule.rothPercent) : null,
      growthRate: rule.growthRate != null ? String(rule.growthRate) : "0",
      growthSource: "custom",
      startYear,
      endYear,
      startYearRef: refs.startYearRef,
      endYearRef: refs.endYearRef,
    });
    result.created += 1;
  }

  return result;
}
