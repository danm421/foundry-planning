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

  // family_member removal — drop matching BeneficiaryRefs from each account.
  // The engine falls back to "estate" when an account has no remaining
  // designations, so dropping is the right cleanup (no synthetic estate ref
  // needed). Warning kind kept as "beneficiary_reassigned" per spec §4.2.
  const removedFamilyMemberIds = new Set(
    removed.filter((r) => r.kind === "family_member").map((r) => r.id),
  );
  const removedFmToCause = new Map(
    removed.filter((r) => r.kind === "family_member").map((r) => [r.id, r.causedByChangeId]),
  );

  if (tree.accounts && removedFamilyMemberIds.size > 0) {
    for (const acct of tree.accounts) {
      if (!acct.beneficiaries || acct.beneficiaries.length === 0) continue;
      const remaining = [];
      for (const bene of acct.beneficiaries) {
        if (bene.familyMemberId && removedFamilyMemberIds.has(bene.familyMemberId)) {
          warnings.push({
            kind: "beneficiary_reassigned",
            message: `Beneficiary ${bene.id} dropped (falls back to estate) — family_member ${bene.familyMemberId} was removed`,
            causedByChangeId: removedFmToCause.get(bene.familyMemberId)!,
            affectedEntityId: bene.id,
            affectedEntityLabel: `Beneficiary on account ${acct.id}`,
          });
        } else {
          remaining.push(bene);
        }
      }
      acct.beneficiaries = remaining;
    }
  }

  // entity removal — drop WillBequestRecipient entries pointing at the entity.
  // If a bequest's recipients[] becomes empty, drop the whole bequest.
  const removedEntityIds = new Set(
    removed.filter((r) => r.kind === "entity").map((r) => r.id),
  );
  const removedEntityToCause = new Map(
    removed.filter((r) => r.kind === "entity").map((r) => [r.id, r.causedByChangeId]),
  );

  if (tree.wills && removedEntityIds.size > 0) {
    for (const will of tree.wills) {
      const remainingBequests = [];
      for (const bq of will.bequests) {
        const remainingRecipients = [];
        for (const rcp of bq.recipients) {
          if (rcp.recipientKind === "entity" && rcp.recipientId && removedEntityIds.has(rcp.recipientId)) {
            warnings.push({
              kind: "will_bequest_dropped",
              message: `Will bequest recipient dropped — entity ${rcp.recipientId} was removed`,
              causedByChangeId: removedEntityToCause.get(rcp.recipientId)!,
              affectedEntityId: bq.id,
              affectedEntityLabel: `Will bequest · ${bq.name}`,
            });
          } else {
            remainingRecipients.push(rcp);
          }
        }
        bq.recipients = remainingRecipients;
        if (bq.recipients.length > 0) {
          remainingBequests.push(bq);
        }
        // else: bequest dropped entirely (no recipients left). Already warned above.
      }
      will.bequests = remainingBequests;
    }
  }

  return warnings;
}
