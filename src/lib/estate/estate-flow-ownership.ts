import type { ClientData, EntitySummary, Will } from "@/engine/types";
import type { ProjectionResult } from "@/engine/projection";
import {
  type AccountOwner,
  controllingFamilyMember,
  controllingEntity,
  ownedByFamilyMember,
  ownedByEntity,
} from "@/engine/ownership";
import type { EstateFlowGift } from "./estate-flow-gifts";

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
  /** Asset-once gifts dated after the current as-of year that will move this asset out. */
  futureGifts?: { giftId: string; year: number; percent: number }[];
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

export interface OwnershipColumnOptions {
  /** Live projection — required to read year-N account values. */
  projection?: ProjectionResult;
  /** When set, values come from the projection's year-N state; default = today. */
  asOfYear?: number;
  /** Working gift drafts — used to attach future-gift markers. */
  gifts?: EstateFlowGift[];
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
 * accounts may be covered by either grantor's will.
 */
function hasWillProvision(accountId: string, wills: Will[]): boolean {
  for (const will of wills) {
    // (b) Non-empty residuary clause covers all residual assets.
    if (will.residuaryRecipients && will.residuaryRecipients.length > 0) {
      return true;
    }
    // (a) Asset bequest: all_assets covers every account; specific must match.
    for (const bequest of will.bequests) {
      if (bequest.kind === "asset") {
        if (bequest.assetMode === "all_assets") {
          return true;
        }
        if (bequest.assetMode === "specific" && bequest.accountId === accountId) {
          return true;
        }
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
export function buildOwnershipColumn(
  data: ClientData,
  options: OwnershipColumnOptions = {},
): OwnershipColumnData {
  const wills = data.wills ?? [];
  const entities = data.entities ?? [];

  /**
   * Resolve an account's value as of the requested year. When both an
   * `asOfYear` and a `projection` are supplied, the projection's year-N
   * ending value wins; otherwise the advisor-entered base value is used.
   */
  const resolveValue = (accountId: string, baseValue: number): number => {
    if (options.asOfYear === undefined || !options.projection) return baseValue;
    const yearState = options.projection.years.find(
      (y) => y.year === options.asOfYear,
    );
    return yearState?.accountLedgers[accountId]?.endingValue ?? baseValue;
  };

  /**
   * Asset-once gifts dated strictly after the as-of year that will move
   * (part of) this account out. Empty unless `asOfYear` is set.
   */
  const futureGiftsFor = (
    accountId: string,
  ): { giftId: string; year: number; percent: number }[] => {
    if (options.asOfYear === undefined) return [];
    return (options.gifts ?? [])
      .filter(
        (g) =>
          g.kind === "asset-once" &&
          g.accountId === accountId &&
          g.year > options.asOfYear!,
      )
      .map((g) => {
        const ag = g as Extract<EstateFlowGift, { kind: "asset-once" }>;
        return { giftId: ag.id, year: ag.year, percent: ag.percent };
      });
  };

  const familyMembers = data.familyMembers ?? [];
  const clientFm = familyMembers.find((fm) => fm.role === "client");
  const spouseFm = familyMembers.find((fm) => fm.role === "spouse");

  const clientFmId = clientFm?.id ?? null;
  const spouseFmId = spouseFm?.id ?? null;

  const clientLabel = clientFm?.firstName ?? data.client.firstName ?? "Client";
  const spouseLabel = spouseFm?.firstName ?? data.client.spouseName ?? "Spouse";

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

  for (const account of data.accounts) {
    const accountId = account.id;
    const hasBeneficiaries = (account.beneficiaries ?? []).length > 0;
    const willProvision = hasWillProvision(accountId, wills);
    const hasConflict = !hasBeneficiaries && !willProvision;

    const soloEntityId = controllingEntity(account);
    if (soloEntityId !== null) {
      let group = entityGroups.get(soloEntityId);
      if (!group) {
        // Entity id not found in data.entities — emit an orphan group so the
        // account value is not silently dropped from grandTotal.
        group = {
          key: `entity:${soloEntityId}`,
          // Entity type is unknown here; default to "business". The rendering layer
          // should treat this as a data-quality fallback, not a deterministic label.
          kind: "business",
          label: "Unknown entity",
          assets: [],
          subtotal: 0,
        };
        entityGroups.set(soloEntityId, group);
      }
      const linkedLiabilities = buildLinkedLiabilities(data, accountId, "entity", soloEntityId);
      const liabilityTotal = linkedLiabilities.reduce((s, l) => s + l.balance, 0);
      const resolvedValue = resolveValue(accountId, account.value);
      const netValue = resolvedValue - liabilityTotal;
      const futureGifts = futureGiftsFor(accountId);
      group.assets.push({
        accountId,
        name: account.name,
        accountType: account.category,
        value: resolvedValue,
        percent: 1,
        isSplit: false,
        linkedLiabilities,
        netValue,
        hasBeneficiaries,
        hasConflict,
        ...(futureGifts.length > 0 ? { futureGifts } : {}),
      });
      continue;
    }

    const soloFmId = controllingFamilyMember(account);
    if (soloFmId !== null) {
      const isClient = soloFmId === clientFmId;
      const isSpouse = soloFmId === spouseFmId;
      const targetGroup = isClient ? clientGroup : isSpouse ? spouseGroup : null;
      if (targetGroup) {
        const ownerKind = "family_member" as const;
        const linkedLiabilities = buildLinkedLiabilities(data, accountId, ownerKind, soloFmId);
        const liabilityTotal = linkedLiabilities.reduce((s, l) => s + l.balance, 0);
        const resolvedValue = resolveValue(accountId, account.value);
        const netValue = resolvedValue - liabilityTotal;
        const futureGifts = futureGiftsFor(accountId);
        targetGroup.assets.push({
          accountId,
          name: account.name,
          accountType: account.category,
          value: resolvedValue,
          percent: 1,
          isSplit: false,
          linkedLiabilities,
          netValue,
          hasBeneficiaries,
          hasConflict,
          ...(futureGifts.length > 0 ? { futureGifts } : {}),
        });
      }
      continue;
    }

    // Mixed ownership — emit fractional rows for each family-member owner.
    // This handles the split (e.g. 60/40 client/spouse) case.
    const ownerRows = account.owners.filter(
      (o): o is Extract<AccountOwner, { kind: "family_member" }> => o.kind === "family_member",
    );
    const hasMultipleFmOwners = ownerRows.length > 1;

    for (const ownerRow of ownerRows) {
      const fmId = ownerRow.familyMemberId;
      const percent = ownerRow.percent;
      if (percent <= 0) continue;

      const isClient = fmId === clientFmId;
      const isSpouse = fmId === spouseFmId;
      const targetGroup = isClient ? clientGroup : isSpouse ? spouseGroup : null;
      if (!targetGroup) continue;

      const linkedLiabilities = buildLinkedLiabilities(data, accountId, "family_member", fmId);
      const liabilityTotal = linkedLiabilities.reduce((s, l) => s + l.balance, 0);
      const fractionalValue = resolveValue(accountId, account.value) * percent;
      const netValue = fractionalValue - liabilityTotal;
      const futureGifts = futureGiftsFor(accountId);

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
        ...(futureGifts.length > 0 ? { futureGifts } : {}),
      });
    }
  }

  // When viewing a projected year, drop any asset whose resolved value has
  // gone to ~0 (e.g. fully gifted away) so it no longer occupies a row.
  const dropZeroed = options.asOfYear !== undefined;

  const allGroups: OwnershipGroup[] = [clientGroup, spouseGroup, ...entityGroups.values()];
  const nonEmptyGroups = allGroups
    .map((g) => {
      const assets = dropZeroed
        ? g.assets.filter((a) => Math.abs(a.value) >= 1)
        : g.assets;
      // Recompute the subtotal from the surviving rows so totals stay consistent.
      return { ...g, assets, subtotal: assets.reduce((s, a) => s + a.netValue, 0) };
    })
    .filter((g) => g.assets.length > 0);

  const grandTotal = nonEmptyGroups.reduce((s, g) => s + g.subtotal, 0);

  return { groups: nonEmptyGroups, grandTotal };
}
