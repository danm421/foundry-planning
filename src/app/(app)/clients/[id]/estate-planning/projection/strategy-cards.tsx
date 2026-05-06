/**
 * StrategyCards — composes 0/1/2/N + procrastination + guidance branches
 * into a row of strategy cards for the projection panel (Task 29).
 *
 * Branch logic (matches plan §Phase 8):
 *   - 0 trusts            → render nothing (return null)
 *   - 1 trust + procrastinated  → trust card + procrastination card + guidance card
 *   - 1 trust, no procrastinated → trust card + guidance card
 *   - >=2 trusts + procrastinated → top-2 trust cards + procrastination card
 *   - >=2 trusts, no procrastinated → top-2 trust cards
 *
 * Helper signature notes (verified against
 * `src/lib/estate/strategy-attribution.ts` — these differ from the plan
 * pseudocode):
 *   - `computeTrustCardData` takes `ranked: RankedTrust` (not `trust: Entity`).
 *     Pass each `RankedTrust` from `rankTrustsByContribution` directly.
 *   - `computeProcrastinationCardData` takes `delayedResult: ProjectionYear[]`
 *     (not `topGift`). The helper internally re-ranks trusts to find the
 *     top gifting trust.
 */

import type { ClientData } from "@/engine/types";
import type { ProjectionResult } from "@/engine/projection";
import {
  rankTrustsByContribution,
  computeTrustCardData,
  computeProcrastinationCardData,
} from "@/lib/estate/strategy-attribution";
import { StrategyCard, type StrategyCardData } from "./strategy-card";

interface Props {
  tree: ClientData;
  rightResult: ProjectionResult;
  rightIsDoNothing: boolean;
  procrastinatedResult: ProjectionResult | null;
}

export function StrategyCards({
  tree,
  rightResult,
  rightIsDoNothing,
  procrastinatedResult,
}: Props) {
  if (rightIsDoNothing) return null;
  const ranked = rankTrustsByContribution(tree, rightResult.years);
  if (ranked.length === 0) return null;

  const finalDeathYear =
    rightResult.secondDeathEvent?.year ??
    rightResult.firstDeathEvent?.year ??
    tree.planSettings.planEndYear;

  const trustCards: StrategyCardData[] = ranked.slice(0, 2).map((t) => {
    const card = computeTrustCardData({
      ranked: t,
      tree,
      withResult: rightResult.years,
      finalDeathYear,
    });
    return {
      tagLine: card.tagLine,
      primaryAmount: card.primaryAmount,
      narrative: card.narrative,
    };
  });

  const procrastinationCard: StrategyCardData | null = procrastinatedResult
    ? (() => {
        const card = computeProcrastinationCardData({
          tree,
          withResult: rightResult.years,
          delayedResult: procrastinatedResult.years,
          delayYears: 10,
          finalDeathYear,
        });
        return {
          tagLine: card.tagLine,
          primaryAmount: card.primaryAmount,
          narrative: card.narrative,
        };
      })()
    : null;

  const guidanceCard: StrategyCardData | null =
    ranked.length === 1
      ? {
          tagLine: "GUIDANCE · ADD ANOTHER TACTIC",
          primaryAmount: 0,
          narrative:
            "You have one trust strategy in place. Adding a complementary tactic (e.g. an ILIT or a SLAT) usually compounds savings.",
        }
      : null;

  const cards = [
    ...trustCards,
    procrastinationCard,
    guidanceCard,
  ].filter((c): c is StrategyCardData => c !== null);

  return (
    <div className="grid grid-cols-3 gap-3">
      {cards.map((c, i) => (
        <StrategyCard key={i} data={c} />
      ))}
    </div>
  );
}
