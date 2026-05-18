// After applyMutations, re-resolve reinvestments so a solver-added or -edited
// reinvestment carries correct newGrowthRate / newRealization /
// soldFractionByAccount. resolveReinvestments is idempotent, so unchanged base
// reinvestments resolve to the same values. Roth conversions and asset
// transactions are self-contained and need no resolution.

import type { ClientData } from "@/engine/types";
import type { ResolutionContext } from "@/lib/projection/resolve-entity";
import { resolveReinvestments } from "@/lib/projection/resolve-reinvestments";
import type { SolverMutation } from "./types";

export function resolveTechniqueMutations(
  tree: ClientData,
  mutations: SolverMutation[],
  ctx: ResolutionContext,
): ClientData {
  const touchesReinvestments = mutations.some(
    (m) => m.kind === "reinvestment-upsert",
  );
  if (!touchesReinvestments || !tree.reinvestments) return tree;
  return {
    ...tree,
    reinvestments: resolveReinvestments(tree.reinvestments, {
      resolver: ctx.resolver,
      accountBaseAllocByAccountId: ctx.accountBaseAllocByAccountId ?? new Map(),
    }),
  };
}
