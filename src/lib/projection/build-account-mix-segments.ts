// src/lib/projection/build-account-mix-segments.ts
//
// Pure. Merges each account's base asset mix with per-reinvestment segments so
// Monte Carlo can switch an account's allocation at the reinvestment year.
//   • model_portfolio reinvestment → segment at ri.year with the target mix.
//   • custom-rate reinvestment      → segment at ri.year with an EMPTY mix, so
//     the trial falls back to the account's deterministic growthRate (which the
//     projection's applyReinvestments has already set to newGrowthRate).
// The base mix, when present, is a segment at fromYear 0.

import type { AccountAssetMix, MixSegment } from "@/engine/monteCarlo/trial";
import type { Reinvestment } from "@/engine/types";

const BASE_FROM_YEAR = 0;

export interface BuildAccountMixSegmentsInput {
  baseMixByAccount: Map<string, AccountAssetMix[]>;
  reinvestments: readonly Reinvestment[];
  /** Resolve a model portfolio id to its asset-class mix ([] if unknown). */
  resolvePortfolioMix: (portfolioId: string) => AccountAssetMix[];
}

export function buildAccountMixSegments(
  input: BuildAccountMixSegmentsInput,
): Array<{ accountId: string; segments: MixSegment[] }> {
  const { baseMixByAccount, reinvestments, resolvePortfolioMix } = input;
  const segmentsByAccount = new Map<string, MixSegment[]>();

  const push = (accountId: string, seg: MixSegment) => {
    const list = segmentsByAccount.get(accountId) ?? [];
    list.push(seg);
    segmentsByAccount.set(accountId, list);
  };

  for (const [accountId, mix] of baseMixByAccount) {
    if (mix.length > 0) push(accountId, { fromYear: BASE_FROM_YEAR, mix });
  }

  for (const ri of reinvestments) {
    if (ri.enabled === false) continue;
    const mix =
      ri.targetType === "model_portfolio" && ri.modelPortfolioId
        ? resolvePortfolioMix(ri.modelPortfolioId)
        : []; // custom-rate → fixed-rate fallback
    for (const accountId of ri.accountIds) {
      push(accountId, { fromYear: ri.year, mix });
    }
  }

  return Array.from(segmentsByAccount, ([accountId, segments]) => ({
    accountId,
    segments: segments.sort((a, b) => a.fromYear - b.fromYear),
  }));
}
