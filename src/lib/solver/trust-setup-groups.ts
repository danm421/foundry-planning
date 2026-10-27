// src/lib/solver/trust-setup-groups.ts
//
// Pure detection: which saved scenario-change drafts belong to a trust the
// advisor set up in this session. A new trust, each gift to it, the will
// changes that name it and the accounts moved into it are one decision, so the
// save-scenario routes collapse them into one toggle-group ("Set up <trust>")
// — turning off the trust alone would leave a gift pointing at nothing.

import type { RevocableTrustFundingGroup } from "./revocable-trust-funding-group";
import type { SolverScenarioChangeDraft } from "./types";

/** Draft kinds that can name a trust. Entities are skipped: a trust add is the
 *  group's anchor, and no other entity refers to it. */
const MEMBER_KINDS = new Set(["gift", "will", "account", "external_beneficiary"]);

/** True when `node` (or anything inside it) points at the entity `id`: an
 *  entity-kind recipient (`{ kind: "entity", id }` on gifts and gifted_away
 *  owners, `{ recipientKind: "entity", recipientId }` on wills), an entity
 *  owner (`entityId`) or a beneficiary designation (`entityIdRef`). */
function names(node: unknown, id: string): boolean {
  if (Array.isArray(node)) return node.some((n) => names(n, id));
  if (node == null || typeof node !== "object") return false;
  const o = node as Record<string, unknown>;
  if (o.entityId === id || o.entityIdRef === id) return true;
  if (o.kind === "entity" && o.id === id) return true;
  if (o.recipientKind === "entity" && o.recipientId === id) return true;
  return Object.values(o).some((v) => names(v, id));
}

/** Whether the draft's payload names the trust. `edit` payloads are a diff of
 *  `{ field: { from, to } }`; only the new side counts — a trust added this
 *  session cannot appear in an old value. */
function draftNames(d: SolverScenarioChangeDraft, id: string): boolean {
  if (d.payload == null || typeof d.payload !== "object") return false;
  if (d.opType === "add") return names(d.payload, id);
  if (d.opType !== "edit") return false;
  return Object.values(d.payload as Record<string, unknown>).some((f) =>
    names((f as { to?: unknown } | null)?.to, id),
  );
}

/** One group per newly added trust that has at least one other change tied to
 *  it. A lone trust add is already a single change and needs no group; an edit
 *  to a trust the scenario's base already holds is not a "set up". */
export function trustSetupGroups(
  drafts: readonly SolverScenarioChangeDraft[],
): RevocableTrustFundingGroup[] {
  const groups: RevocableTrustFundingGroup[] = [];
  for (const trust of drafts) {
    if (trust.opType !== "add" || trust.targetKind !== "entity") continue;
    const payload = trust.payload as Record<string, unknown> | null;
    if (payload?.entityType !== "trust") continue;

    const splitInterest = payload.splitInterest as { charityId?: unknown } | null | undefined;
    const charityId = typeof splitInterest?.charityId === "string" ? splitInterest.charityId : null;

    const targetIds = [trust.targetId];
    for (const d of drafts) {
      if (!MEMBER_KINDS.has(d.targetKind)) continue;
      const isCharity =
        charityId != null && d.targetKind === "external_beneficiary" && d.opType === "add" && d.targetId === charityId;
      if (isCharity || draftNames(d, trust.targetId)) targetIds.push(d.targetId);
    }
    if (targetIds.length < 2) continue;
    groups.push({ name: `Set up ${String(payload.name ?? "trust")}`, targetIds });
  }
  return groups;
}
