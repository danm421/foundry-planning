// src/engine/scenario/cascadeResolution.ts
import type { ClientData } from "@/engine/types";
import type { CascadeWarning, TargetKind } from "./types";

export interface RemovedRef {
  kind: TargetKind;
  id: string;
  causedByChangeId: string;
}

export function resolveCascades(
  tree: ClientData,
  removed: RemovedRef[],
): CascadeWarning[] {
  const warnings: CascadeWarning[] = [];

  const removedAccountIds = new Set(
    removed.filter((r) => r.kind === "account").map((r) => r.id),
  );
  const removedAccountToCause = new Map(
    removed.filter((r) => r.kind === "account").map((r) => [r.id, r.causedByChangeId]),
  );

  // Transfers — drop if either sourceAccountId or targetAccountId was removed
  if (tree.transfers && removedAccountIds.size > 0) {
    const remaining = [];
    for (const tr of tree.transfers) {
      const src = tr.sourceAccountId;
      const dst = tr.targetAccountId;
      const hitId = src && removedAccountIds.has(src) ? src
                  : dst && removedAccountIds.has(dst) ? dst
                  : null;
      if (hitId) {
        warnings.push({
          kind: "transfer_dropped",
          message: `Transfer ${tr.id} dropped — account ${hitId} was removed`,
          causedByChangeId: removedAccountToCause.get(hitId)!,
          affectedEntityId: tr.id,
          affectedEntityLabel: `Transfer · ${tr.name ?? tr.id}`,
        });
      } else {
        remaining.push(tr);
      }
    }
    tree.transfers = remaining;
  }

  // Savings rules — drop if accountId was removed
  if (tree.savingsRules && removedAccountIds.size > 0) {
    const remaining = [];
    for (const rule of tree.savingsRules) {
      const accId = (rule as unknown as { accountId?: string }).accountId;
      if (accId && removedAccountIds.has(accId)) {
        warnings.push({
          kind: "savings_rule_dropped",
          message: `Savings rule ${rule.id} dropped — account ${accId} was removed`,
          causedByChangeId: removedAccountToCause.get(accId)!,
          affectedEntityId: rule.id,
          affectedEntityLabel: `Savings rule · ${(rule as unknown as { name?: string }).name ?? rule.id}`,
        });
      } else {
        remaining.push(rule);
      }
    }
    tree.savingsRules = remaining;
  }

  return warnings;
}
