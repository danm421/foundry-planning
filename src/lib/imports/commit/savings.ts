import { and, eq } from "drizzle-orm";

import { accounts, savingsRules } from "@/db/schema";
import { defaultSavingsRuleRefs, resolveMilestone } from "@/lib/milestones";

import type { ExtractedSavings } from "@/lib/extraction/types";

import { getExistingId, linkCreated, type Annotated, type ImportPayload } from "../types";
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
  /**
   * Every payload row that folded into this rule. The fold is many-to-one, so
   * the rule's canonical id is stamped onto ALL of them — a re-commit then
   * updates that one rule instead of inserting a second copy.
   */
  rows: Annotated<ExtractedSavings>[];
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
      result.warnings.push(
        `The contribution "${row.name}" has no destination account, so it was not imported.`,
      );
      continue;
    }
    const existing = merged.get(key) ?? {
      destinationAccountName: key,
      owner: row.owner ?? "client",
      rows: [],
    };
    existing.rows.push(row);
    // First non-null wins per field; the employer leg only carries match fields
    // and the employee leg only carries amount/percent, so they do not collide.
    // If two files describe the same destination with a DIFFERING non-null
    // value, the first is still kept but the advisor is warned - a second file
    // silently overriding (or being silently discarded by) the first is exactly
    // the kind of confidently-wrong number that should not reach a projection.
    const keep = <K extends keyof MergedRule>(field: K, incoming: MergedRule[K]) => {
      if (incoming == null) return;
      const current = existing[field];
      if (current == null) {
        existing[field] = incoming;
        return;
      }
      if (current !== incoming) {
        result.warnings.push(
          `"${key}" received two different values for ${field} (${String(current)} and ${String(incoming)}); the first was kept.`,
        );
      }
    };
    keep("annualAmount", row.annualAmount);
    keep("annualPercent", row.annualPercent);
    keep("employerMatchPct", row.employerMatchPct);
    keep("employerMatchCap", row.employerMatchCap);
    keep("rothPercent", row.rothPercent);
    keep("growthRate", row.growthRate);
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

    const values = {
      annualAmount: rule.annualAmount != null ? String(rule.annualAmount) : "0",
      annualPercent: rule.annualPercent != null ? String(rule.annualPercent) : null,
      employerMatchPct: rule.employerMatchPct != null ? String(rule.employerMatchPct) : null,
      employerMatchCap: rule.employerMatchCap != null ? String(rule.employerMatchCap) : null,
      rothPercent: rule.rothPercent != null ? String(rule.rothPercent) : null,
      growthRate: rule.growthRate != null ? String(rule.growthRate) : "0",
      growthSource: "custom" as const,
      startYear,
      endYear,
      startYearRef: refs.startYearRef,
      endYearRef: refs.endYearRef,
    };

    // A rule this import already created (any leg carries the link). Update it
    // in place rather than inserting a second rule for the same destination.
    const linkedId = rule.rows.map(getExistingId).find((id) => id != null) ?? null;
    if (linkedId) {
      await tx
        .update(savingsRules)
        .set(values)
        .where(
          and(
            eq(savingsRules.id, linkedId),
            eq(savingsRules.clientId, ctx.clientId),
            eq(savingsRules.scenarioId, ctx.scenarioId),
          ),
        );
      result.updated += 1;
      continue;
    }

    const [inserted] = await tx
      .insert(savingsRules)
      .values({
        clientId: ctx.clientId,
        scenarioId: ctx.scenarioId,
        accountId,
        ...values,
      })
      .returning({ id: savingsRules.id });
    for (const r of rule.rows) linkCreated(r, inserted.id);
    result.created += 1;
  }

  return result;
}
