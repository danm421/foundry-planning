import type { ClientData, EntitySummary, Will } from "@/engine/types";
import {
  controllingFamilyMember,
  controllingEntity,
  ownedByFamilyMember,
  ownedByEntity,
} from "@/engine/ownership";

// ── Output Types ─────────────────────────────────────────────────────────────

export interface OwnershipAssetRow {
  accountId: string;
  name: string;
  /** Account category (e.g. "taxable", "retirement", "real_estate"). */
  accountType: string;
  /** Fractional value if split; full value if sole owner. */
  value: number;
  /** This group's ownership fraction (1 = whole). */
  percent: number;
  isSplit: boolean;
  linkedLiabilities: { liabilityId: string; name: string; balance: number }[];
  /** value minus linked liability balances (at this group's fractional share). */
  netValue: number;
  hasBeneficiaries: boolean;
  /** No beneficiary AND no will provision (specific bequest or residuary clause). */
  hasConflict: boolean;
}

export interface OwnershipGroup {
  /** "client" | "spouse" | "joint" | `entity:<id>` */
  key: string;
  kind: "client" | "spouse" | "joint" | "trust" | "business";
  label: string;
  assets: OwnershipAssetRow[];
  /** Sum of netValue across all assets. */
  subtotal: number;
}

export interface OwnershipColumnData {
  groups: OwnershipGroup[];
  grandTotal: number;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function entityKind(entity: EntitySummary): "trust" | "business" {
  return entity.entityType === "trust" ? "trust" : "business";
}

/**
 * Structural conflict check for column-1 (as-of-today, no death event).
 * An account has a conflict when it has no beneficiary designations AND
 * none of the household's wills either:
 *   (a) has a specific asset bequest naming this account, or
 *   (b) has a non-empty residuary clause.
 *
 * Note: we check all wills, not just the owner's will, because jointly held
 * accounts may be covered by either grantor's will. A later task will use the
 * engine's deathWarnings for the death-event columns.
 */
function hasWillProvision(accountId: string, wills: Will[]): boolean {
  for (const will of wills) {
    // (b) Non-empty residuary clause covers all residual assets.
    if (will.residuaryRecipients && will.residuaryRecipients.length > 0) {
      return true;
    }
    // (a) Specific bequest naming this account.
    for (const bequest of will.bequests) {
      if (bequest.kind === "asset" && bequest.assetMode === "specific" && bequest.accountId === accountId) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Build the linked-liability list for an account row, scoped to a specific owner.
 * The balance returned is already fractional (liability.balance × ownerPercent).
 */
function buildLinkedLiabilities(
  data: ClientData,
  accountId: string,
  ownerKind: "family_member" | "entity",
  ownerId: string,
): { liabilityId: string; name: string; balance: number }[] {
  return (data.liabilities ?? [])
    .filter((l) => l.linkedPropertyId === accountId)
    .flatMap((l) => {
      const liabPercent =
        ownerKind === "family_member"
          ? ownedByFamilyMember(l, ownerId)
          : ownedByEntity(l, ownerId);
      if (liabPercent <= 0) return [];
      return [
        {
          liabilityId: l.id,
          name: l.name,
          balance: l.balance * liabPercent,
        },
      ];
    });
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Builds the column-1 (as-of-today) ownership display structure from ClientData.
 *
 * Groups:
 *   - "client"  — accounts with a sole family_member owner whose role === "client"
 *   - "spouse"  — accounts with a sole family_member owner whose role === "spouse"
 *   - "client" + "spouse" — split fractional rows when both own a portion
 *   - "entity:<id>" — accounts 100% owned by a single entity (trust or business)
 *
 * Joint accounts (where both client and spouse each own a fraction) produce
 * fractional rows in both the Client and Spouse groups with isSplit: true.
 * A dedicated "joint" group is omitted in v1 — only emitted when an owner
 * has kind === "entity" that represents a joint ownership entity (not modeled).
 *
 * Empty groups are dropped.
 */
export function buildOwnershipColumn(data: ClientData): OwnershipColumnData {
  const wills = data.wills ?? [];
  const entities = data.entities ?? [];

  // Resolve client/spouse family member ids from the familyMembers array.
  const familyMembers = data.familyMembers ?? [];
  const clientFm = familyMembers.find((fm) => fm.role === "client");
  const spouseFm = familyMembers.find((fm) => fm.role === "spouse");

  const clientFmId = clientFm?.id ?? null;
  const spouseFmId = spouseFm?.id ?? null;

  const clientLabel = clientFm?.firstName ?? data.client.firstName ?? "Client";
  const spouseLabel = spouseFm?.firstName ?? data.client.spouseName ?? "Spouse";

  // Build entity group map (keyed by entity id).
  const entityGroups = new Map<string, OwnershipGroup>();
  for (const entity of entities) {
    entityGroups.set(entity.id, {
      key: `entity:${entity.id}`,
      kind: entityKind(entity),
      label: entity.name ?? entity.id,
      assets: [],
      subtotal: 0,
    });
  }

  // Placeholder groups for client/spouse (only emitted if they have assets).
  const clientGroup: OwnershipGroup = {
    key: "client",
    kind: "client",
    label: clientLabel,
    assets: [],
    subtotal: 0,
  };
  const spouseGroup: OwnershipGroup = {
    key: "spouse",
    kind: "spouse",
    label: spouseLabel,
    assets: [],
    subtotal: 0,
  };

  // Process each account.
  for (const account of data.accounts) {
    const accountId = account.id;
    const hasBeneficiaries = (account.beneficiaries ?? []).length > 0;
    const willProvision = hasWillProvision(accountId, wills);
    const hasConflict = !hasBeneficiaries && !willProvision;

    // Check for 100% single-entity ownership.
    const soloEntityId = controllingEntity(account);
    if (soloEntityId !== null) {
      const group = entityGroups.get(soloEntityId);
      if (group) {
        const linkedLiabilities = buildLinkedLiabilities(data, accountId, "entity", soloEntityId);
        const liabilityTotal = linkedLiabilities.reduce((s, l) => s + l.balance, 0);
        const netValue = account.value - liabilityTotal;
        group.assets.push({
          accountId,
          name: account.name,
          accountType: account.category,
          value: account.value,
          percent: 1,
          isSplit: false,
          linkedLiabilities,
          netValue,
          hasBeneficiaries,
          hasConflict,
        });
      }
      continue;
    }

    // Check for 100% single family-member ownership.
    const soloFmId = controllingFamilyMember(account);
    if (soloFmId !== null) {
      const isClient = soloFmId === clientFmId;
      const isSpouse = soloFmId === spouseFmId;
      const targetGroup = isClient ? clientGroup : isSpouse ? spouseGroup : null;
      if (targetGroup) {
        const ownerKind = "family_member" as const;
        const linkedLiabilities = buildLinkedLiabilities(data, accountId, ownerKind, soloFmId);
        const liabilityTotal = linkedLiabilities.reduce((s, l) => s + l.balance, 0);
        const netValue = account.value - liabilityTotal;
        targetGroup.assets.push({
          accountId,
          name: account.name,
          accountType: account.category,
          value: account.value,
          percent: 1,
          isSplit: false,
          linkedLiabilities,
          netValue,
          hasBeneficiaries,
          hasConflict,
        });
      }
      continue;
    }

    // Mixed ownership — emit fractional rows for each family-member owner.
    // This handles the split (e.g. 60/40 client/spouse) case.
    const ownerRows = account.owners.filter((o) => o.kind === "family_member");
    const hasMultipleFmOwners = ownerRows.length > 1;

    for (const ownerRow of ownerRows) {
      const fmId = (ownerRow as { familyMemberId: string }).familyMemberId;
      const percent = ownerRow.percent;
      if (percent <= 0) continue;

      const isClient = fmId === clientFmId;
      const isSpouse = fmId === spouseFmId;
      const targetGroup = isClient ? clientGroup : isSpouse ? spouseGroup : null;
      if (!targetGroup) continue;

      const linkedLiabilities = buildLinkedLiabilities(data, accountId, "family_member", fmId);
      const liabilityTotal = linkedLiabilities.reduce((s, l) => s + l.balance, 0);
      const fractionalValue = account.value * percent;
      const netValue = fractionalValue - liabilityTotal;

      targetGroup.assets.push({
        accountId,
        name: account.name,
        accountType: account.category,
        value: fractionalValue,
        percent,
        isSplit: hasMultipleFmOwners,
        linkedLiabilities,
        netValue,
        hasBeneficiaries,
        hasConflict,
      });
    }
  }

  // Compute subtotals and collect non-empty groups.
  const allGroups: OwnershipGroup[] = [clientGroup, spouseGroup, ...entityGroups.values()];
  const nonEmptyGroups = allGroups
    .map((g) => ({
      ...g,
      subtotal: g.assets.reduce((s, a) => s + a.netValue, 0),
    }))
    .filter((g) => g.assets.length > 0);

  const grandTotal = nonEmptyGroups.reduce((s, g) => s + g.subtotal, 0);

  return { groups: nonEmptyGroups, grandTotal };
}
