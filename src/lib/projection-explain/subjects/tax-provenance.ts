// src/lib/projection-explain/subjects/tax-provenance.ts
// Provenance for an account's Roth-designated slice: WHERE the already-taxed
// dollars in a 401(k)/403(b) came from. The engine tracks Roth designation on
// these accounts ONLY two ways — the seed `Account.rothValue` carried at plan
// start (ctx.accountSeedRoth) and ongoing `SavingsRule.rothPercent`
// contributions (ctx.savingsRules). There is no per-account "in-plan Roth
// rollover" concept: the only Roth *rollover* the engine models is the SECURE
// 2.0 §126 529 → Roth-IRA transfer (projection.ts), whose destination is always
// a roth_ira and never a 401k/403b, so it can never be the provenance of a
// roth_designated_slice. Hence provenance here is exactly seed value + the Roth
// savings rules feeding the account — no rollover field (see task-5-report.md).
import type { DrillContext } from "../types";

export interface RothProvenance {
  /** Already-taxed Roth dollars the account carried at plan start (Account.rothValue). */
  seedRothValue: number;
  /** Ongoing Roth-designated contributions feeding this account's Roth slice. */
  rothSavingsRules: { name: string; rothPercent: number; years: string }[];
}

/** Assemble the Roth-slice provenance for one account from the seed Roth value
 *  and the Roth-designated savings rules that target it. */
export function rothSliceProvenance(accountId: string, ctx: DrillContext): RothProvenance {
  const rothSavingsRules = ctx.savingsRules
    .filter((r) => r.accountId === accountId && (r.rothPercent ?? 0) > 0)
    .map((r) => ({
      // SavingsRule carries no name of its own; label it by the account it funds.
      name: ctx.accountNames[accountId] ?? "savings rule",
      rothPercent: r.rothPercent ?? 0,
      years: `${r.startYear}–${r.endYear}`, // en dash
    }));
  return {
    seedRothValue: ctx.accountSeedRoth[accountId] ?? 0,
    rothSavingsRules,
  };
}
