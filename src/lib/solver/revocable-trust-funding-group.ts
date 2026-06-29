// src/lib/solver/revocable-trust-funding-group.ts
//
// Pure detection: which saved scenario-change drafts move an account into a
// revocable trust, bucketed by trust name. The solver's revocable-trust lever
// emits one account-upsert per retitled account; this lets the save-scenario
// routes collapse them into one toggle-group ("technique") card so the changes
// panel shows a single row instead of one per account.

import type { SolverScenarioChangeDraft } from "./types";

export interface RevocableTrustFundingGroup {
  /** Toggle-group name shown in the changes panel, e.g. "Move into Family Trust". */
  name: string;
  /** Account targetIds tagged with this trust (>= 2). */
  targetIds: string[];
}

/** The trust name a draft assigns to its account, or null when the draft does
 *  not fund a revocable trust. `edit` drafts carry
 *  `{ revocableTrustName: { from, to } }`; `add` drafts carry the full account
 *  entity. Only a non-empty string counts — clearing a tag sets it null (and a
 *  null→null no-op never produces a draft). */
function fundedTrustName(draft: SolverScenarioChangeDraft): string | null {
  if (draft.targetKind !== "account") return null;
  if (draft.payload == null || typeof draft.payload !== "object") return null;
  const payload = draft.payload as Record<string, unknown>;
  if (draft.opType === "edit") {
    const field = payload.revocableTrustName as { to?: unknown } | undefined;
    const to = field?.to;
    return typeof to === "string" && to.trim() !== "" ? to : null;
  }
  if (draft.opType === "add") {
    const v = payload.revocableTrustName;
    return typeof v === "string" && v.trim() !== "" ? v : null;
  }
  return null;
}

/** Bucket account-funding drafts by trust name. Returns one group per distinct
 *  trust that funds >= 2 accounts — a lone funded account is already a single
 *  change and needs no group. Insertion order is preserved. */
export function revocableTrustFundingGroups(
  drafts: SolverScenarioChangeDraft[],
): RevocableTrustFundingGroup[] {
  const byTrust = new Map<string, string[]>();
  for (const d of drafts) {
    const trust = fundedTrustName(d);
    if (trust == null) continue;
    const arr = byTrust.get(trust) ?? [];
    arr.push(d.targetId);
    byTrust.set(trust, arr);
  }
  const groups: RevocableTrustFundingGroup[] = [];
  for (const [trust, targetIds] of byTrust) {
    if (targetIds.length < 2) continue;
    groups.push({ name: `Move into ${trust}`, targetIds });
  }
  return groups;
}
