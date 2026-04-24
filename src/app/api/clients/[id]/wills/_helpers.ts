import { db } from "@/db";
import {
  accounts,
  familyMembers,
  externalBeneficiaries,
  entities,
  liabilities,
} from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import type { WillBequestInput } from "@/lib/schemas/wills";

type CrossRefCheck = {
  accountIds: string[];
  familyMemberIds: string[];
  externalIds: string[];
  entityIds: string[];
  liabilityIds: string[];
};

export type CrossRefError = { code: string; detail?: string };

export function gatherCrossRefs(bequests: WillBequestInput[]): CrossRefCheck {
  const check: CrossRefCheck = {
    accountIds: [],
    familyMemberIds: [],
    externalIds: [],
    entityIds: [],
    liabilityIds: [],
  };
  for (const b of bequests) {
    if (b.kind === "asset" && b.accountId) check.accountIds.push(b.accountId);
    if (b.kind === "liability") check.liabilityIds.push(b.liabilityId);
    for (const r of b.recipients) {
      if (!r.recipientId) continue;
      if (r.recipientKind === "family_member") check.familyMemberIds.push(r.recipientId);
      else if (r.recipientKind === "external_beneficiary") check.externalIds.push(r.recipientId);
      else if (r.recipientKind === "entity") check.entityIds.push(r.recipientId);
    }
  }
  return check;
}

export async function verifyCrossRefs(
  clientId: string,
  check: CrossRefCheck,
  bequests?: WillBequestInput[],
): Promise<CrossRefError | null> {
  if (check.accountIds.length > 0) {
    const rows = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.clientId, clientId), inArray(accounts.id, check.accountIds)));
    if (rows.length !== new Set(check.accountIds).size) {
      return { code: "One or more accountIds do not belong to this client" };
    }
  }
  if (check.familyMemberIds.length > 0) {
    const rows = await db
      .select({ id: familyMembers.id })
      .from(familyMembers)
      .where(
        and(
          eq(familyMembers.clientId, clientId),
          inArray(familyMembers.id, check.familyMemberIds),
        ),
      );
    if (rows.length !== new Set(check.familyMemberIds).size) {
      return { code: "One or more family-member recipientIds do not belong to this client" };
    }
  }
  if (check.externalIds.length > 0) {
    const rows = await db
      .select({ id: externalBeneficiaries.id })
      .from(externalBeneficiaries)
      .where(
        and(
          eq(externalBeneficiaries.clientId, clientId),
          inArray(externalBeneficiaries.id, check.externalIds),
        ),
      );
    if (rows.length !== new Set(check.externalIds).size) {
      return { code: "One or more external-beneficiary recipientIds do not belong to this client" };
    }
  }
  if (check.entityIds.length > 0) {
    const rows = await db
      .select({ id: entities.id })
      .from(entities)
      .where(and(eq(entities.clientId, clientId), inArray(entities.id, check.entityIds)));
    if (rows.length !== new Set(check.entityIds).size) {
      return { code: "One or more entity recipientIds do not belong to this client" };
    }
  }

  // Liability-bequest cross-ref: validate each liability individually so we
  // can surface granular error codes (not_found, linked, entity_owned).
  if (bequests) {
    for (const b of bequests) {
      if (b.kind !== "liability") continue;
      const liabId = b.liabilityId;
      const [liab] = await db
        .select({
          id: liabilities.id,
          linkedPropertyId: liabilities.linkedPropertyId,
          ownerEntityId: liabilities.ownerEntityId,
        })
        .from(liabilities)
        .where(and(eq(liabilities.clientId, clientId), eq(liabilities.id, liabId)));
      if (!liab) {
        return { code: "liability_not_found", detail: liabId };
      }
      if (liab.linkedPropertyId != null) {
        return { code: "liability_linked_not_bequestable", detail: liab.id };
      }
      if (liab.ownerEntityId != null) {
        return { code: "liability_entity_owned_not_bequestable", detail: liab.id };
      }
    }
  }

  return null;
}

/** Per-account soft-warning: specific bequests over-allocating one account at one condition. */
export function computeSoftWarnings(bequests: WillBequestInput[]): string[] {
  const byKey = new Map<string, number>();
  for (const b of bequests) {
    if (b.kind !== "asset" || b.assetMode !== "specific" || !b.accountId) continue;
    const key = `${b.accountId}|${b.condition}`;
    byKey.set(key, (byKey.get(key) ?? 0) + b.percentage);
  }
  const out: string[] = [];
  for (const [key, sum] of byKey.entries()) {
    if (sum > 100.01) {
      const [accountId, condition] = key.split("|");
      out.push(
        `Account ${accountId} is over-allocated at condition '${condition}' (${sum.toFixed(2)}%)`,
      );
    }
  }
  return out;
}
